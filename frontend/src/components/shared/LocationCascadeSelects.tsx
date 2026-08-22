import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { locationsApi } from '@/api/locationsApi';
import type {
  CityOption,
  CountryOption,
  SuburbOption,
} from '@/api/locationsApi';
import { FieldError } from './FieldError';
import {
  formControlClassName,
  formFieldWrapperClassName,
  formLabelClassName,
} from '@/lib/formFieldStyles';

interface Props {
  value?: number;
  onChange: (suburbId: number) => void;
  error?: string;
  /** Stand registration (1416): City/Town → Suburb/Area/Development, hide Country */
  variant?: 'default' | 'stand';
  hideCountry?: boolean;
  suburbLabel?: string;
  cityLabel?: string;
  suburbRequired?: boolean;
}

// ─── Generic searchable combobox ──────────────────────────────────────────────

interface ComboboxProps<T extends { id: number; name: string }> {
  label: string;
  required?: boolean;
  placeholder: string;
  options: T[];
  selected: T | null;
  onSelect: (item: T | null) => void;
  error?: string;
  isLoading?: boolean;
}

function Combobox<T extends { id: number; name: string }>({
  label,
  required,
  placeholder,
  options,
  selected,
  onSelect,
  error,
  isLoading,
}: ComboboxProps<T>) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Keep display text in sync when selection is set externally (auto-populate)
  useEffect(() => {
    setQuery(selected?.name ?? '');
  }, [selected]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = query.trim()
    ? options.filter((o) =>
        o.name.toLowerCase().includes(query.toLowerCase().trim()),
      )
    : options;

  return (
    <div ref={ref} className={formFieldWrapperClassName}>
      <label className={formLabelClassName}>
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      <div className="relative">
        <input
          value={query}
          placeholder={placeholder}
          autoComplete="off"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            const val = e.target.value;
            setQuery(val);
            setOpen(true);
            // Only propagate a deselect when the field is fully cleared.
            // Typing must NOT clear downstream selections.
            if (val === '') onSelect(null);
          }}
          className={formControlClassName({ error: Boolean(error) })}
        />
        {open && (
          <div className="absolute left-0 top-full z-[70] mt-1 max-h-52 w-full overflow-auto rounded border border-slate-300 bg-white shadow-md">
          {isLoading ? (
            <p className="px-3 py-2 text-sm text-slate-400">Loading...</p>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-2 text-sm text-slate-400">No results</p>
          ) : (
            filtered.map((item) => (
              <button
                key={item.id}
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-100"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onSelect(item);
                  setOpen(false);
                }}
              >
                {item.name}
              </button>
            ))
          )}
        </div>
        )}
      </div>
      <FieldError message={error} />
    </div>
  );
}

// ─── LocationCascadeSelects ───────────────────────────────────────────────────

const STATIC = { staleTime: Infinity, gcTime: Infinity, retry: false } as const;

function sorted<T extends { name: string }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => a.name.localeCompare(b.name));
}

