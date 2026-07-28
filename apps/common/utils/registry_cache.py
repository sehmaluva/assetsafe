"""Cache invalidation helpers for registry ViewSets (asset, HP, collateral)."""

from __future__ import annotations

from collections.abc import Iterable

from apps.common.utils.caching import CacheService

ASSET_REGISTRY = "asset-registry"
HIRE_PURCHASE_REGISTRY = "hire-purchase"
COLLATERAL_REGISTRY = "collateral"

REGISTRIES: tuple[str, ...] = (
    ASSET_REGISTRY,
    HIRE_PURCHASE_REGISTRY,
    COLLATERAL_REGISTRY,
)
HP_COLLATERAL_REGISTRIES: tuple[str, ...] = (
    HIRE_PURCHASE_REGISTRY,
    COLLATERAL_REGISTRY,
)


def invalidate_registry_caches(
    *,
    registries: Iterable[str] | None = None,
    record_pk: int | None = None,
) -> None:
    """Invalidate list/stats tags for the given registries, and optionally one record."""
    targets = tuple(registries) if registries is not None else REGISTRIES
    for tag in targets:
        CacheService.invalidate_tag(f"{tag}:list")
        CacheService.invalidate_tag(f"{tag}:stats")
        if record_pk is not None:
            CacheService.invalidate_tag(f"{tag}:{record_pk}")
