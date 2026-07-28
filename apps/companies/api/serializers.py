# apps/companies/api/serializers.py
from rest_framework import serializers
from django.contrib.contenttypes.models import ContentType
from apps.companies.models.models import (
    Company,
    CompanyBranch,
    ContactPerson,
    CompanyProfile,
)
from apps.common.models.models import Address, Document, Note, PartyDataSource
from apps.common.api.serializers import (
    AddressSerializer,
    DocumentSerializer,
    NoteSerializer,
    AddressCreateSerializer,
)
from apps.common.utils import normalize_zimbabwe_mobile, validate_email
from apps.individuals.utils.helpers import create_address_helper
from django.db.models import Q
import logging
from django.db import transaction

# # from apps.legal.api.serializers.claim_serializers import ClaimMinimalSerializer
# from apps.legal.models.claims import Claim

# from apps.legal.api.serializers.claim_serializers import ClaimMinimalSerializer
# from apps.legal.models.claims import Claim

logger = logging.getLogger(__name__)


class MinimalContactPersonSerializer(serializers.ModelSerializer):
    """Minimal serializer for ContactPerson model"""

    full_contact = serializers.CharField(source="full_contact_info", read_only=True)

    class Meta:
        model = ContactPerson
        fields = ["id", "full_contact"]
        read_only_fields = ["id", "full_contact"]


class ContactPersonSerializer(serializers.ModelSerializer):
    """Serializer for ContactPerson model (now writable for nested ops)"""

    individual_name = serializers.SerializerMethodField(read_only=True)
    contact_type_display = serializers.CharField(
        source="get_contact_type_display", read_only=True
    )
    full_contact = serializers.CharField(source="full_contact_info", read_only=True)

    class Meta:
        model = ContactPerson
        fields = [
            "id",
            "branch",
            "individual",
            "individual_name",
            "contact_type",
            "contact_type_display",
            "is_primary",
            "position",
            "full_contact",
        ]
        read_only_fields = ["id", "individual_name", "contact_type_display", "branch"]

    def validate(self, attrs):
        return super().validate(attrs)

    def get_individual_name(self, obj):
        if obj.individual:
            return f"{obj.individual.first_name} {obj.individual.last_name}"
        return None


class CompanyBranchSerializer(serializers.ModelSerializer):
    """Base serializer for CompanyBranch model (now handles contacts)"""

    addresses = AddressCreateSerializer(many=True, required=False)
    contacts = ContactPersonSerializer(many=True, required=False, write_only=True)

    class Meta:
        model = CompanyBranch
        fields = [
            "id",
            "company",
            "branch_name",
            "addresses",
            "contacts",
            "is_headquarters",
            "email",
            "phone",
        ]

    def validate(self, attrs):
        if attrs.get("phone") and not normalize_zimbabwe_mobile(attrs.get("phone")):
            raise serializers.ValidationError("Invalid Zimbabwean phone number format.")
        if attrs.get("email") and not validate_email(attrs.get("email")):
            raise serializers.ValidationError("Invalid email format.")
        if CompanyBranch.objects.filter(
            Q(phone=attrs.get("phone")) | Q(email=attrs.get("email")), is_deleted=False
        ).exists():
            raise serializers.ValidationError(
                "A branch with this phone number or email already exists."
            )
        return super().validate(attrs)

    def create(self, validated_data):
        address_data = validated_data.pop("addresses", [])
        contacts_data = validated_data.pop("contacts", [])
        request = self.context.get("request")
        validated_data["phone"] = normalize_zimbabwe_mobile(
            validated_data.get("phone", None)
        )

        with transaction.atomic():
            branch = CompanyBranch.objects.create(**validated_data)
            company_branch_content_type = ContentType.objects.get_for_model(
                CompanyBranch
            )
            create_address_helper(company_branch_content_type, address_data, branch.id)
            for i, contact_data in enumerate(contacts_data):
                try:
                    ContactPerson.objects.create(branch=branch, **contact_data)
                    logger.debug(
                        f"CREATE: Contact {i} created for branch {branch.id}: {contact_data}"
                    )
                except Exception as e:
                    logger.error(
                        f"CREATE: Error creating contact {i} for branch {branch.id}: {str(e)} - Data: {contact_data}"
                    )
                    raise

        return branch

    def update(self, instance, validated_data):
        addresses_data = validated_data.pop("addresses", None)
        contacts_data = validated_data.pop("contacts", None)
        branch_content_type = ContentType.objects.get_for_model(CompanyBranch)
        request = self.context.get("request")
        instance = super().update(instance, validated_data)

        if addresses_data is not None:
            create_address_helper(branch_content_type, addresses_data, instance.id)

        if contacts_data is not None:
            instance.contacts.all().delete()

            for i, contact_data in enumerate(contacts_data):
                try:
                    ContactPerson.objects.create(branch=instance, **contact_data)
                except Exception as e:
                    logger.error(
                        f"UPDATE: Error creating contact {i} for branch {instance.id}: {str(e)} - Data: {contact_data}"
                    )
                    raise

        return instance


