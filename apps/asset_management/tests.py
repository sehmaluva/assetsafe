"""Tests for typed asset registry models and stand workflows."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APITestCase

from apps.asset_management.models import (
    AssetRegistration,
    LandDetails,
    MobileDetails,
    VehicleDetails,
)
from apps.asset_management.services.stand_workflows import (
    record_ownership_change,
    record_sale_transition,
)
from apps.common.models import BaseAssetType, Currency
from apps.common.models.models import City, Country, Province, Suburb
from apps.common.utils.seed_lookups import seed_system_lookup_options
from apps.companies.models.models import Company, CompanyBranch
from apps.enquiries.services.enquiry import build_asset_report, search_assets
from apps.individuals.models.models import Individual

User = get_user_model()


class TypedAssetRegistryTestCase(TestCase):
    def setUp(self):
        seed_system_lookup_options()
        self.user = User.objects.create_user(
            username="admin",
            email="admin@test.com",
            password="pass",
            is_staff=True,
            is_superuser=True,
        )
        self.currency = Currency.objects.create(code="USD", name="US Dollar", symbol="$")
        self.owner = Individual.objects.create(
            first_name="George",
            last_name="Seller",
            identification_type="national_id",
            identification_number="63849580R63",
        )
        self.buyer = Individual.objects.create(
            first_name="Farai",
            last_name="Buyer",
            identification_type="national_id",
            identification_number="55112233R44",
        )
        country = Country.objects.create(
            name="Zimbabwe",
            code="ZWE",
            dial_code="+263",
            currency_code="USD",
            currency_name="US Dollar",
        )
        province = Province.objects.create(
            country=country,
            name="Harare",
            code="HAR",
        )
        self.city = City.objects.create(province=province, name="Harare")
        self.suburb = Suburb.objects.create(city=self.city, name="Eastview")
        today = date.today()
        self.dates = {
            "subscription_start_date": today,
            "subscription_end_date": today + timedelta(days=365),
        }

    def _create_land_asset(self, stand_number: str = "1145") -> AssetRegistration:
        asset = AssetRegistration.objects.create(
            owner_type="individual",
            individual_owner=self.owner,
            asset_category=BaseAssetType.LAND,
            asset_type="Stand",
            estimated_value=Decimal("25000.00"),
            currency=self.currency,
            location_address="",
            **self.dates,
            created_by=self.user,
            updated_by=self.user,
        )
        LandDetails.objects.create(
            asset=asset,
            city=self.city,
            suburb=self.suburb,
            stand_number=stand_number,
            stand_size="1200",
            valuation_type="estimated_value",
            title_status="deeds",
            created_by=self.user,
            updated_by=self.user,
        )
        return asset

    def test_vehicle_nested_details(self):
        asset = AssetRegistration.objects.create(
            owner_type="individual",
            individual_owner=self.owner,
            asset_category=BaseAssetType.VEHICLES,
            asset_type="Sedan",
            make="Toyota",
            model="Corolla",
            estimated_value=Decimal("5000"),
            currency=self.currency,
            location_address="123 St",
            **self.dates,
        )
        VehicleDetails.objects.create(
            asset=asset,
            mv_registration_number="ABC1234",
            chassis_number="CH123",
            engine_number="EN456",
        )
        vehicle = VehicleDetails.objects.get(asset=asset)
        self.assertEqual(vehicle.mv_registration_number, "ABC1234")

    def test_land_uniqueness(self):
        self._create_land_asset("1145")
        asset2 = AssetRegistration.objects.create(
            owner_type="individual",
            individual_owner=self.owner,
            asset_category=BaseAssetType.LAND,
            asset_type="Stand",
            estimated_value=Decimal("10000"),
            currency=self.currency,
            location_address="",
            **self.dates,
        )
        with self.assertRaises(Exception):
            LandDetails.objects.create(
                asset=asset2,
                city=self.city,
                suburb=self.suburb,
                stand_number="1145",
                stand_size="900",
                valuation_type="estimated_value",
                title_status="deeds",
            )

    def test_sale_transition_keeps_owner(self):
        asset = self._create_land_asset()
        record_sale_transition(
            asset,
            purchaser_type="individual",
            individual_purchaser=self.buyer,
            company_purchaser=None,
            sale_date=date.today(),
            terms="cash",
            valuation_type="estimated_value",
            title_status="deeds",
            currency=self.currency,
            value_amount=Decimal("25000"),
            user=self.user,
        )
        asset.refresh_from_db()
        self.assertEqual(asset.individual_owner_id, self.owner.pk)
        self.assertIsNotNone(asset.get_open_sale_transition())

    def test_ownership_change_updates_owner_and_closes_sale(self):
        asset = self._create_land_asset()
        record_sale_transition(
            asset,
            purchaser_type="individual",
            individual_purchaser=self.buyer,
            company_purchaser=None,
            sale_date=date.today(),
            terms="cash",
            valuation_type="estimated_value",
            title_status="deeds",
            currency=self.currency,
            value_amount=Decimal("25000"),
            user=self.user,
        )
        record_ownership_change(
            asset,
            owner_type="individual",
            individual_owner=self.buyer,
            company_owner=None,
            user=self.user,
        )
        asset.refresh_from_db()
        self.assertEqual(asset.individual_owner_id, self.buyer.pk)
        self.assertIsNone(asset.get_open_sale_transition())

    def test_enquiry_stand_search_and_sold_report(self):
        asset = self._create_land_asset()
        record_sale_transition(
            asset,
            purchaser_type="individual",
            individual_purchaser=self.buyer,
            company_purchaser=None,
            sale_date=date(2026, 8, 3),
            terms="cash",
            valuation_type="estimated_value",
            title_status="deeds",
            currency=self.currency,
            value_amount=Decimal("25000"),
            user=self.user,
        )
        hits = search_assets("1145", "stand_number")
        self.assertTrue(any(h.record_id == asset.pk for h in hits))
        report = build_asset_report("asset_registry", asset.pk, unmasked=False)
        self.assertEqual(report["status"], "sold")
        self.assertTrue(report["is_land"])
        self.assertEqual(report["stand_number"], "1145")
        self.assertIsNotNone(report["purchaser_masked"])
        self.assertEqual(report["sale_date"], "03-Aug-26")


class TypedAssetRegistryAPITest(APITestCase):
    def setUp(self):
        seed_system_lookup_options()
        self.user = User.objects.create_user(
            username="staff",
            email="staff@test.com",
            password="pass",
            is_staff=True,
            is_superuser=True,
        )
        self.client.force_authenticate(user=self.user)
        self.currency = Currency.objects.create(code="USD", name="US Dollar", symbol="$")
        self.owner = Individual.objects.create(
            first_name="Reg",
            last_name="Harris",
            identification_type="national_id",
            identification_number="ID123456",
        )
        country = Country.objects.create(
            name="Zimbabwe",
            code="ZWE",
            dial_code="+263",
            currency_code="USD",
            currency_name="US Dollar",
        )
        province = Province.objects.create(country=country, name="Harare", code="HAR")
        self.city = City.objects.create(province=province, name="Harare")
        self.suburb = Suburb.objects.create(city=self.city, name="Graylands")
        today = date.today()

        payload = {
            "owner_type": "individual",
            "individual_owner": self.owner.pk,
            "company_owner": None,
            "asset_category": "land",
            "asset_type": "Stand",
            "currency": "USD",
            "estimated_value": "25000.00",
            "subscription_start_date": today.isoformat(),
            "subscription_end_date": (today + timedelta(days=365)).isoformat(),
            "land": {
                "suburb": self.suburb.pk,
                "stand_address": "Plot 1",
                "stand_number": "290",
                "stand_size": "2500",
                "valuation_type": "estimated_value",
                "title_status": "deeds",
            },
        }
        response = self.client.post("/api/asset-management/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        body = response.json()
        self.asset_id = (body.get("data") or body)["id"]

    def test_create_land_asset_via_api(self):
        response = self.client.get(f"/api/asset-management/{self.asset_id}/")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json().get("data") or response.json()
        self.assertEqual(data["asset_category"], "land")
        self.assertEqual(data["land"]["stand_number"], "290")

    def test_vehicle_payload_nested(self):
        today = date.today()
        payload = {
            "owner_type": "individual",
            "individual_owner": self.owner.pk,
            "company_owner": None,
            "asset_category": "vehicles",
            "asset_type": "SUV",
            "make": "Toyota",
            "model": "Fortuner",
            "year_of_make": 2020,
            "condition": "second_hand",
            "currency": "USD",
            "estimated_value": "30000.00",
            "location_address": "Harare",
            "subscription_start_date": today.isoformat(),
            "subscription_end_date": (today + timedelta(days=365)).isoformat(),
            "vehicle": {
                "mv_registration_number": "AEF1234",
                "chassis_number": "CH999",
                "engine_number": "EN888",
            },
        }
        response = self.client.post("/api/asset-management/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        body = response.json()
        asset_id = (body.get("data") or body)["id"]
        detail = self.client.get(f"/api/asset-management/{asset_id}/")
        detail_data = detail.json().get("data") or detail.json()
        self.assertEqual(detail_data["vehicle"]["mv_registration_number"], "AEF1234")

    def test_mobile_payload_nested(self):
        today = date.today()
        payload = {
            "owner_type": "individual",
            "individual_owner": self.owner.pk,
            "company_owner": None,
            "asset_category": "mobiles",
            "asset_type": "Smartphone",
            "make": "Samsung",
            "model": "Galaxy",
            "year_of_make": 2024,
            "condition": "new",
            "currency": "USD",
            "estimated_value": "800.00",
            "location_address": "Harare",
            "subscription_start_date": today.isoformat(),
            "subscription_end_date": (today + timedelta(days=365)).isoformat(),
            "mobile": {"imei": "356938035643809"},
        }
        response = self.client.post("/api/asset-management/", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        body = response.json()
        asset_id = (body.get("data") or body)["id"]
        detail = self.client.get(f"/api/asset-management/{asset_id}/")
        detail_data = detail.json().get("data") or detail.json()
        self.assertEqual(detail_data["mobile"]["imei"], "356938035643809")
