import axiosInstance from './axiosInstance';
import {
  mapIndividualSearchResult,
  unwrapSearchList,
  type SearchOption,
} from '@/lib/searchResults';

export interface IndividualCreatePayload {
  first_name: string;
  last_name: string;
  identification_type: string;
  identification_number: string;
  email?: string;
  gender?: string;
  marital_status?: string;
  date_of_birth?: string | null;
  contact_details?: { type: string; phone_number: string }[];
  addresses: {
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

export interface IndividualContactDetails {
  id: number;
  email: string;
  phone: string;
  telephone: string;
  address: string;
}

function formatAddress(addr: unknown): string {
  if (!addr || typeof addr !== 'object') return '';
  const row = addr as Record<string, unknown>;
  const suburb =
    row.suburb && typeof row.suburb === 'object'
      ? String((row.suburb as { name?: string }).name ?? '')
      : '';
  const city =
    row.city && typeof row.city === 'object'
      ? String((row.city as { name?: string }).name ?? '')
      : '';
  return [String(row.street_address ?? ''), suburb, city]
    .map((p) => p.trim())
    .filter(Boolean)
    .join(', ');
}

export const individualsApi = {
  /** GET /api/individuals/search/?search=... */
  searchIndividuals: async (query: string): Promise<SearchOption[]> => {
    const term = query.trim();
    if (!term) return [];

    const { data } = await axiosInstance.get<unknown>('/individuals/search/', {
      params: { search: term, q: term },
    });

    return unwrapSearchList(data).map((row) =>
      mapIndividualSearchResult(row as Record<string, unknown>),
    );
  },

  importExternal: async (
    externalReference: string,
  ): Promise<{ id: number; name: string }> => {
    const { data } = await axiosInstance.post<unknown>(
      '/individuals/import-external/',
      { external_reference: externalReference },
    );
    const record = unwrapRecord(data);
    const mapped = mapIndividualSearchResult(record);
    return {
      id: mapped.id ?? Number(record.id),
      name: mapped.name,
    };
  },

  resolveIndividualSelection: async (item: SearchOption): Promise<number> => {
    if (item.source === 'external' && item.external_reference) {
      const result = await individualsApi.importExternal(item.external_reference);
      return result.id;
    }
    if (item.id == null) {
      throw new Error('Invalid individual selection');
    }
    return item.id;
  },

  createIndividual: async (
    payload: IndividualCreatePayload,
  ): Promise<{ id: number; name: string }> => {
    const { data } = await axiosInstance.post<unknown>(
      '/individuals/',
      payload,
    );
    const record = unwrapRecord(data);
    const id = Number(record.id);
    const name =
      (typeof record.name === 'string' && record.name) ||
      `${record.first_name ?? ''} ${record.last_name ?? ''}`.trim();
    return { id, name };
  },

  getIndividual: async (id: number): Promise<IndividualContactDetails> => {
    const { data } = await axiosInstance.get<unknown>(`/individuals/${id}/`);
    const record = unwrapRecord(data);
    const contacts = Array.isArray(record.contact_details)
      ? (record.contact_details as { type?: string; phone_number?: string }[])
      : [];
    const mobile =
      contacts.find((c) => c.type === 'mobile' || c.type === 'combined')
        ?.phone_number ??
      contacts[0]?.phone_number ??
      '';
    const telephone =
      contacts.find((c) => c.type === 'landline' || c.type === 'telephone')
        ?.phone_number ?? '';
    return {
      id: Number(record.id),
      email: String(record.email ?? ''),
      phone: String(mobile),
      telephone: String(telephone),
      address: formatAddress(record.addresses),
    };
  },
};
