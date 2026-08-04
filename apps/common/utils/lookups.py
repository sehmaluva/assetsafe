"""Helpers for DB-backed PartyType / BaseAssetType / AssetCondition / Industry lookups."""

from __future__ import annotations

from django.core.cache import cache
from django.core.exceptions import ValidationError as DjangoValidationError

from apps.common.models import LookupOption
from apps.common.utils.caching import CacheService


def _fetch_lookup_choices(category: str) -> list[dict[str, str]]:
    return [
        {"value": row.value, "label": row.label}
        for row in LookupOption.objects.filter(
            category=category, is_active=True
        ).order_by("sort_order", "label")
    ]


def list_lookup_choices(category: str) -> list[dict[str, str]]:
    """
    Return ``[{value, label}, ...]`` for active options in a category.

    Industry is cached heavily (7 days) and invalidated when LookupOption
    rows for that category change.
    """
    if category != LookupOption.CATEGORY_INDUSTRY:
        return _fetch_lookup_choices(category)

    version = CacheService._get_version(CacheService.LOOKUPS_INDUSTRY_TAG)
    cache_key = CacheService._generate_cache_key(
        "lookup_choices:Industry", version
    )
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    rows = _fetch_lookup_choices(category)
    cache.set(cache_key, rows, CacheService.HEAVY_CACHE_TIMEOUT)
    return rows


def invalidate_industry_lookup_cache() -> None:
    """Bump Industry lookup + common choices cache versions."""
    CacheService.invalidate_tag(CacheService.LOOKUPS_INDUSTRY_TAG)
    CacheService.invalidate_tag(CacheService.CHOICES_COMMON_TAG)


def ensure_valid_lookup_value(category: str, value: str | None, *, field: str) -> str:
    """
    Validate ``value`` against active ``LookupOption`` rows for ``category``.

    Empty string is allowed for optional fields (caller decides).
    Industry validation uses the heavy-cached choice list when possible.
    """
    if value is None or value == "":
        return ""
    normalized = str(value).strip()

    if category == LookupOption.CATEGORY_INDUSTRY:
        allowed = {row["value"] for row in list_lookup_choices(category)}
        if normalized not in allowed:
            raise DjangoValidationError(
                {field: f"'{normalized}' is not a valid {category} option."}
            )
        return normalized

    exists = LookupOption.objects.filter(
        category=category, value=normalized, is_active=True
    ).exists()
    if not exists:
        raise DjangoValidationError(
            {field: f"'{normalized}' is not a valid {category} option."}
        )
    return normalized