class CompanyProfileSerializer(serializers.ModelSerializer):
    """Serializer for CompanyProfile model"""

    trading_status_display = serializers.CharField(
        source="get_trading_status_display", read_only=True
    )
    trend_display = serializers.CharField(source="get_trend_display", read_only=True)
    risk_class_display = serializers.CharField(
        source="get_risk_class_display", read_only=True
    )
    is_under_judicial_display = serializers.CharField(
        source="get_is_under_judicial_display", read_only=True
    )
    contact_person = ContactPersonSerializer(read_only=True)

    class Meta:
        model = CompanyProfile
        fields = [
            "trading_status",
            "trading_status_display",
            "mobile_phone",
            "landline_phone",
            "email",
            "logo",
            "registration_date",
            "tin_number",
            "vat_number",
            "number_of_employees",
            "website",
            "trend",
            "trend_display",
            "twitter",
            "facebook",
            "instagram",
            "linkedin",
            "operations",
            "contact_person",
            "risk_class",
            "risk_class_display",
            "account_number",
            "is_under_judicial",
            "is_under_judicial_display",
            "is_suspended",
        ]

    def update(self, instance, validated_data):
        """Update profile instance with validated data"""
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        return instance


class CompanyMinimalSerializer(serializers.ModelSerializer):
    """Minimal serializer for company data in branch context"""

    legal_status_display = serializers.CharField(
        source="get_legal_status_display", read_only=True
    )

    class Meta:
        model = Company
        fields = [
            "id",
            "registration_number",
            "registration_name",
            "trading_name",
            "legal_status",
            "legal_status_display",
            "is_verified",
            "source",
            "external_reference",
        ]


class CompanyDetailSerializer(serializers.ModelSerializer):
    """Detailed serializer for full company data"""

    legal_status_display = serializers.CharField(
        source="get_legal_status_display", read_only=True
    )
    addresses = AddressSerializer(many=True, read_only=True)
    branches = CompanyBranchSerializer(many=True, read_only=True)
    profile = CompanyProfileSerializer(read_only=True)

    class Meta:
        model = Company
        fields = [
            "id",
            "registration_number",
            "registration_name",
            "trading_name",
            "legal_status",
            "legal_status_display",
            "date_of_incorporation",
            "industry",
            "is_verified",
            "is_active",
            "source",
            "external_reference",
            "addresses",
            "branches",
            "profile",
            "date_created",
            "date_updated",
        ]


class CompanyCreateSerializer(serializers.ModelSerializer):
    """Serializer for creating companies with addresses and profile"""

    addresses = AddressCreateSerializer(many=True, required=False)
    documents = DocumentSerializer(many=True, required=False)
    notes = NoteSerializer(many=True, required=False)
    profile = CompanyProfileSerializer(required=False)

    class Meta:
        model = Company
        fields = [
            "registration_number",
            "registration_name",
            "trading_name",
            "legal_status",
            "date_of_incorporation",
            "industry",
            "addresses",
            "documents",
            "notes",
            "profile",
        ]

    def validate(self, attrs):
        registration_number = attrs.get("registration_number")
        if (
            registration_number
            and Company.objects.filter(registration_number=registration_number).exists()
        ):
            raise serializers.ValidationError(
                "A company with this registration number already exists."
            )
        registartion_name = attrs.get("registration_name")
        trading_name = attrs.get("trading_name")
        if (
            registartion_name
            and Company.objects.filter(
                Q(registration_name=registartion_name) | Q(trading_name=trading_name)
            ).exists()
        ):
            raise serializers.ValidationError(
                "A company with this registration/trading name already exists."
            )
        return super().validate(attrs)

    @transaction.atomic
    def create(self, validated_data):
        addresses_data = validated_data.pop("addresses", [])
        profile_data = validated_data.pop("profile", None)
        documents_data = validated_data.pop("documents", [])
        notes_data = validated_data.pop("notes", [])
        user = self.context.get("user")
        validated_data.setdefault("source", PartyDataSource.INTERNAL)
        company = Company.objects.create(**validated_data)
        company_content_type = ContentType.objects.get_for_model(Company)

        # Creating addresses
        create_address_helper(company_content_type, addresses_data, company.id)
        # Creating documents
        for document_data in documents_data:
            Document.objects.create(
                content_type=company_content_type, object_id=company.id, **document_data
            )

        # Creating notes
        for note_data in notes_data:
            Note.objects.create(
                author=user,
                content_type=company_content_type,
                object_id=company.id,
                **note_data,
            )

        if profile_data:
            CompanyProfile.objects.create(company=company, **profile_data)

        company.auto_create_hq_branch()

        return company