export function LocationCascadeSelects({
  value,
  onChange,
  error,
  variant = 'default',
  hideCountry = false,
  suburbLabel: suburbLabelProp,
  cityLabel: cityLabelProp,
  suburbRequired = true,
}: Props) {
  const isStand = variant === 'stand';
  const suburbLabel =
    suburbLabelProp ?? (isStand ? 'Suburb/Area/Development' : 'Suburb');
  const cityLabel = cityLabelProp ?? (isStand ? 'City/Town' : 'City');
  const [country, setCountry] = useState<CountryOption | null>(null);
  const [city, setCity] = useState<CityOption | null>(null);
  const [suburb, setSuburb] = useState<SuburbOption | null>(null);

  // ── base data — loaded once on mount, cached forever ─────────────────────
  //
  // Four parallel fetches start immediately so data is ready before the user
  // opens any dropdown.
  //
  //  countries    → CountryOption[]                       always loaded
  //  allProvinces → ProvinceOption[]  province_name → country_name bridge
  //  allCities    → CityOption[]      province_name carried so we can map → country
  //  allSuburbs   → SuburbOption[]    from SuburbViewSet (/common/suburbs/)
  //                                   carries city_name + country_name strings

  const { data: countries = [], isLoading: loadingCountries } = useQuery({
    queryKey: ['loc-countries'],
    queryFn: locationsApi.getCountries,
    ...STATIC,
  });
  const { data: allProvinces = [] } = useQuery({
    queryKey: ['loc-provinces-all'],
    queryFn: locationsApi.getProvinces,
    ...STATIC,
  });
  const { data: allCities = [], isLoading: loadingCities } = useQuery({
    queryKey: ['loc-cities-all'],
    queryFn: () => locationsApi.getCities(),
    ...STATIC,
  });
  const { data: allSuburbs = [], isLoading: loadingSuburbs } = useQuery({
    queryKey: ['loc-suburbs-view'],
    queryFn: locationsApi.getAllSuburbsWithHierarchy,
    ...STATIC,
  });

  // ── filtered pools — one fetch per unique id, then cached forever ─────────

  const { data: citiesForCountry = [], isLoading: loadingCitiesForCountry } =
    useQuery({
      queryKey: ['loc-cities', country?.id],
      queryFn: () => locationsApi.getCities(country!.id),
      enabled: !!country,
      ...STATIC,
    });

  // suburbsForCity has city_id injected at the API layer — reliable auto-populate source.
  const { data: suburbsForCity = [], isLoading: loadingSuburbsForCity } =
    useQuery({
      queryKey: ['loc-suburbs', city?.id],
      queryFn: () => locationsApi.getSuburbs(city!.id),
      enabled: !!city,
      ...STATIC,
    });

  // ── lookup helpers ───────────────────────────────────────────────────────

  const findCountry = (name: string | undefined) =>
    name ? (countries.find((c) => c.name === name) ?? null) : null;

  const findCity = (name: string | undefined) =>
    name ? (allCities.find((c) => c.name === name) ?? null) : null;

  /** province_name → country_name via allProvinces */
  const countryNameForCity = (c: CityOption) =>
    allProvinces.find((p) => p.name === c.province_name)?.country_name;

  // ── reactive auto-populate ────────────────────────────────────────────────
  //
  // Effects run whenever the selection OR the backing data changes.
  // This means auto-populate will succeed even on slow connections where
  // allCities / allProvinces arrive after the user has already selected.

  // suburb selected → fill city (uses city_id when available, otherwise city_name match)
  useEffect(() => {
    if (!suburb || city) return;
    if (allCities.length === 0) return;

    const found =
      suburb.city_id != null
        ? (allCities.find((c) => c.id === suburb.city_id) ?? null)
        : suburb.city_name
          ? (allCities.find((c) => c.name === suburb.city_name) ?? null)
          : null;

    if (found) setCity(found);
  }, [suburb, city, allCities]);

  // city known → fill country
  // Strategy: find any suburb whose city_name matches the selected city —
  // that suburb carries country_name directly from SuburbViewSerializer.
  // Falls back to province chain if allSuburbs not loaded yet.
  useEffect(() => {
    if (!city || country) return;
    if (countries.length === 0) return;

    // Primary: look up country_name via allSuburbs (city_name → country_name)
    if (allSuburbs.length > 0) {
      const sample = allSuburbs.find((s) => s.city_name === city.name);
      if (sample?.country_name) {
        const found =
          countries.find((c) => c.name === sample.country_name) ?? null;
        if (found) {
          setCountry(found);
          return;
        }
      }
    }

    // Fallback: province chain (city.province_name → province.country_name)
    if (allProvinces.length > 0) {
      const province = allProvinces.find((p) => p.name === city.province_name);
      if (province?.country_name) {
        const found =
          countries.find((c) => c.name === province.country_name) ?? null;
        if (found) setCountry(found);
      }
    }
  }, [city, country, allSuburbs, allProvinces, countries]);

  // suburb known → fill country directly from suburb.country_name
  useEffect(() => {
    if (!suburb || country) return;
    if (countries.length === 0 || !suburb.country_name) return;

    const found = countries.find((c) => c.name === suburb.country_name) ?? null;
    if (found) setCountry(found);
  }, [suburb, country, countries]);

  // External suburb id (react-hook-form) → populate comboboxes
  useEffect(() => {
    if (!value || value <= 0) {
      if (suburb) {
        setSuburb(null);
        setCity(null);
        setCountry(null);
      }
      return;
    }
    if (suburb?.id === value) return;
    if (allSuburbs.length === 0) return;

    const found = allSuburbs.find((s) => s.id === value) ?? null;
    if (found) setSuburb(found);
  }, [value, allSuburbs, suburb?.id]);

  // ── derived option lists ──────────────────────────────────────────────────
  //
  // Suburb pool priority:
  //   city selected    → suburbsForCity (API-filtered, city_id injected)
  //   country selected → allSuburbs filtered by country_name  ← simple O(n), reliable
  //   nothing selected → allSuburbs (everything)
  //
  // City pool:
  //   country selected → citiesForCountry (API-filtered)
  //   nothing selected → allCities

  const countryOptions = sorted(countries);

  const cityOptions = sorted(country ? citiesForCountry : allCities);

  const suburbOptions = sorted(
    city
      ? suburbsForCity
      : country
        ? allSuburbs.filter((s) => s.country_name === country.name)
        : allSuburbs,
  );

  // ── handlers ─────────────────────────────────────────────────────────────
  //
  // Clearing rules:
  //   Typing in a field   → never clears downstream (only onSelect(null) clears)
  //   Field fully erased  → clear that level only; others stay
  //   New country chosen  → clear city+suburb only if they no longer belong
  //   New city chosen     → always clear suburb (belongs to a new pool)

  const handleCountrySelect = (item: CountryOption | null) => {
    setCountry(item);
    if (!item) return; // erased — leave city & suburb intact

    if (city) {
      // Check whether the current city belongs to the new country
      const cityCountryName = countryNameForCity(city);
      const stillValid =
        cityCountryName === item.name ||
        citiesForCountry.some((c) => c.id === city.id);

      if (!stillValid) {
        setCity(null);
        setSuburb(null);
        onChange(0);
      }
    }
  };

  const handleCitySelect = (item: CityOption | null) => {
    setCity(item);
    if (!item) return; // erased — leave suburb intact

    // New city explicitly chosen → reset suburb (different suburb pool)
    setSuburb(null);
    onChange(0);
    // country will be filled reactively by the useEffect above
  };

  const handleSuburbSelect = (item: SuburbOption | null) => {
    setSuburb(item);
    onChange(item?.id ?? 0);
    if (!item) {
      // Suburb cleared → reset city and country too
      setCity(null);
      setCountry(null);
    }
    // When item is set, city & country fill reactively via the useEffects above
  };

  const cityField = (
    <Combobox<CityOption>
      label={cityLabel}
      required={isStand}
      placeholder="Search city…"
      options={cityOptions}
      selected={city}
      onSelect={handleCitySelect}
      isLoading={country ? loadingCitiesForCountry : loadingCities}
    />
  );

  const suburbField = (
    <Combobox<SuburbOption>
      label={suburbLabel}
      required={suburbRequired}
      placeholder="Search suburb…"
      options={suburbOptions}
      selected={suburb}
      onSelect={handleSuburbSelect}
      error={error}
      isLoading={city ? loadingSuburbsForCity : loadingSuburbs}
    />
  );

  const countryField = (
    <Combobox<CountryOption>
      label="Country"
      placeholder="Search country…"
      options={countryOptions}
      selected={country}
      onSelect={handleCountrySelect}
      isLoading={loadingCountries}
    />
  );

  if (isStand) {
    return (
      <>
        {cityField}
        {suburbField}
      </>
    );
  }

  if (hideCountry) {
    return (
      <>
        {suburbField}
        {cityField}
      </>
    );
  }

  return (
    <>
      {suburbField}
      {cityField}
      {countryField}
    </>
  );
}
