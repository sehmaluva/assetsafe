from rest_framework import serializers

from apps.enquiries.models import AssetEnquiryLog, EnquiryKind
from apps.enquiries.services.enquiry import SearchField


class AssetEnquiryLogCreateSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=EnquiryKind.choices)
    requester_id = serializers.IntegerField(required=False, allow_null=True)
    client_id = serializers.IntegerField(required=False, allow_null=True)
    client_name = serializers.CharField(required=False, allow_blank=True, max_length=255)
    branch_label = serializers.CharField(
        required=False, allow_blank=True, max_length=255
    )

    def validate(self, attrs):
        if attrs.get("kind") == EnquiryKind.EXTERNAL:
            if not attrs.get("requester_id"):
                raise serializers.ValidationError(
                    {"requester_id": "Requester is required for external enquiries."}
                )
        return attrs


class AssetEnquiryLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = AssetEnquiryLog
        fields = [
            "id",
            "kind",
            "performed_by",
            "requester",
            "client",
            "client_name",
            "branch_label",
            "search_query",
            "search_field",
            "result_found",
            "date_created",
        ]
        read_only_fields = fields


class AssetEnquirySearchSerializer(serializers.Serializer):
    q = serializers.CharField(max_length=255)
    search_field = serializers.ChoiceField(
        choices=[
            "agreement_number",
            "serial_number",
            "registration_number",
            "chassis_number",
            "engine_number",
            "stand_number",
        ]
    )
    enquiry_log_id = serializers.IntegerField(required=False, allow_null=True)

    def validate_search_field(self, value: str) -> SearchField:
        return value  # type: ignore[return-value]


class AssetEnquiryReportQuerySerializer(serializers.Serializer):
    source = serializers.ChoiceField(
        choices=["collateral", "hire_purchase", "asset_registry"]
    )
    id = serializers.IntegerField(min_value=1)
