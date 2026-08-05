import axiosInstance from './axiosInstance';

export type EnquiryKind = 'internal' | 'external';

export type EnquirySearchField =
  | 'agreement_number'
  | 'serial_number'
  | 'registration_number'
  | 'chassis_number'
  | 'engine_number';

export type EnquirySource =
  | 'collateral'
  | 'hire_purchase'
  | 'asset_registry';

export interface EnquiryLog {
  id: number;
  kind: EnquiryKind;
  client_name: string;
  branch_label: string;
}

export interface RequesterOption {
  id: number;
  label: string;
  client_id: number | null;
  client_name: string;
  branch_label: string;
}

export interface EnquirySearchHit {
  source: EnquirySource;
  id: number;
  agreement_number: string;
  reg_number_serial: string;
  asset_description: string;
}

export interface AssetEnquiryReport {
  source: EnquirySource;
  record_id: number;
  asset_description: string;
  reg_number_serial: string;
  chassis_number: string;
  engine_number: string;
  owner_masked: string;
  id_reg_masked: string;
  status: 'clear' | 'encumbered';
  encumbrance_kind: 'collateral' | 'hire_purchase' | 'custody' | null;
  encumbrance_details: string | null;
  financier: string | null;
  loan_amount: string | null;
  purchase_amount: string | null;
  custodian_name_masked: string | null;
  custodian_id_reg_masked: string | null;
  expected_encumbrance_end: string | null;
}

export const enquiryApi = {
  createLog: async (payload: {
    kind: EnquiryKind;
    requester_id?: number;
    client_id?: number | null;
    client_name?: string;
    branch_label?: string;
  }): Promise<EnquiryLog> => {
    const { data } = await axiosInstance.post<EnquiryLog>(
      '/enquiries/asset/log/',
      payload,
    );
    return data;
  },

  searchRequesters: async (q: string): Promise<RequesterOption[]> => {
    const term = q.trim();
    if (term.length < 2) return [];
    const { data } = await axiosInstance.get<RequesterOption[]>(
      '/enquiries/asset/requesters/',
      { params: { q: term } },
    );
    return data ?? [];
  },

  search: async (params: {
    q: string;
    search_field: EnquirySearchField;
    enquiry_log_id?: number;
  }): Promise<{ count: number; results: EnquirySearchHit[] }> => {
    const { data } = await axiosInstance.get<{
      count: number;
      results: EnquirySearchHit[];
    }>('/enquiries/asset/search/', { params });
    return data;
  },

  getReport: async (params: {
    source: EnquirySource;
    id: number;
  }): Promise<AssetEnquiryReport> => {
    const { data } = await axiosInstance.get<AssetEnquiryReport>(
      '/enquiries/asset/report/',
      { params },
    );
    return data;
  },
};
