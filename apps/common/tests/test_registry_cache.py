"""Tests for registry response-cache invalidation and user-scoped keys."""

from __future__ import annotations

from datetime import date
from hashlib import md5
from unittest.mock import MagicMock

from django.contrib.contenttypes.models import ContentType
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils.encoding import force_bytes
from rest_framework.response import Response
from rest_framework.test import APIRequestFactory

from apps.asset_management.models.models import AssetRegistration
from apps.clients.models.models import Client
from apps.common.utils.caching import CacheService
from apps.common.utils.registry_cache import (
    ASSET_REGISTRY,
    COLLATERAL_REGISTRY,
    HIRE_PURCHASE_REGISTRY,
    invalidate_registry_caches,
)
from apps.individuals.models.models import Individual

LOC_MEM_CACHE = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "registry-cache-tests",
        "TIMEOUT": 300,
    }
}


def _list_tag(registry: str) -> str:
    return f"{registry}:list"


@override_settings(CACHES=LOC_MEM_CACHE)
class RegistryCacheInvalidationTest(TestCase):
    """Version-tag bumps when registry rows and related parties change."""

    def setUp(self):
        cache.clear()

    def test_asset_registration_save_bumps_asset_list_version(self):
        before = CacheService._get_version(_list_tag(ASSET_REGISTRY))

        today = date.today()
        AssetRegistration.objects.create(
            owner_type="individual",
            asset_category="equipment",
            estimated_value=1000,
            location_address="123 Main St",
            subscription_start_date=today,
            subscription_end_date=date(today.year + 1, today.month, today.day),
        )

        after = CacheService._get_version(_list_tag(ASSET_REGISTRY))
        self.assertNotEqual(before, after)

    def test_individual_save_cascades_to_all_registry_list_versions(self):
        individual = Individual.objects.create(
            first_name="Jane",
            last_name="Doe",
            identification_type="national_id",
            identification_number="ID-REG-CACHE-001",
        )
        cache.clear()

        before = {
            ASSET_REGISTRY: CacheService._get_version(_list_tag(ASSET_REGISTRY)),
            HIRE_PURCHASE_REGISTRY: CacheService._get_version(
                _list_tag(HIRE_PURCHASE_REGISTRY)
            ),
            COLLATERAL_REGISTRY: CacheService._get_version(
                _list_tag(COLLATERAL_REGISTRY)
            ),
        }

        individual.first_name = "Janet"
        individual.save()

        for registry in (ASSET_REGISTRY, HIRE_PURCHASE_REGISTRY, COLLATERAL_REGISTRY):
            self.assertNotEqual(
                before[registry],
                CacheService._get_version(_list_tag(registry)),
            )

    def test_client_save_bumps_hp_and_collateral_list_only(self):
        individual = Individual.objects.create(
            first_name="Fin",
            last_name="ancier",
            identification_type="national_id",
            identification_number="ID-REG-CACHE-002",
        )
        content_type = ContentType.objects.get_for_model(Individual)
        client = Client.objects.create(
            client_content_type=content_type,
            client_object_id=individual.pk,
            client_type="CLIENT",
        )
        cache.clear()

        before = {
            ASSET_REGISTRY: CacheService._get_version(_list_tag(ASSET_REGISTRY)),
            HIRE_PURCHASE_REGISTRY: CacheService._get_version(
                _list_tag(HIRE_PURCHASE_REGISTRY)
            ),
            COLLATERAL_REGISTRY: CacheService._get_version(
                _list_tag(COLLATERAL_REGISTRY)
            ),
        }

        client.name = "Updated Financier Name"
        client.save()

        self.assertEqual(
            before[ASSET_REGISTRY],
            CacheService._get_version(_list_tag(ASSET_REGISTRY)),
        )
        self.assertNotEqual(
            before[HIRE_PURCHASE_REGISTRY],
            CacheService._get_version(_list_tag(HIRE_PURCHASE_REGISTRY)),
        )
        self.assertNotEqual(
            before[COLLATERAL_REGISTRY],
            CacheService._get_version(_list_tag(COLLATERAL_REGISTRY)),
        )

    def test_invalidate_registry_caches_bumps_record_tag(self):
        record_pk = 42
        list_before = CacheService._get_version(_list_tag(ASSET_REGISTRY))
        record_before = CacheService._get_version(f"{ASSET_REGISTRY}:{record_pk}")

        invalidate_registry_caches(registries=[ASSET_REGISTRY], record_pk=record_pk)

        self.assertNotEqual(
            list_before, CacheService._get_version(_list_tag(ASSET_REGISTRY))
        )
        self.assertNotEqual(
            record_before, CacheService._get_version(f"{ASSET_REGISTRY}:{record_pk}")
        )


@override_settings(CACHES=LOC_MEM_CACHE)
class RegistryCacheVaryOnUserTest(TestCase):
    """User-scoped registry caches must not share entries across users."""

    def setUp(self):
        cache.clear()

    def test_vary_on_user_produces_distinct_cache_keys(self):
        factory = APIRequestFactory()

        class DummyView:
            def get_renderer_context(self):
                return {}

            @CacheService.cached(tag_prefix="hire-purchase:list", vary_on_user=True)
            def list(self, request, *args, **kwargs):
                return Response({"ok": True})

        view = DummyView()
        path = "/api/hire-purchase/"

        req1 = factory.get(path)
        req1.user = MagicMock(pk=1, client_id=10)
        req2 = factory.get(path)
        req2.user = MagicMock(pk=2, client_id=20)

        view.list(req1)
        view.list(req2)

        version = CacheService._get_version("hire-purchase:list")
        base1 = (
            f"view=DummyView.list,path={path},user=1,client=10"
        )
        base2 = (
            f"view=DummyView.list,path={path},user=2,client=20"
        )
        key1 = CacheService._generate_cache_key(
            md5(force_bytes(base1)).hexdigest(), version
        )
        key2 = CacheService._generate_cache_key(
            md5(force_bytes(base2)).hexdigest(), version
        )

        self.assertNotEqual(key1, key2)
        self.assertIsNotNone(cache.get(key1))
        self.assertIsNotNone(cache.get(key2))
