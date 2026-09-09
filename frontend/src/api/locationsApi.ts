import axiosInstance from './axiosInstance';

export interface CountryOption {
  id: number;
  name: string;
}
export interface ProvinceOption {
  id: number;
  name: string;
  country_name: string;
}
export interface CityOption {
  id: number;
  name: string;
  province_name: string;
}
export interface SuburbOption {
  id: number;
  name: string;
  city_id?: number; // present when fetched via filtered /locations/suburbs/?city_id=X
  city_name?: string; // present when fetched via /suburbs/ (SuburbViewSet)
  country_name?: string; // present when fetched via /suburbs/ (SuburbViewSet)
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function rows(data: unknown): Record<string, unknown>[] {
  const p = (data as { data?: unknown })?.data ?? data;
  if (Array.isArray(p)) return p as Record<string, unknown>[];
  const r = (p as { results?: unknown })?.results;
  if (Array.isArray(r)) return r as Record<string, unknown>[];
  return [];
}

// ─── API ──────────────────────────────────────────────────────────────────────

export const locationsApi = {
  getCountries: async (): Promise<CountryOption[]> => {
    const { data } = await axiosInstance.get('/common/locations/countries/');
    return rows(data).map((r) => ({
      id: Number(r.id),
      name: String(r.name ?? ''),
    }));
  },

  getProvinces: async (): Promise<ProvinceOption[]> => {
    const { data } = await axiosInstance.get('/common/locations/provinces/');
    // ProvinceSerializer returns: { id, name, country (string), … }
    return rows(data).map((r) => ({
      id: Number(r.id),
      name: String(r.name ?? ''),
      country_name: String(r.country ?? ''),
    }));
  },

  getCities: async (countryId?: number): Promise<CityOption[]> => {
    const params = countryId ? { country_id: countryId } : undefined;
    const { data } = await axiosInstance.get('/common/locations/cities/', {
      params,
    });
    // CitySerializer returns: { id, name, province (string name), … }
    return rows(data).map((r) => ({
      id: Number(r.id),
      name: String(r.name ?? ''),
      province_name: String(r.province ?? ''),
    }));
  },

  /**
   * Filtered suburbs — uses LocationViewSet which supports ?city_id=.
   * Returns { id, name, city (string name) } — no parent IDs in GET response.
   * We inject city_id ourselves when the caller provides it.
   */
  getSuburbs: async (cityId?: number): Promise<SuburbOption[]> => {
    const params = cityId ? { city_id: cityId } : undefined;
    const { data } = await axiosInstance.get('/common/locations/suburbs/', {
      params,
    });
    return rows(data).map((r) => ({
      id: Number(r.id),
      name: String(r.name ?? ''),
      city_id: cityId, // inject so auto-populate can find the parent city
    }));
  },

  /**
   * All suburbs with full hierarchy — uses SuburbViewSet (/common/suburbs/).
   * Returns { id, name, city (city name), province (province name), country (country name) }.
   * This is the only endpoint that exposes parent names without IDs.
   * Used for the unfiltered pool so suburb-first selection can auto-populate city & country.
   */
  getAllSuburbsWithHierarchy: async (): Promise<SuburbOption[]> => {
    const { data } = await axiosInstance.get('/common/suburbs/');
    return rows(data).map((r) => ({
      id: Number(r.id),
      name: String(r.name ?? ''),
      city_name: r.city ? String(r.city) : undefined,
      country_name: r.country ? String(r.country) : undefined,
    }));
  },

  createSuburb: async (payload: {
    name: string;
    city_id: number;
  }): Promise<SuburbOption> => {
    const { data } = await axiosInstance.post('/common/locations/suburbs/', {
      name: payload.name.trim(),
      city_id: payload.city_id,
    });
    const r = ((data as { data?: unknown })?.data ?? data) as Record<
      string,
      unknown
    >;
    return {
      id: Number(r.id),
      name: String(r.name ?? payload.name.trim()),
      city_id: payload.city_id,
      city_name: r.city ? String(r.city) : undefined,
    };
  },
};
