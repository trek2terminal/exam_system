from functools import lru_cache

from flask import current_app


@lru_cache(maxsize=8)
def _cached_redis_client(redis_url):
    import redis

    return redis.from_url(redis_url, decode_responses=True)


def get_redis_client(redis_url=None):
    url = (redis_url or current_app.config.get("REDIS_URL") or "").strip()
    if not url:
        return None
    return _cached_redis_client(url)
