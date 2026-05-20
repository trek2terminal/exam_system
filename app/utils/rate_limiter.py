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


def rate_limit(scope, limit=None, window_seconds=None, methods=("POST",), json_response=True):
    """Small in-memory fixed-window limiter for local/LAN deployments."""
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
            now = time.monotonic()
            key = _client_key(scope)

            with _rate_lock:
                bucket = _rate_buckets[key]
                while bucket and now - bucket[0] > window:
                    bucket.popleft()

                if len(bucket) >= max_requests:
                    retry_after = max(1, int(window - (now - bucket[0])))
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

                bucket.append(now)

            return view(*args, **kwargs)

        return wrapper

    return decorator
