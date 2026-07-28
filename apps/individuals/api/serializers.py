from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from django.contrib.contenttypes.models import ContentType

from apps.common.models.models import Country, PartyDataSource
from apps.individuals.models.models import (
    Individual,
    EmploymentDetail,
    IndividualAccounts,
    NextOfKin,
    Note,
    Document,
    IndividualContactDetail,
)
from apps.common.api.serializers import (
    AddressSerializer,
    NoteSerializer,
    DocumentSerializer,
    AddressCreateSerializer,
)
from apps.common.utils.validators import (
    validate_email,
    normalize_zimbabwe_mobile,
    validate_national_id,
    validate_future_dates,
)
from apps.individuals.utils.helpers import (
    individual_account_details_helper,
    individual_notes_helper,
    create_address_helper,
    individual_contact_helper,
    individual_documents_helper,
    individual_next_of_kin_helper,
    individual_employment_details_helper,
)
from django.db import transaction
import logging
import re

# from apps.legal.api.serializers.claim_serializers import ClaimMinimalSerializer
# from apps.legal.models.claims import Claim


logger = logging.getLogger("individuals")


class EmploymentDetailSerializer(serializers.ModelSerializer):
    start_date = serializers.DateField(allow_null=True, required=False)
    end_date = serializers.DateField(allow_null=True, required=False)

    def to_internal_value(self, data):
        for field in ["start_date", "end_date"]:
            value = data.get(field)
            if value in ["", None]:
                data[field] = None
        return super().to_internal_value(data)

    class Meta:
        model = EmploymentDetail
        fields = [
            "id",
            "employer_name",
            "job_title",
            "start_date",
            "end_date",
            "is_current",
            "monthly_income",
            "industry",
        ]

    def validate(self, data):
        if email := data.get("email"):
            if validate_email(email):
                data["email"] = email
            else:
                raise ValidationError("Invalid employer email address provide")

        return data


class NextOfKinSerializer(serializers.ModelSerializer):
    relationship_display = serializers.CharField(
        source="get_relationship_display", read_only=True
    )

    class Meta:
        model = NextOfKin
        fields = [
            "id",
            "first_name",
            "last_name",
            "relationship",
            "relationship_display",
            "mobile_phone",
            "email",
            "physical_address",
        ]

    def validate(self, data):
        if mobile := data.get("mobile_phone"):
            if formatted := normalize_zimbabwe_mobile(mobile, "mobile"):
                data["mobile_phone"] = formatted
            else:
                raise ValidationError("Invalid phone number")

        if email := data.get("email"):

            if validate_email(email):
                data["email"] = email
            else:
                raise ValidationError("Invalid email address provided")

        return data


class ContactDetailsSerializer(serializers.ModelSerializer):

    class Meta:
        model = IndividualContactDetail
        fields = ["id", "type", "phone_number"]

    def validate(self, data):
        phone_number = data.get("phone_number", "")
        phone_type = data.get("type", "mobile")

        if phone_type == "other":
            raise serializers.SkipField()
        formatted = normalize_zimbabwe_mobile(phone_number, phone_type)
        if phone_number in ["", None]:
            raise ValidationError("Phone number is required")
        if not formatted:
            raise ValidationError(f"Invalid phone number provided: {phone_number}")

        def _get_parent_individual_id():
            parent = getattr(self, "parent", None)
            while parent is not None:
                inst = getattr(parent, "instance", None)
                if inst is not None:
                    return getattr(inst, "id", None) or getattr(inst, "pk", None)
                parent = getattr(parent, "parent", None)
            return None

        existing_contact = IndividualContactDetail.objects.filter(
            phone_number=formatted
        ).first()
        if existing_contact:
            current_individual_id = (
                getattr(self.instance, "individual_id", None)
                or _get_parent_individual_id()
            )
            if existing_contact.individual.id != current_individual_id:
                raise ValidationError(
                    "This phone number is already registered to another individual"
                )
            else:
                if existing_contact.type == phone_type:
                    raise ValidationError(
                        "Phone number already exists for this individual"
                    )
                else:
                    data["id"] = existing_contact.id
                    data["type"] = phone_type
                    data["phone_number"] = formatted
                    return data

        data["phone_number"] = formatted
        data["type"] = phone_type
        return data