class CompanyUpdateSerializer(serializers.ModelSerializer):
    """Serializer for updating companies"""

    addresses = AddressSerializer(many=True, required=False)
    profile = CompanyProfileSerializer(required=False)

    class Meta:
        model = Company
        fields = [
            "registration_number",
            "registration_name",
            "trading_name",
            "legal_status",
            "date_of_incorporation",
            "industry",
            "is_verified",
            "is_active",
            "addresses",
            "profile",
        ]

    @transaction.atomic
    def update(self, instance, validated_data):
        user = self.context.get("user")
        addresses_data = validated_data.pop("addresses", None)
        profile_data = validated_data.pop("profile", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        if addresses_data is not None:
            company_content_type = ContentType.objects.get_for_model(Company)

            instance.addresses.all().delete()

            for address_data in addresses_data:
                Address.objects.create(
                    content_type=company_content_type,
                    object_id=instance.id,
                    **address_data,
                )

        if profile_data is not None:
            try:
                profile = CompanyProfile.objects.get(company=instance)

                for attr, value in profile_data.items():
                    setattr(profile, attr, value)
                profile.save()

            except CompanyProfile.DoesNotExist:
                CompanyProfile.objects.create(company=instance, **profile_data)

        return instance


class CompanyBranchMinimalSerializer(serializers.ModelSerializer):
    """Minimal serializer for company branch data"""

    company = CompanyMinimalSerializer(read_only=True)
    address_summary = serializers.CharField(source="primary_address", read_only=True)
    primary_address = AddressSerializer(read_only=True)

    class Meta:
        model = CompanyBranch
        fields = [
            "id",
            "branch_name",
            "is_headquarters",
            "company",
            "email",
            "phone",
            "address_summary",
            "primary_address",
        ]
        read_only_fields = ["id", "company", "address_summary"]


class CompanyBranchSearchSerializer(serializers.ModelSerializer):
    """Serializer for company branch search results"""

    company = CompanyMinimalSerializer(read_only=True)
    primary_address = serializers.SerializerMethodField()

    class Meta:
        model = CompanyBranch
        fields = ["id", "branch_name", "is_headquarters", "company", "primary_address"]

    def get_primary_address(self, obj):
        """Get the primary address for this branch"""
        primary_address = obj.addresses.filter(
            address_type="physical", is_primary=True
        ).first()
        return AddressSerializer(primary_address).data if primary_address else None


class CompanyBranchDetailSerializer(serializers.ModelSerializer):
    """Detailed serializer for full branch data"""

    company = CompanyMinimalSerializer(read_only=True)
    contacts = MinimalContactPersonSerializer(many=True, read_only=True)
    primary_address = serializers.SerializerMethodField()
    profile = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = CompanyBranch
        fields = [
            "id",
            "branch_name",
            "is_headquarters",
            "is_deleted",
            "company",
            "contacts",
            "primary_address",
            "profile",
            "date_created",
            "date_updated",
            "email",
            "phone",
        ]

    def get_primary_address(self, obj):
        """Get the primary address for this branch"""
        primary_address = obj.addresses.filter(
            address_type="physical",
        ).first()
        return AddressSerializer(primary_address).data if primary_address else None

    def get_profile(self, obj):
        """Get the profile for this branch's company"""
        try:
            return CompanyProfileSerializer(obj.company.profile).data
        except CompanyProfile.DoesNotExist:
            return None


class CompanyBranchLeaseDetailSerializer(serializers.ModelSerializer):
    """Detailed serializer for full branch data"""

    company = CompanyMinimalSerializer(read_only=True)
    contacts = MinimalContactPersonSerializer(many=True, read_only=True)
    primary_address = serializers.SerializerMethodField()

    class Meta:
        model = CompanyBranch
        fields = [
            "id",
            "branch_name",
            "is_headquarters",
            "company",
            "contacts",
            "primary_address",
            "email",
            "phone",
        ]

    def get_primary_address(self, obj):
        """Get the primary address for this branch"""
        primary_address = obj.addresses.filter(
            address_type="physical",
        ).first()
        return AddressSerializer(primary_address).data if primary_address else None


# class CompanyClaimSerializer(serializers.ModelSerializer):
#     claims = serializers.SerializerMethodField()
#     company = CompanyMinimalSerializer(read_only=True)

#     class Meta:
#         model = CompanyBranch
#         fields = ["id", "company", "claims"]

#     def get_claims(self, obj):
#         claim_qs = Claim.objects.filter(
#             debtor_content_type__model="companybranch",
#             debtor_object_id=obj.id,
#             is_verified=True,
#         ).select_related("client", "currency", "debtor_content_type")

#         if claim_qs.exists():
#             return ClaimMinimalSerializer(claim_qs, many=True).data
#         return []
