"""
Seed system LookupOption rows from TextChoices enums.

This is the source of truth for default choice lists. It is designed so that
wiping migrations and regenerating with ``makemigrations`` still works:

- Schema comes from models via ``makemigrations``
- Rows are ensured after migrate via ``post_migrate`` (and this helper)

``update_or_create`` keeps the operation idempotent for re-runs and fresh DBs.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from django.db import models as django_models


def _rows_from_text_choices(choices_cls) -> list[tuple[str, str, int]]:
    return [
        (choice.value, str(choice.label), index)
        for index, choice in enumerate(choices_cls)
    ]


def seed_system_lookup_options(
    *,
    LookupOption: type[django_models.Model] | None = None,
) -> int:
    """
    Upsert system (``is_system=True``) lookup rows for all managed categories.

    Returns the number of categories seeded.
    """
    if LookupOption is None:
        from apps.common.models import LookupOption as LookupOptionModel

        LookupOption = LookupOptionModel

    from apps.common.models.models import (
        AssetCondition,
        BaseAssetType,
        CollateralAssetType,
        PartyType,
        SaleTerms,
        TitleStatus,
        ValuationType,
    )
    from apps.companies.models.models import Industry

    # Category keys must match LookupOption.CATEGORY_* (and regenerated migrations).
    batches: list[tuple[str, list[tuple[str, str, int]]]] = [
        ("PartyType", _rows_from_text_choices(PartyType)),
        ("BaseAssetType", _rows_from_text_choices(BaseAssetType)),
        ("AssetCondition", _rows_from_text_choices(AssetCondition)),
        ("CollateralAssetCategory", _rows_from_text_choices(CollateralAssetType)),
        ("Industry", _rows_from_text_choices(Industry)),
        ("ValuationType", _rows_from_text_choices(ValuationType)),
        ("TitleStatus", _rows_from_text_choices(TitleStatus)),
        ("SaleTerms", _rows_from_text_choices(SaleTerms)),
    ]

    for category, rows in batches:
        for value, label, sort_order in rows:
            LookupOption.objects.update_or_create(
                category=category,
                value=value,
                defaults={
                    "label": label,
                    "is_system": True,
                    "is_active": True,
                    "sort_order": sort_order,
                },
            )

    return len(batches)
