from django.contrib import admin

from apps.asset_management.models import (
    AssetOwnershipEvent,
    AssetRegistration,
    LandDetails,
    MobileDetails,
    StandSaleTransition,
    VehicleDetails,
)


class VehicleDetailsInline(admin.StackedInline):
    model = VehicleDetails
    extra = 0
    max_num = 1


class MobileDetailsInline(admin.StackedInline):
    model = MobileDetails
    extra = 0
    max_num = 1


class LandDetailsInline(admin.StackedInline):
    model = LandDetails
    extra = 0
    max_num = 1


@admin.register(AssetRegistration)
class AssetRegistrationAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "registration_number",
        "owner_display",
        "owner_type",
        "asset_category",
        "make",
        "model",
        "lodge_date",
    )
    list_filter = ("asset_category", "owner_type", "condition", "lodge_date")
    search_fields = (
        "registration_number",
        "individual_owner__first_name",
        "individual_owner__last_name",
        "individual_owner__identification_number",
        "company_owner__branch_name",
        "company_owner__company__registration_name",
        "company_owner__company__trading_name",
        "vehicle__mv_registration_number",
        "land__stand_number",
        "mobile__imei",
        "make",
        "model",
    )
    readonly_fields = (
        "registration_number",
        "lodge_date",
        "date_created",
        "date_updated",
        "created_by",
        "updated_by",
    )
    inlines = [VehicleDetailsInline, MobileDetailsInline, LandDetailsInline]
    fieldsets = (
        (
            "Registration",
            {"fields": ("registration_number", "lodge_date")},
        ),
        (
            "Owner Information",
            {
                "fields": (
                    "owner_type",
                    "individual_owner",
                    "company_owner",
                    "owner_asset_number",
                )
            },
        ),
        (
            "Asset Details",
            {
                "fields": (
                    "asset_category",
                    "asset_type",
                    "make",
                    "model",
                    "year_of_make",
                    "condition",
                )
            },
        ),
        (
            "General Identification",
            {
                "fields": (
                    "serial_number",
                    "currency",
                    "estimated_value",
                    "location_address",
                )
            },
        ),
        (
            "Subscription Window",
            {
                "fields": (
                    "subscription_start_date",
                    "subscription_end_date",
                )
            },
        ),
        (
            "Audit Timestamps",
            {
                "fields": (
                    "date_created",
                    "date_updated",
                    "created_by",
                    "updated_by",
                ),
                "classes": ("collapse",),
            },
        ),
    )

    @admin.display(description="Owner")
    def owner_display(self, obj: AssetRegistration) -> str:
        if obj.individual_owner:
            return str(obj.individual_owner)
        if obj.company_owner:
            return str(obj.company_owner)
        return "-"


@admin.register(StandSaleTransition)
class StandSaleTransitionAdmin(admin.ModelAdmin):
    list_display = (
        "asset",
        "purchaser_type",
        "sale_date",
        "terms",
        "is_completed",
    )
    list_filter = ("is_completed", "terms", "sale_date")


@admin.register(AssetOwnershipEvent)
class AssetOwnershipEventAdmin(admin.ModelAdmin):
    list_display = ("asset", "event_type", "date_created")
    list_filter = ("event_type",)
