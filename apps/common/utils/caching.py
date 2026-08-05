# apps/common/utils/caching.py
from django.core.cache import cache
from django.utils.encoding import force_bytes
from django.conf import settings
from hashlib import md5
import logging
import uuid
from functools import wraps
from rest_framework.response import Response as DRF_Response
from rest_framework.renderers import JSONRenderer

logger = logging.getLogger('cache')

class CacheService:
    """
    A robust, version-based caching service for Django applications.

    This service avoids fragile key-matching for invalidation by associating
    cache entries with versioned tags. To invalidate a group of caches,
    you simply invalidate the tag, which creates a new version.
    """
    DEFAULT_TIMEOUT = settings.CACHES['default'].get('TIMEOUT', 300)
    LONG_CACHE_TIMEOUT = 60 * 60 * 2  # 2 hours
    HEAVY_CACHE_TIMEOUT = 60 * 60 * 24 * 7  # 7 days — rarely changing lookups
    VERSION_TIMEOUT = 60 * 60 * 24 # Cache versions for a day

    LOOKUPS_INDUSTRY_TAG = "lookups:Industry"
    CHOICES_COMMON_TAG = "choices:common"

    @classmethod
    def _get_version_key(cls, tag: str) -> str:
        """Generates the cache key for a tag's version."""
        return f"cache:version:{tag}"

    @classmethod
    def _get_version(cls, tag: str) -> str:
        """
        Retrieves the current version for a tag, creating one if it doesn't exist.
        """
        version_key = cls._get_version_key(tag)
        version = cache.get(version_key)
        if version is None:
            version = uuid.uuid4().hex
            cache.set(version_key, version, cls.VERSION_TIMEOUT)
        return version

    @classmethod
    def invalidate_tag(cls, tag: str):
        """
        Invalidates a cache tag by setting a new version.
        This is the core invalidation mechanism.
        """
        version_key = cls._get_version_key(tag)
        new_version = uuid.uuid4().hex
        cache.set(version_key, new_version, cls.VERSION_TIMEOUT)

    @classmethod
    def _generate_cache_key(cls, base_key: str, version: str) -> str:
        """Creates a final, versioned cache key."""
        return f"cache:data:{base_key}:{version}"

    @classmethod
    def clear_all_versions(cls):
        """Clear all version keys (for testing/debugging)"""
        try:
            keys = cache.keys(f"{cls._get_version_key('*')}")
            if keys:
                cache.delete_many(keys)
            return len(keys)
        except Exception as e:
            logger.error(f"Error clearing version keys: {e}")
            return 0
        
    @classmethod
    def cached(cls, tag_prefix: str, timeout: int = None, vary_on_user: bool = False):
        """
        A powerful decorator for caching view functions and methods.

        Args:
            tag_prefix (str): A prefix for the cache tag. Can contain placeholders
            like '{pk}' which will be formatted with view kwargs.
            timeout (int): The cache timeout in seconds. Defaults to DEFAULT_TIMEOUT.
            vary_on_user (bool): When True, include authenticated user id and
                client id in the cache key so client-scoped registries cannot leak.
        """
        def decorator(view_func):
            @wraps(view_func)
            def wrapped_view(view_instance, request, *args, **kwargs):
                try:
                    formatted_tag = tag_prefix.format(**kwargs)
                    version = cls._get_version(formatted_tag)
                    path = request.get_full_path()
                    base_key_str = (
                        f"view={view_instance.__class__.__name__}."
                        f"{view_func.__name__},path={path}"
                    )
                    if vary_on_user:
                        user = getattr(request, "user", None)
                        user_id = getattr(user, "pk", None) if user else None
                        client_id = getattr(user, "client_id", None) if user else None
                        base_key_str += f",user={user_id},client={client_id}"
                    base_key = md5(force_bytes(base_key_str)).hexdigest()
                    cache_key = cls._generate_cache_key(base_key, version)
                    
                    # Trying to fetch from cache
                    cached_response = cache.get(cache_key)
                    if cached_response is not None:
                        logger.debug(f"Cache HIT for tag '{formatted_tag}' at key '{cache_key}'")
                        return cached_response
                    
                    logger.debug(f"Cache MISS for tag '{formatted_tag}'")

                    response = view_func(view_instance, request, *args, **kwargs)

                    # Render the response before caching if it's a successful DRF Response
                    if isinstance(response, DRF_Response) and 200 <= response.status_code < 300:
                        if not response.is_rendered:
                            response.accepted_renderer = JSONRenderer()
                            response.accepted_media_type = 'application/json'
                            response.renderer_context = view_instance.get_renderer_context()
                            response.render()
                        
                        cache.set(cache_key, response, timeout or cls.DEFAULT_TIMEOUT)
                        logger.debug(f"CACHED response for tag '{formatted_tag}' at key '{cache_key}'")

                    return response
                
                except Exception as e:
                    logger.error(f"Error in caching decorator for {view_func.__name__}: {e}", exc_info=True)
                    return view_func(view_instance, request, *args, **kwargs)
            return wrapped_view
        return decorator