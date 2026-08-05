"""Serializers for managed PartyType / BaseAssetType / AssetCondition options."""

from __future__ import annotations

import re

from rest_framework import serializers

from apps.common.models import LookupOption


class LookupOptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = LookupOption
        fields = [
            "id",
            "category",
            "value",
            "label",
            "is_system",
            "is_active",
            "sort_order",
        ]
        read_only_fields = ["id", "is_system"]

    def validate_category(self, value: str) -> str:
        allowed = {
            LookupOption.CATEGORY_PARTY_TYPE,
            LookupOption.CATEGORY_BASE_ASSET_TYPE,
            LookupOption.CATEGORY_ASSET_CONDITION,
            LookupOption.CATEGORY_COLLATERAL_ASSET_CATEGORY,
            LookupOption.CATEGORY_INDUSTRY,
        }
        if value not in allowed:
            raise serializers.ValidationError(
                "Category must be PartyType, BaseAssetType, "
                "AssetCondition, CollateralAssetCategory, or Industry."
            )
        return value

    def validate_value(self, value: str) -> str:
        normalized = (value or "").strip().lower().replace(" ", "_")
        if not re.fullmatch(r"[a-z][a-z0-9_]*", normalized):
            raise serializers.ValidationError(
                "Value must start with a letter and contain only lowercase "
                "letters, digits, and underscores."
            )
        return normalized

    def validate(self, attrs):
        category = attrs.get("category") or getattr(self.instance, "category", None)
        value = attrs.get("value") or getattr(self.instance, "value", None)
        if category and value:
            qs = LookupOption.objects.filter(category=category, value=value)
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.exists():
                raise serializers.ValidationError(
                    {
                        "value": (
                            "An option with this value already exists in this category."
                        )
                    }
                )
        return attrs

    def create(self, validated_data):
        validated_data["is_system"] = False
        return super().create(validated_data)
