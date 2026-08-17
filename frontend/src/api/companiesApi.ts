import axiosInstance from './axiosInstance';
import {
  mapBranchSearchResult,
  unwrapSearchList,
  type SearchOption,
} from '@/lib/searchResults';

export interface CompanyCreatePayload {
  registration_number: string;
  registration_name: string;
  trading_name: string;
  legal_status?: string;
  date_of_incorporation?: string | null;
  industry: string;
  profile: {
    email: string;
    mobile_phone: string;
  };
  addresses?: {
    address_type?: string;
    is_primary?: boolean;
    street_address: string;
    suburb_id: number;
  }[];
}

function unwrapRecord(data: unknown): Record<string, unknown> {
  const body = (data as { data?: Record<string, unknown> })?.data ?? data;
  return body as Record<string, unknown>;
}

export interface BranchContactDetails {
  id: number;
  email: string;
  phone: string;
  telephone: string;
  address: string;
  street_address: string;
  suburb_id?: number;
}

function parseAddress(addr: unknown): {
  address: string;
  street_address: string;
  suburb_id?: number;
} {
  if (!addr || typeof addr !== 'object') {
    return { address: '', street_address: '' };
  }
  const row = addr as Record<string, unknown>;
  const street_address = String(row.street_address ?? '').trim();
  const suburb =
    row.suburb && typeof row.suburb === 'object'
      ? (row.suburb as { id?: number; name?: string })
      : null;
  const city =
    row.city && typeof row.city === 'object'
      ? (row.city as { name?: string })
      : null;
  const suburbId = suburb?.id != null ? Number(suburb.id) : undefined;
  return {
    street_address,
    suburb_id: suburbId && suburbId > 0 ? suburbId : undefined,
    address: [street_address, suburb?.name ?? '', city?.name ?? '']
      .map((p) => p.trim())
      .filter(Boolean)
      .join(', '),
  };
}

export const companiesApi = {
  /** GET /api/companies/branches/search/?q=... */
  searchBranches: async (query: string): Promise<SearchOption[]> => {
    const term = query.trim();
    if (!term) return [];

    const { data } = await axiosInstance.get<unknown>(
      '/companies/branches/search/',
      { params: { q: term } },
    );

    return unwrapSearchList(data).map((row) =>
      mapBranchSearchResult(row as Record<string, unknown>),
    );
  },

  importExternal: async (
    externalReference: string,
  ): Promise<{ id: number; name: string }> => {
    const { data } = await axiosInstance.post<unknown>(
      '/companies/companies/import-external/',
      { external_reference: externalReference },
    );
    const record = unwrapRecord(data);
    const mapped = mapBranchSearchResult(record);
    return {
      id: mapped.id ?? Number(record.id),
      name: mapped.name,
    };
  },

  resolveBranchSelection: async (item: SearchOption): Promise<number> => {
    if (item.source === 'external' && item.external_reference) {
      const result = await companiesApi.importExternal(item.external_reference);
      return result.id;
    }
    if (item.id == null) {
      throw new Error('Invalid company selection');
    }
    return item.id;
  },

  createCompany: async (
    payload: CompanyCreatePayload,
  ): Promise<{ id: number; name: string }> => {
    const { data } = await axiosInstance.post<unknown>(
      '/companies/companies/',
      payload,
    );
    const record = unwrapRecord(data);
    const mapped = mapBranchSearchResult(record);
    return {
      id: mapped.id || Number(record.id),
      name: mapped.name,
    };
  },

  getBranch: async (id: number): Promise<BranchContactDetails> => {
    const { data } = await axiosInstance.get<unknown>(
      `/companies/branches/${id}/`,
    );
    const record = unwrapRecord(data);
    const profile =
      record.profile && typeof record.profile === 'object'
        ? (record.profile as Record<string, unknown>)
        : null;
    const parsed = parseAddress(record.primary_address);
    return {
      id: Number(record.id),
      email: String(record.email ?? profile?.email ?? ''),
      phone: String(record.phone ?? profile?.mobile_phone ?? ''),
      telephone: String(profile?.landline_phone ?? ''),
      address: parsed.address,
      street_address: parsed.street_address,
      suburb_id: parsed.suburb_id,
    };
  },
};
