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
  name: string;
  first_name: string;
  last_name: string;
  identification_type: string;
  identification_number: string;
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

function primaryAddressRecord(addresses: unknown): unknown {
  if (!addresses) return null;
  if (Array.isArray(addresses)) {
    const primary = addresses.find(
      (row) =>
        row &&
        typeof row === 'object' &&
        (row as { is_primary?: boolean }).is_primary,
    );
    return primary ?? addresses[0] ?? null;
  }
  return addresses;
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
    const parsed = parseAddress(primaryAddressRecord(record.addresses));
    const name =
      (typeof record.name === 'string' && record.name) ||
      `${record.first_name ?? ''} ${record.last_name ?? ''}`.trim();
    return {
      id: Number(record.id),
      name,
      first_name: String(record.first_name ?? ''),
      last_name: String(record.last_name ?? ''),
      identification_type: String(record.identification_type ?? 'national_id'),
      identification_number: String(record.identification_number ?? ''),
      email: String(record.email ?? ''),
      phone: String(mobile),
      telephone: String(telephone),
      address: parsed.address,
      street_address: parsed.street_address,
      suburb_id: parsed.suburb_id,
      suburb_name: parsed.suburb_name,
      city_name: parsed.city_name,
    };
  },

  updateIndividualContact: async (
    id: number,
    contact: {
      name?: string;
      email?: string;
      street?: string;
      suburb_id?: number;
      mobile?: string;
      telephone?: string;
    },
  ): Promise<void> => {
    if (Object.keys(contact).length === 0) return;

    const current = await individualsApi.getIndividual(id);
    let first_name = current.first_name;
    let last_name = current.last_name;
    if (contact.name?.trim()) {
      const parts = contact.name.trim().split(/\s+/);
      first_name = parts[0] ?? first_name;
      last_name = parts.slice(1).join(' ') || last_name;
    }

    const payload: Record<string, unknown> = {
      first_name,
      last_name,
      identification_type: current.identification_type,
      identification_number: current.identification_number,
    };

    if (contact.email !== undefined) {
      payload.email = contact.email;
    }

    if (contact.mobile !== undefined || contact.telephone !== undefined) {
      const mobile =
        contact.mobile !== undefined ? contact.mobile : current.phone;
      const telephone =
        contact.telephone !== undefined ? contact.telephone : current.telephone;
      const mobileChanged =
        contact.mobile !== undefined && contact.mobile !== current.phone;
      const telephoneChanged =
        contact.telephone !== undefined &&
        contact.telephone !== current.telephone;
      if (mobileChanged || telephoneChanged) {
        payload.contact_details = [
          { type: 'mobile', phone_number: mobile },
          ...(telephone
            ? [{ type: 'landline', phone_number: telephone }]
            : []),
        ];
      }
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

    await axiosInstance.patch(`/individuals/${id}/`, payload);
  },
};