class IndividualAccountsSerializer(serializers.ModelSerializer):
    class Meta:
        model = IndividualAccounts
        fields = ["id", "vat_number", "tin_number"]

    def validate(self, data):
        tin_number = data.get("tin_number", "").strip()
        vat_number = data.get("vat_number", "").strip()
        if IndividualAccounts.objects.filter(tin_number__iexact=tin_number).exists():
            raise ValidationError("This TIN number is already registered")
        if IndividualAccounts.objects.filter(vat_number__iexact=vat_number).exists():
            raise ValidationError("This VAT number is already registered")
        maximum_length = 20
        if len(tin_number) > maximum_length:
            raise ValidationError(
                f"TIN number cannot exceed {maximum_length} characters"
            )
        maximum_length = 20
        if len(vat_number) > maximum_length:
            raise ValidationError(
                f"VAT number cannot exceed {maximum_length} characters"
            )
        return data


class IndividualSerializer(serializers.ModelSerializer):
    employment_details = EmploymentDetailSerializer(many=True, required=False)
    next_of_kin = NextOfKinSerializer(many=True, required=False)
    gender_display = serializers.CharField(source="get_gender_display", read_only=True)
    identification_type_display = serializers.CharField(
        source="get_identification_type_display", read_only=True
    )
    addresses = AddressSerializer(many=True, required=True)
    notes = NoteSerializer(many=True, required=False)
    documents = DocumentSerializer(many=True, required=False)
    contact_details = ContactDetailsSerializer(
        many=True, required=False, read_only=True
    )
    account_details = IndividualAccountsSerializer(many=True, required=False)

    class Meta:
        model = Individual
        fields = [
            "id",
            "first_name",
            "last_name",
            "full_name",
            "date_of_birth",
            "gender",
            "gender_display",
            "marital_status",
            "identification_type",
            "identification_type_display",
            "identification_number",
            "contact_details",
            "email",
            "account_details",
            "is_verified",
            "is_active",
            "source",
            "external_reference",
            "employment_details",
            "next_of_kin",
            "documents",
            "addresses",
            "notes",
            "date_created",
            "date_updated",
        ]
        read_only_fields = ["date_created", "date_updated"]

    def to_representation(self, instance):
        representation = super().to_representation(instance)
        if representation.get("date_of_birth"):
            representation["date_of_birth"] = instance.date_of_birth.strftime(
                "%d-%b-%Y"
            )
        return representation


class IndividualMinimalSerializer(serializers.ModelSerializer):
    current_employment = serializers.SerializerMethodField()
    contact_details = ContactDetailsSerializer(many=True, required=True)
    addresses = serializers.SerializerMethodField()
    account_details = IndividualAccountsSerializer(many=True)

    class Meta:
        model = Individual
        fields = [
            "id",
            "first_name",
            "last_name",
            "identification_number",
            "gender",
            "date_of_birth",
            "marital_status",
            "email",
            "contact_details",
            "current_employment",
            "account_details",
            "addresses",
        ]

    def to_representation(self, instance):
        representation = super().to_representation(instance)
        if representation.get("date_of_birth"):
            representation["date_of_birth"] = instance.date_of_birth.strftime(
                "%d-%b-%Y"
            )
        return representation

    # Get the primary address
    def get_addresses(self, obj):
        if primary_address := obj.addresses.filter(is_primary=True).first():
            return AddressSerializer(primary_address).data
        # fallback: return first address if no primary is set
        if latest_address := obj.addresses.order_by("-id").first():
            return AddressSerializer(latest_address).data
        return None

    def get_current_employment(self, obj):
        if current_employment := obj.employment_details.filter(is_current=True).first():
            return EmploymentDetailSerializer(current_employment).data
        return None


