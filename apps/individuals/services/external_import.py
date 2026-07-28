"""Import individuals from the external registry into the local database."""

from __future__ import annotations

from django.db import transaction

from apps.common.models.models import PartyDataSource
from apps.common.services.external_registry import ExternalRegistryClient
from apps.individuals.models.models import Individual, IndividualContactDetail


def _extract_phone(payload: dict) -> str | None:
    if phone := payload.get("phone"):
        return phone

    contact_details = payload.get("contact_details") or []
    for contact in contact_details:
        if not isinstance(contact, dict):
            continue
        phone_number = contact.get("phone_number")
        if phone_number:
            return phone_number
    return None


def import_external_individual(external_reference: str, *, created_by=None) -> Individual:
    existing = Individual.objects.filter(
        external_reference=external_reference, is_deleted=False
    ).first()
    if existing:
        return existing

    client = ExternalRegistryClient()
    payload = client.get_individual(external_reference)
    if not payload:
        raise ValueError("External individual not found.")

    identification_number = (payload.get("identification_number") or "").strip()
    if identification_number:
        by_id_number = Individual.objects.filter(
            identification_number=identification_number, is_deleted=False
        ).first()
        if by_id_number:
            if not by_id_number.external_reference:
                by_id_number.external_reference = external_reference
                by_id_number.source = PartyDataSource.EXTERNAL
                by_id_number.save(update_fields=["external_reference", "source"])
            return by_id_number

    with transaction.atomic():
        individual = Individual(
            first_name=payload.get("first_name") or "Unknown",
            last_name=payload.get("last_name") or "Unknown",
            identification_type=payload.get("identification_type") or "national_id",
            identification_number=identification_number or external_reference,
            email=payload.get("email"),
            date_of_birth=payload.get("date_of_birth"),
            gender=payload.get("gender"),
            marital_status=payload.get("marital_status"),
            source=PartyDataSource.EXTERNAL,
            external_reference=external_reference,
        )
        if created_by is not None:
            individual.created_by = created_by
            individual.updated_by = created_by
        individual.save()

        phone = _extract_phone(payload)
        if phone:
            IndividualContactDetail.objects.create(
                individual=individual,
                type="mobile",
                phone_number=phone,
            )

    return individual
