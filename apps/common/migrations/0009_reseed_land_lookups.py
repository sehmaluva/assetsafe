"""Reseed land lookup options and invalidate common choices cache."""

from django.db import migrations


def reseed_land_lookups(apps, schema_editor):
    from apps.common.utils.seed_lookups import seed_system_lookup_options
    from apps.common.utils.lookups import invalidate_common_choices_cache

    seed_system_lookup_options(LookupOption=apps.get_model("common", "LookupOption"))
    invalidate_common_choices_cache()


class Migration(migrations.Migration):

    dependencies = [
        ("common", "0008_typed_asset_registry"),
    ]

    operations = [
        migrations.RunPython(reseed_land_lookups, migrations.RunPython.noop),
    ]