class IndividualCreateSerializer(serializers.ModelSerializer):
    addresses = AddressCreateSerializer(many=True, required=True)
    employment_details = EmploymentDetailSerializer(many=True, required=False)
    next_of_kin = NextOfKinSerializer(many=True, required=False)
    contact_details = serializers.ListField(
        child=ContactDetailsSerializer(),
        required=False,
        allow_empty=True,
        write_only=True,
    )
    date_of_birth = serializers.DateField(allow_null=True, required=False)
    account_data = IndividualAccountsSerializer(many=False, required=False)
    phone = serializers.CharField(read_only=True)

    def to_internal_value(self, data):
        dob = data.get("date_of_birth")
        if dob in ["", None]:
            data["date_of_birth"] = None
        return super().to_internal_value(data)

    class Meta:
        model = Individual
        fields = [
            "id",
            "first_name",
            "last_name",
            "date_of_birth",
            "gender",
            "marital_status",
            "identification_type",
            "identification_number",
            "contact_details",
            "email",
            "addresses",
            "employment_details",
            "next_of_kin",
            "phone",
            "account_data",
        ]

    def get_phone(self, instance):
        contact = (
            instance.contact_details.filter(type="mobile").first()
            or instance.contact_details.filter(type="combined").first()
            or instance.contact_details.filter(type="whatsapp").first()
        )
        return contact.phone_number if contact else None

    def validate(self, data):
        id_type = data.get("identification_type")
        id_number = re.sub(r"[-\s]", "", data.get("identification_number", ""))
        dob = data.get("date_of_birth")
        addresses = data.get("addresses", [])
        email = data.get("email", "")
        if email:
            if Individual.objects.filter(email__iexact=email).exists():
                raise ValidationError("This email address is already registered")

            if validate_email(email):
                data["email"] = email
            else:
                raise ValidationError("Invalid email address provided")
        for address in addresses:
            street = address.get("street_address")
            suburb = address.get("suburb")

            if not street or not hasattr(suburb, "id") or not suburb.id:
                raise ValidationError(
                    "Each address must have a street address and suburb_id"
                )
        if id_type:
            if id_type == "national_id":
                if not id_number or not validate_national_id(id_number):
                    raise ValidationError("Invalid or missing national id")
            elif id_type == "passport":
                if not id_number:
                    raise ValidationError("Invalid or missing passport number")
                if not (5 <= len(id_number) <= 15):
                    raise ValidationError(
                        "Passport number must be between 5 and 15 characters"
                    )
            else:
                raise ValidationError("Invalid identification type provided")
        if self.context.get("request").method == "POST":
            for field in [
                "first_name",
                "last_name",
                "identification_number",
                "identification_type",
            ]:
                if not data.get(field):
                    raise ValidationError(
                        f"{field.replace('_', ' ').title()} is required"
                    )

        if dob is not None:
            if validate_future_dates(dob):
                data["date_of_birth"] = dob
            else:
                raise ValidationError(
                    "Invalid date of birth, Individual must be at least 18 years old."
                )
        existing = Individual.objects.filter(
            identification_number__iexact=id_number
        ).first()

        if existing and not existing.is_deleted:
            raise ValidationError(
                f"This identification number {id_number} is already registered and active."
            )
        else:
            self._existing_individual = existing

        return data

    @transaction.atomic
    def create(self, validated_data):
        validated_data["created_by"] = self.context["request"].user
        address_data = [
            {
                "street_address": addr.get("street_address"),
                "address_type": addr.get("address_type"),
                "line_2": addr.get("line_2"),
                "suburb": (
                    addr.get("suburb").instance
                    if hasattr(addr.get("suburb"), "instance")
                    else addr.get("suburb")
                ),
            }
            for addr in validated_data.pop("addresses", [])
        ]
        employment_data = validated_data.pop("employment_details", [])
        kin_data = validated_data.pop("next_of_kin", [])
        contact_data = validated_data.pop("contact_details", [])
        documents_data = validated_data.pop("documents", [])
        notes_data = validated_data.pop("notes", [])
        accounts_data = validated_data.pop("account_data", [])

        individual = getattr(self, "_existing_individual", None)
        validated_data.setdefault("source", PartyDataSource.INTERNAL)
        if individual:
            for attr, value in validated_data.items():
                setattr(individual, attr, value)
            individual.is_deleted = False
            individual.is_active = True
            individual.save()
        else:
            individual = Individual.objects.create(**validated_data)

        individual_ct = ContentType.objects.get_for_model(individual)
        create_address_helper(individual_ct, address_data, individual.pk)
        individual_documents_helper(individual_ct, documents_data, individual.pk)
        individual_notes_helper(individual_ct, notes_data, individual.pk)

        individual_contact_helper(individual, contact_data)
        individual_employment_details_helper(individual, employment_data)
        individual_next_of_kin_helper(individual, kin_data)
        individual_account_details_helper(individual, accounts_data)

        return individual

    @transaction.atomic
    def update(self, instance, validated_data):
        address_data = validated_data.pop("addresses", [])
        employment_data = validated_data.pop("employment_details", [])
        kin_data = validated_data.pop("next_of_kin", [])
        contact_data = validated_data.pop("contact_details", [])
        documents_data = validated_data.pop("documents", [])
        notes_data = validated_data.pop("notes", [])
        accounts_data = validated_data.pop("account_data", [])

        user = self.context.get("user")

        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        individual_ct = ContentType.objects.get_for_model(instance)

        create_address_helper(individual_ct, address_data, instance.pk)
        individual_documents_helper(individual_ct, documents_data, instance.pk)
        individual_notes_helper(individual_ct, notes_data, instance.pk)

        individual_contact_helper(instance, contact_data)
        individual_employment_details_helper(instance, employment_data)
        individual_next_of_kin_helper(instance, kin_data)
        individual_account_details_helper(instance, accounts_data)

        return instance


