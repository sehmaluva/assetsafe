"""Business logic for stand ownership change and sale transition."""

from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from apps.asset_management.models import (
    AssetOwnershipEvent,
    AssetOwnershipEventType,
    AssetRegistration,
    StandSaleTransition,
)
from apps.common.models import BaseAssetType, PartyType


def _snapshot_owner(asset: AssetRegistration) -> dict:
    return {
        "owner_type": asset.owner_type,
        "individual_owner": asset.individual_owner,
        "company_owner": asset.company_owner,
    }


def _is_same_owner(
    asset: AssetRegistration,
    owner_type: str,
    individual_owner,
    company_owner,
) -> bool:
    if asset.owner_type != owner_type:
        return False
    if owner_type == PartyType.INDIVIDUAL:
        return (
            asset.individual_owner_id is not None
            and individual_owner is not None
            and asset.individual_owner_id == individual_owner.pk
        )
    return (
        asset.company_owner_id is not None
        and company_owner is not None
        and asset.company_owner_id == company_owner.pk
    )


@transaction.atomic
def record_sale_transition(
    asset: AssetRegistration,
    *,
    purchaser_type: str,
    individual_purchaser,
    company_purchaser,
    sale_date,
    terms: str,
    valuation_type: str,
    title_status: str,
    currency,
    value_amount,
    user,
) -> StandSaleTransition:
    if asset.asset_category != BaseAssetType.LAND:
        raise ValueError("Sale transition is only valid for land assets.")

    if asset.get_open_sale_transition():
        raise ValueError("An open sale transition already exists for this asset.")

    sale = StandSaleTransition.objects.create(
        asset=asset,
        purchaser_type=purchaser_type,
        individual_purchaser=individual_purchaser,
        company_purchaser=company_purchaser,
        sale_date=sale_date,
        terms=terms,
        valuation_type=valuation_type,
        title_status=title_status,
        currency=currency,
        value_amount=value_amount,
        created_by=user,
        updated_by=user,
    )

    owner = _snapshot_owner(asset)
    AssetOwnershipEvent.objects.create(
        asset=asset,
        event_type=AssetOwnershipEventType.SALE_TRANSITION,
        previous_owner_type=owner["owner_type"],
        previous_individual_owner=owner["individual_owner"],
        previous_company_owner=owner["company_owner"],
        new_owner_type=owner["owner_type"],
        new_individual_owner=owner["individual_owner"],
        new_company_owner=owner["company_owner"],
        sale_transition=sale,
        valuation_type=valuation_type,
        title_status=title_status,
        terms=terms,
        value_amount=value_amount,
        created_by=user,
        updated_by=user,
    )
    return sale


@transaction.atomic
def record_ownership_change(
    asset: AssetRegistration,
    *,
    owner_type: str,
    individual_owner,
    company_owner,
    valuation_type: str = "",
    title_status: str = "",
    terms: str = "",
    currency=None,
    value_amount=None,
    user,
) -> AssetRegistration:
    if asset.asset_category != BaseAssetType.LAND:
        raise ValueError("Ownership change is only valid for land assets.")

    if _is_same_owner(asset, owner_type, individual_owner, company_owner):
        raise ValueError("The new owner cannot be the same as the current owner.")

    previous = _snapshot_owner(asset)
    open_sale = asset.get_open_sale_transition()

    asset.owner_type = owner_type
    if owner_type == PartyType.INDIVIDUAL:
        asset.individual_owner = individual_owner
        asset.company_owner = None
    else:
        asset.company_owner = company_owner
        asset.individual_owner = None
    if currency is not None:
        asset.currency = currency
    if value_amount is not None:
        asset.estimated_value = value_amount
    asset.updated_by = user
    asset.save()

    if open_sale:
        open_sale.is_completed = True
        open_sale.completed_at = timezone.now()
        open_sale.updated_by = user
        open_sale.save(
            update_fields=["is_completed", "completed_at", "updated_by", "date_updated"]
        )

    AssetOwnershipEvent.objects.create(
        asset=asset,
        event_type=AssetOwnershipEventType.OWNERSHIP_CHANGE,
        previous_owner_type=previous["owner_type"],
        previous_individual_owner=previous["individual_owner"],
        previous_company_owner=previous["company_owner"],
        new_owner_type=owner_type,
        new_individual_owner=(
            individual_owner if owner_type == PartyType.INDIVIDUAL else None
        ),
        new_company_owner=company_owner if owner_type == PartyType.COMPANY else None,
        sale_transition=open_sale,
        valuation_type=valuation_type or "",
        title_status=title_status or "",
        terms=terms or "",
        value_amount=value_amount,
        created_by=user,
        updated_by=user,
    )
    return asset
