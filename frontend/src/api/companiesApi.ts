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
  name: string;
  registration_number: string;
  email: string;
  phone: string;
  telephone: string;
  address: string;
  street_address: string;
  suburb_id?: number;
  suburb_name?: string;
  city_name?: string;
}

function parseAddress(addr: unknown): {
  address: string;
  street_address: string;
  suburb_id?: number;
  suburb_name: string;
  city_name: string;
} {
  if (!addr || typeof addr !== 'object') {
    return { address: '', street_address: '', suburb_name: '', city_name: '' };
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
  const suburb_name = suburb?.name ?? '';
  const city_name = city?.name ?? '';
  return {
    street_address,
    suburb_id: suburbId && suburbId > 0 ? suburbId : undefined,
    suburb_name,
    city_name,
    address: [street_address, suburb_name, city_name]
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
    const company =
      record.company && typeof record.company === 'object'
        ? (record.company as Record<string, unknown>)
        : null;
    const branchName = String(record.branch_name ?? '').trim();
    const companyName = String(
      company?.trading_name ?? company?.registration_name ?? '',
    ).trim();
    const isHq = record.is_headquarters === true;
    const branchIsDistinct =
      Boolean(branchName) &&
      Boolean(companyName) &&
      !isHq &&
      branchName.toLowerCase() !== companyName.toLowerCase();
    const name = branchIsDistinct
      ? `${companyName} — ${branchName}`
      : companyName || branchName;
    return {
      id: Number(record.id),
      name,
      registration_number: String(company?.registration_number ?? ''),
      email: String(record.email ?? profile?.email ?? ''),
      phone: String(record.phone ?? profile?.mobile_phone ?? ''),
      telephone: String(profile?.landline_phone ?? ''),
      address: parsed.address,
      street_address: parsed.street_address,
      suburb_id: parsed.suburb_id,
      suburb_name: parsed.suburb_name,
      city_name: parsed.city_name,
    };
  },

  updateBranchContact: async (
    id: number,
    contact: {
      email?: string;
      street?: string;
      suburb_id?: number;
      mobile?: string;
    },
  ): Promise<void> => {
    if (Object.keys(contact).length === 0) return;

    const payload: Record<string, unknown> = {};

    if (contact.email !== undefined) {
      payload.email = contact.email;
    }
    if (contact.mobile !== undefined) {
      payload.phone = contact.mobile;
    }
    if (contact.street !== undefined && contact.suburb_id && contact.suburb_id > 0) {
      payload.addresses = [
        {
          street_address: contact.street,
          suburb: contact.suburb_id,
          is_primary: true,
        },
      ];
    }

    if (Object.keys(payload).length === 0) return;

    await axiosInstance.patch(`/companies/branches/${id}/`, payload);
  },
};
