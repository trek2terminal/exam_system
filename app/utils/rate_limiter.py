import time
from collections import defaultdict, deque
from functools import wraps
from threading import Lock

from flask import current_app, flash, jsonify, redirect, request

from app.utils.network import get_client_ip


_rate_buckets = defaultdict(deque)
_rate_lock = Lock()


def _client_key(scope):
    user_key = (
        request.view_args.get("session_code")
        if request.view_args and request.view_args.get("session_code")
        else get_client_ip()
    )
    return f"{scope}:{user_key}"


def _redis_rate_limit(key, max_requests, window):
    from app.utils.redis_store import get_redis_client

    redis_client = get_redis_client()
    if not redis_client:
        return None

    now = int(time.time())
    bucket = now // window
    redis_key = f"rate-limit:{key}:{bucket}"
    count = redis_client.incr(redis_key)
    if count == 1:
        redis_client.expire(redis_key, window + 2)
    retry_after = max(1, window - (now % window))
    return count <= max_requests, retry_after


def _memory_rate_limit(key, max_requests, window):
    now = time.monotonic()

    with _rate_lock:
        bucket = _rate_buckets[key]
        while bucket and now - bucket[0] > window:
            bucket.popleft()

        if len(bucket) >= max_requests:
            return False, max(1, int(window - (now - bucket[0])))

        bucket.append(now)
        return True, 0


def _limit_response(retry_after, json_response):
    if json_response:
        response = jsonify(
            {
                "ok": False,
                "message": "Too many requests. Please wait before trying again.",
                "retry_after": retry_after,
            }
        )
        response.status_code = 429
        response.headers["Retry-After"] = str(retry_after)
        return response

    flash("Too many attempts. Please wait before trying again.", "danger")
    return redirect(request.referrer or request.path)


def _request_wants_json():
    accept = request.headers.get("Accept", "")
    requested_with = request.headers.get("X-Requested-With", "")
    return request.is_json or "application/json" in accept or requested_with == "XMLHttpRequest"


def rate_limit(scope, limit=None, window_seconds=None, methods=("POST",), json_response=True):
    """Rate limiter with local-memory default and optional Redis storage."""
    methods = set(methods or [])

    def decorator(view):
        @wraps(view)
        def wrapper(*args, **kwargs):
            if methods and request.method not in methods:
                return view(*args, **kwargs)

            defaults = current_app.config.get("RATE_LIMITS", {})
            scope_config = defaults.get(scope, {})
            max_requests = int(limit or scope_config.get("limit", 60))
            window = int(window_seconds or scope_config.get("window", 60))
            key = _client_key(scope)

            allowed = True
            retry_after = 0
            storage = current_app.config.get("RATE_LIMIT_STORAGE", "memory")
            if storage == "redis":
                try:
                    result = _redis_rate_limit(key, max_requests, window)
                    if result is not None:
                        allowed, retry_after = result
                    else:
                        allowed, retry_after = _memory_rate_limit(key, max_requests, window)
                except Exception:
                    current_app.logger.exception("Redis rate limiter failed")
                    if current_app.config.get("RATE_LIMIT_FAIL_OPEN", True):
                        allowed, retry_after = True, 0
                    else:
                        allowed, retry_after = False, window
            else:
                allowed, retry_after = _memory_rate_limit(key, max_requests, window)

            if not allowed:
                return _limit_response(retry_after, json_response or _request_wants_json())

            return view(*args, **kwargs)

        return wrapper

    return decorator
