"""Cross-registry asset enquiry search and encumbrance report building."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Literal

from django.db.models import Q, QuerySet

from apps.asset_management.models import AssetRegistration
from apps.collateral.models.models import CollateralRegistration
from apps.common.models import BaseAssetType, CustodyType
from apps.enquiries.services.masking import (
    mask_company_name,
    mask_id_reg_display,
    mask_individual_name,
)
from apps.hire_purchase.models.models import HirePurchaseRegistration

SearchField = Literal[
    "agreement_number",
    "serial_number",
    "registration_number",
    "chassis_number",
    "engine_number",
    "stand_number",
]

SOURCE_COLLATERAL = "collateral"
SOURCE_HIRE_PURCHASE = "hire_purchase"
SOURCE_ASSET_REGISTRY = "asset_registry"

# Precedence when multiple encumbrances apply (plan default).
ENCUMBRANCE_PRECEDENCE = (
    SOURCE_COLLATERAL,
    SOURCE_HIRE_PURCHASE,
    SOURCE_ASSET_REGISTRY,
)


@dataclass
class EnquiryHit:
    source: str
    record_id: int
    agreement_number: str
    reg_or_serial: str
    description: str


def _description(make: str, model: str) -> str:
    parts = [p for p in (make or "", model or "") if p]
    return " ".join(parts)


def _iexact(field: str, value: str) -> Q:
    return Q(**{f"{field}__iexact": value})


def search_assets(query: str, search_field: SearchField) -> list[EnquiryHit]:
    """Search Collateral, Hire Purchase, and Asset Registry by identifier field."""
    term = (query or "").strip()
    if not term:
        return []

    hits: list[EnquiryHit] = []

    # --- Collateral (open / not discharged) ---
    col_qs: QuerySet[CollateralRegistration] = CollateralRegistration.objects.filter(
        is_discharged=False
    )
    if search_field == "agreement_number":
        col_qs = col_qs.filter(_iexact("agreement_number", term))
    elif search_field == "serial_number":
        col_qs = col_qs.filter(_iexact("serial_number", term))
    elif search_field == "registration_number":
        col_qs = col_qs.filter(_iexact("asset_registration_number", term))
    elif search_field == "chassis_number":
        col_qs = col_qs.filter(_iexact("chassis_number", term))
    elif search_field == "engine_number":
        col_qs = col_qs.filter(_iexact("engine_number", term))
    elif search_field == "stand_number":
        col_qs = CollateralRegistration.objects.none()
    else:
        col_qs = CollateralRegistration.objects.none()

    for row in col_qs.select_related()[:25]:
        reg_or_serial = row.asset_registration_number or row.serial_number or ""
        hits.append(
            EnquiryHit(
                source=SOURCE_COLLATERAL,
                record_id=row.pk,
                agreement_number=row.agreement_number or "",
                reg_or_serial=reg_or_serial,
                description=_description(row.make, row.model),
            )
        )

    # --- Hire Purchase (not closed) ---
    hp_qs: QuerySet[HirePurchaseRegistration] = HirePurchaseRegistration.objects.filter(
        closure_confirmed=False
    )
    if search_field == "agreement_number":
        hp_qs = hp_qs.filter(_iexact("agreement_number", term))
    elif search_field == "serial_number":
        hp_qs = hp_qs.filter(_iexact("serial_number", term))
    elif search_field == "registration_number":
        hp_qs = hp_qs.filter(_iexact("mv_registration_number", term))
    elif search_field == "chassis_number":
        hp_qs = hp_qs.filter(_iexact("chassis_number", term))
    elif search_field == "engine_number":
        hp_qs = hp_qs.filter(_iexact("engine_number", term))
    elif search_field == "stand_number":
        hp_qs = HirePurchaseRegistration.objects.none()
    else:
        hp_qs = HirePurchaseRegistration.objects.none()

    for row in hp_qs.select_related()[:25]:
        reg_or_serial = row.mv_registration_number or row.serial_number or ""
        hits.append(
            EnquiryHit(
                source=SOURCE_HIRE_PURCHASE,
                record_id=row.pk,
                agreement_number=row.agreement_number or "",
                reg_or_serial=reg_or_serial,
                description=_description(row.make, row.model),
            )
        )

    # --- Asset Registry (show all subscriptions for enquiry) ---
    ar_qs: QuerySet[AssetRegistration] = AssetRegistration.objects.select_related(
        "vehicle",
        "mobile",
        "land",
        "land__suburb",
        "land__city",
    )
    if search_field == "agreement_number":
        ar_qs = ar_qs.filter(_iexact("registration_number", term))
    elif search_field == "serial_number":
        ar_qs = ar_qs.filter(_iexact("serial_number", term))
    elif search_field == "registration_number":
        ar_qs = ar_qs.filter(_iexact("vehicle__mv_registration_number", term))
    elif search_field == "chassis_number":
        ar_qs = ar_qs.filter(_iexact("vehicle__chassis_number", term))
    elif search_field == "engine_number":
        ar_qs = ar_qs.filter(_iexact("vehicle__engine_number", term))
    elif search_field == "stand_number":
        ar_qs = ar_qs.filter(_iexact("land__stand_number", term))
    else:
        ar_qs = AssetRegistration.objects.none()

    for row in ar_qs.select_related(
        "individual_owner", "company_owner", "company_owner__company"
    )[:25]:
        reg_or_serial = _asset_reg_or_serial(row)
        hits.append(
            EnquiryHit(
                source=SOURCE_ASSET_REGISTRY,
                record_id=row.pk,
                agreement_number=row.registration_number or "",
                reg_or_serial=reg_or_serial,
                description=_asset_description(row),
            )
        )

    return hits


def _asset_description(row: AssetRegistration) -> str:
    if row.asset_category == BaseAssetType.LAND:
        return row.asset_type or "Stand"
    return _description(row.make, row.model)


def _asset_reg_or_serial(row: AssetRegistration) -> str:
    if row.asset_category == BaseAssetType.VEHICLES:
        vehicle = getattr(row, "vehicle", None)
        return vehicle.mv_registration_number if vehicle else ""
    if row.asset_category == BaseAssetType.MOBILES:
        mobile = getattr(row, "mobile", None)
        return mobile.imei if mobile else ""
    if row.asset_category == BaseAssetType.LAND:
        land = getattr(row, "land", None)
        return land.stand_number if land else ""
    return row.serial_number or ""


def _owner_from_individual(individual, *, unmasked: bool) -> tuple[str, str]:
    if unmasked:
        return str(individual), individual.identification_number or ""
    return _owner_masked_from_individual(individual)


def _owner_from_company_branch(branch, *, unmasked: bool) -> tuple[str, str]:
    if unmasked:
        company = getattr(branch, "company", None)
        name = (
            (company.trading_name or company.registration_name)
            if company
            else str(branch)
        )
        reg_no = getattr(company, "registration_number", None) if company else None
        return name, reg_no or ""
    return _owner_masked_from_company_branch(branch)


def _owner_masked_from_individual(individual) -> tuple[str, str]:
    name = mask_individual_name(individual.first_name, individual.last_name)
    id_reg = mask_id_reg_display(individual.identification_number)
    return name, id_reg


def _owner_masked_from_company_branch(branch) -> tuple[str, str]:
    company = getattr(branch, "company", None)
    display_name = (
        (company.trading_name or company.registration_name)
        if company
        else str(branch)
    )
    name = mask_company_name(display_name)
    reg_no = getattr(company, "registration_number", None) if company else None
    id_reg = mask_id_reg_display(None, reg_no)
    return name, id_reg


def _party_from_collateral(row: CollateralRegistration) -> tuple[str, str]:
    if row.debtor_type == "individual" and row.individual_debtor:
        return _owner_masked_from_individual(row.individual_debtor)
    if row.company_debtor:
        return _owner_masked_from_company_branch(row.company_debtor)
    return "", ""


def _party_from_hp(row: HirePurchaseRegistration) -> tuple[str, str]:
    if row.purchaser_type == "individual" and row.purchaser_individual:
        return _owner_masked_from_individual(row.purchaser_individual)
    if row.purchaser_company:
        return _owner_masked_from_company_branch(row.purchaser_company)
    return "", ""


def _party_from_asset(row: AssetRegistration, *, unmasked: bool = False) -> tuple[str, str]:
    if row.owner_type == "individual" and row.individual_owner:
        return _owner_from_individual(row.individual_owner, unmasked=unmasked)
    if row.company_owner:
        return _owner_from_company_branch(row.company_owner, unmasked=unmasked)
    return "", ""


def _purchaser_from_sale(sale, *, unmasked: bool) -> tuple[str, str]:
    if sale.purchaser_type == "individual" and sale.individual_purchaser:
        return _owner_from_individual(sale.individual_purchaser, unmasked=unmasked)
    if sale.company_purchaser:
        return _owner_from_company_branch(sale.company_purchaser, unmasked=unmasked)
    return "", ""


def _land_report_fields(row: AssetRegistration) -> dict[str, Any]:
    land = getattr(row, "land", None)
    if not land:
        return {
            "is_land": False,
            "area_development": "",
            "stand_number": "",
            "stand_size": "",
            "city_town": "",
        }
    return {
        "is_land": True,
        "area_development": land.suburb.name if land.suburb_id else "",
        "stand_number": land.stand_number,
        "stand_size": land.stand_size_display,
        "city_town": land.city.name if land.city_id else "",
    }


def _format_money(currency_code: str | None, amount: Decimal | None) -> str | None:
    if amount is None:
        return None
    code = currency_code or ""
    formatted = f"{amount:,.2f}"
    return f"{code}{formatted}" if code else formatted


def _format_agreement_end(value) -> str | None:
    if value is None:
        return None
    return value.strftime("%d-%b-%y")


def _find_open_collateral_for_identifiers(
    *,
    chassis: str,
    engine: str,
    serial: str,
    registration: str,
) -> CollateralRegistration | None:
    q = Q()
    if chassis:
        q |= _iexact("chassis_number", chassis)
    if engine:
        q |= _iexact("engine_number", engine)
    if serial:
        q |= _iexact("serial_number", serial)
    if registration:
        q |= _iexact("asset_registration_number", registration)
    if not q:
        return None
    return (
        CollateralRegistration.objects.filter(is_discharged=False)
        .filter(q)
        .select_related(
            "financier",
            "individual_debtor",
            "company_debtor",
            "company_debtor__company",
            "currency",
        )
        .first()
    )


def _find_open_hp_for_identifiers(
    *,
    chassis: str,
    engine: str,
    serial: str,
    registration: str,
) -> HirePurchaseRegistration | None:
    q = Q()
    if chassis:
        q |= _iexact("chassis_number", chassis)
    if engine:
        q |= _iexact("engine_number", engine)
    if serial:
        q |= _iexact("serial_number", serial)
    if registration:
        q |= _iexact("mv_registration_number", registration)
    if not q:
        return None
    return (
        HirePurchaseRegistration.objects.filter(closure_confirmed=False)
        .filter(q)
        .select_related(
            "financier",
            "purchaser_individual",
            "purchaser_company",
            "purchaser_company__company",
            "currency",
        )
        .first()
    )


def build_asset_report(
    source: str, record_id: int, *, unmasked: bool = False
) -> dict[str, Any]:
    """
    Build a masked Asset Enquiry report.

    Encumbrance precedence: Collateral > Hire Purchase > Custody > Clear.
    """
    if source == SOURCE_COLLATERAL:
        row = (
            CollateralRegistration.objects.select_related(
                "financier",
                "individual_debtor",
                "company_debtor",
                "company_debtor__company",
                "currency",
            ).get(pk=record_id)
        )
        owner_name, owner_id_reg = _party_from_collateral(row)
        report: dict[str, Any] = {
            "source": source,
            "record_id": record_id,
            "asset_description": _description(row.make, row.model),
            "reg_number_serial": row.asset_registration_number or row.serial_number or "",
            "chassis_number": row.chassis_number or "",
            "engine_number": row.engine_number or "",
            "owner_masked": owner_name,
            "id_reg_masked": owner_id_reg,
            "status": "encumbered",
            "encumbrance_kind": "collateral",
            "encumbrance_details": "Collateral",
            "financier": None,
            "loan_amount": _format_money(
                getattr(row.currency, "code", None), row.total_debt
            ),
            "purchase_amount": None,
            "custodian_name_masked": None,
            "custodian_id_reg_masked": None,
            "expected_encumbrance_end": _format_agreement_end(row.agreement_end_date),
        }
        return report

    if source == SOURCE_HIRE_PURCHASE:
        row = (
            HirePurchaseRegistration.objects.select_related(
                "financier",
                "purchaser_individual",
                "purchaser_company",
                "purchaser_company__company",
                "currency",
            ).get(pk=record_id)
        )
        owner_name, owner_id_reg = _party_from_hp(row)
        financier_name = row.financier.name if row.financier else ""
        report = {
            "source": source,
            "record_id": record_id,
            "asset_description": _description(row.make, row.model),
            "reg_number_serial": row.mv_registration_number or row.serial_number or "",
            "chassis_number": row.chassis_number or "",
            "engine_number": row.engine_number or "",
            "owner_masked": owner_name,
            "id_reg_masked": owner_id_reg,
            "status": "encumbered",
            "encumbrance_kind": "hire_purchase",
            "encumbrance_details": "Hire Purchase Agreement",
            "financier": financier_name,
            "loan_amount": None,
            "purchase_amount": _format_money(
                getattr(row.currency, "code", None), row.purchase_amount
            ),
            "custodian_name_masked": None,
            "custodian_id_reg_masked": None,
            "expected_encumbrance_end": _format_agreement_end(row.agreement_end_date),
        }
        return report

    if source == SOURCE_ASSET_REGISTRY:
        row = (
            AssetRegistration.objects.select_related(
                "individual_owner",
                "company_owner",
                "company_owner__company",
                "individual_custodian",
                "company_custodian",
                "company_custodian__company",
                "currency",
                "vehicle",
                "mobile",
                "land",
                "land__city",
                "land__suburb",
            ).get(pk=record_id)
        )
        owner_name, owner_id_reg = _party_from_asset(row, unmasked=unmasked)
        vehicle = getattr(row, "vehicle", None)
        base = {
            "source": source,
            "record_id": record_id,
            "asset_category": row.asset_category,
            "asset_description": _asset_description(row),
            "reg_number_serial": _asset_reg_or_serial(row),
            "chassis_number": vehicle.chassis_number if vehicle else "",
            "engine_number": vehicle.engine_number if vehicle else "",
            "owner_masked": owner_name,
            "id_reg_masked": owner_id_reg,
            "financier": None,
            "loan_amount": None,
            "purchase_amount": None,
            "custodian_name_masked": None,
            "custodian_id_reg_masked": None,
            "expected_encumbrance_end": None,
            "purchaser_masked": None,
            "purchaser_id_reg_masked": None,
            "sale_date": None,
            **_land_report_fields(row),
        }

        identifiers = dict(
            chassis=vehicle.chassis_number if vehicle else "",
            engine=vehicle.engine_number if vehicle else "",
            serial=row.serial_number or "",
            registration=vehicle.mv_registration_number if vehicle else "",
        )
        collateral = _find_open_collateral_for_identifiers(**identifiers)
        if collateral:
            base.update(
                {
                    "status": "encumbered",
                    "encumbrance_kind": "collateral",
                    "encumbrance_details": "Collateral",
                    "loan_amount": _format_money(
                        getattr(collateral.currency, "code", None),
                        collateral.total_debt,
                    ),
                    "owner_masked": _party_from_collateral(collateral)[0] or owner_name,
                    "id_reg_masked": _party_from_collateral(collateral)[1]
                    or owner_id_reg,
                    "expected_encumbrance_end": _format_agreement_end(
                        collateral.agreement_end_date
                    ),
                }
            )
            return base

        hp = _find_open_hp_for_identifiers(**identifiers)
        if hp:
            financier_name = hp.financier.name if hp.financier else ""
            base.update(
                {
                    "status": "encumbered",
                    "encumbrance_kind": "hire_purchase",
                    "encumbrance_details": "Hire Purchase Agreement",
                    "financier": financier_name,
                    "purchase_amount": _format_money(
                        getattr(hp.currency, "code", None), hp.purchase_amount
                    ),
                    "owner_masked": _party_from_hp(hp)[0] or owner_name,
                    "id_reg_masked": _party_from_hp(hp)[1] or owner_id_reg,
                    "expected_encumbrance_end": _format_agreement_end(
                        hp.agreement_end_date
                    ),
                }
            )
            return base

        if row.is_under_custody():
            custody_label = dict(CustodyType.choices).get(
                row.custody_type, row.custody_type
            )
            custodian_name = ""
            custodian_id_reg = ""
            if row.custodian_type == "individual" and row.individual_custodian:
                custodian_name, custodian_id_reg = _owner_masked_from_individual(
                    row.individual_custodian
                )
            elif row.company_custodian:
                custodian_name, custodian_id_reg = _owner_masked_from_company_branch(
                    row.company_custodian
                )
            base.update(
                {
                    "status": "encumbered",
                    "encumbrance_kind": "custody",
                    "encumbrance_details": f"Under Custody - {custody_label}",
                    "custodian_name_masked": custodian_name,
                    "custodian_id_reg_masked": custodian_id_reg,
                }
            )
            return base

        open_sale = row.get_open_sale_transition()
        if open_sale:
            purchaser_name, purchaser_id = _purchaser_from_sale(
                open_sale, unmasked=unmasked
            )
            base.update(
                {
                    "status": "sold",
                    "encumbrance_kind": None,
                    "encumbrance_details": None,
                    "purchaser_masked": purchaser_name,
                    "purchaser_id_reg_masked": purchaser_id,
                    "sale_date": open_sale.sale_date.strftime("%d-%b-%y"),
                }
            )
            return base

        base.update(
            {
                "status": "clear",
                "encumbrance_kind": None,
                "encumbrance_details": None,
            }
        )
        return base

    raise ValueError(f"Unknown enquiry source: {source}")
