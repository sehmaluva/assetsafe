"""Import companies from the external registry into the local database."""

from __future__ import annotations

from django.db import transaction

from apps.common.models.models import PartyDataSource
from apps.common.services.external_registry import ExternalRegistryClient
from apps.companies.models.models import Company, CompanyBranch, CompanyProfile


def import_external_company(external_reference: str, *, created_by=None) -> CompanyBranch:
    """Import a company via its remote branch id (same API shape as local branch search)."""
    client = ExternalRegistryClient()
    payload = client.get_company_branch(external_reference)
    if not payload:
        raise ValueError("External company branch not found.")

    company_data = payload.get("company") or {}
    company_ext_ref = str(company_data.get("id") or company_data.get("external_reference") or "")

    if company_ext_ref:
        existing_company = Company.objects.filter(
            external_reference=company_ext_ref, is_deleted=False
        ).first()
        if existing_company:
            hq = existing_company.branches.filter(
                is_headquarters=True, is_deleted=False
            ).first()
            if hq:
                return hq
            return existing_company.branches.filter(is_deleted=False).first()

    registration_number = (company_data.get("registration_number") or "").strip() or None

    if registration_number:
        by_reg = Company.objects.filter(
            registration_number=registration_number, is_deleted=False
        ).first()
        if by_reg:
            if company_ext_ref and not by_reg.external_reference:
                by_reg.external_reference = company_ext_ref
                by_reg.source = PartyDataSource.EXTERNAL
                by_reg.save(update_fields=["external_reference", "source"])
            hq = by_reg.branches.filter(is_headquarters=True, is_deleted=False).first()
            return hq or by_reg.branches.filter(is_deleted=False).first()

    with transaction.atomic():
        company = Company(
            registration_number=registration_number,
            registration_name=company_data.get("registration_name")
            or payload.get("branch_name")
            or "Unknown Company",
            trading_name=company_data.get("trading_name"),
            legal_status=company_data.get("legal_status") or "private",
            industry=company_data.get("industry"),
            date_of_incorporation=company_data.get("date_of_incorporation"),
            source=PartyDataSource.EXTERNAL,
            external_reference=company_ext_ref or external_reference,
        )
        if created_by is not None:
            company.created_by = created_by
            company.updated_by = created_by
        company.save()

        profile_data = payload.get("profile") or {}
        if (
            profile_data
            or payload.get("email")
            or payload.get("phone")
            or company_data.get("email")
            or company_data.get("phone")
        ):
            CompanyProfile.objects.create(
                company=company,
                email=profile_data.get("email") or payload.get("email"),
                mobile_phone=profile_data.get("mobile_phone") or payload.get("phone"),
                landline_phone=profile_data.get("landline_phone"),
                tin_number=profile_data.get("tin_number"),
                vat_number=profile_data.get("vat_number"),
                website=profile_data.get("website"),
            )

        company.auto_create_hq_branch()

        hq_branch = company.branches.filter(
            is_headquarters=True, is_deleted=False
        ).first()
        if hq_branch and payload.get("email"):
            hq_branch.email = payload.get("email")
            hq_branch.phone = payload.get("phone")
            hq_branch.save(update_fields=["email", "phone"])

    hq_branch = company.branches.filter(is_headquarters=True, is_deleted=False).first()
    if not hq_branch:
        raise ValueError("Failed to create company headquarters branch.")
    return hq_branch