class IndividualSearchSerializer(serializers.ModelSerializer):
    """Serializer for searching individuals Retuning minimal fields"""

    class Meta:
        model = Individual
        fields = [
            "id",
            "first_name",
            "last_name",
            "identification_number",
            "phone",
            "email",
            "is_active",
            "source",
            "external_reference",
        ]


class IndividualAddressSerializer(serializers.ModelSerializer):
    primary_address = serializers.SerializerMethodField()

    class Meta:
        model = Individual
        fields = [
            "id",
            "first_name",
            "last_name",
            "identification_type",
            "identification_number",
            "email",
            "phone",
            "primary_address",
            "is_active",
        ]

    def get_primary_address(self, obj):
        if primary_address := obj.addresses.filter(
            is_primary=True, address_type="physical"
        ).first():
            return AddressSerializer(primary_address).data
        # fallback: return first address if no primary, physical is set
        if latest_address := obj.addresses.order_by("-id").first():
            return AddressSerializer(latest_address).data
        return None


# class IndividualClaimSerializer(serializers.ModelSerializer):
#     claims = serializers.SerializerMethodField()

#     class Meta:
#         model = Individual
#         fields = [
#             "id",
#             "identification_number",
#             "first_name",
#             "last_name",
#             "phone",
#             "claims",
#         ]

#     def get_claims(self, obj):
#         claim_qs = Claim.objects.filter(
#             debtor_content_type__model="individual",
#             debtor_object_id=obj.id,
#             is_verified=True,
#         ).select_related("client", "currency", "debtor_content_type")

#         if claim_qs.exists():
#             return ClaimMinimalSerializer(claim_qs, many=True).data
#         return []
