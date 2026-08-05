from django.core.management.base import BaseCommand

from apps.common.utils.seed_lookups import seed_system_lookup_options
from apps.common.utils.lookups import invalidate_industry_lookup_cache


class Command(BaseCommand):
    help = (
        "Upsert system LookupOption rows (PartyType, BaseAssetType, "
        "AssetCondition, CollateralAssetCategory, Industry) from code enums."
    )

    def handle(self, *args, **options):
        count = seed_system_lookup_options()
        invalidate_industry_lookup_cache()
        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded system lookup options for {count} categories."
            )
        )
