import axiosInstance from './axiosInstance';
import type { ApiResponse } from '@/types';

export interface CurrencyOption {
  code: string;
  name: string;
  symbol: string;
}

export interface ChoiceOption {
  value: string;
  label: string;
}

export interface CommonChoicesResponse {
  PartyType?: ChoiceOption[];
  BaseAssetType?: ChoiceOption[];
  CollateralAssetCategory?: ChoiceOption[];
  CollateralAssetType?: ChoiceOption[];
  AssetCondition?: ChoiceOption[];
  CustodyType?: ChoiceOption[];
  IdentificationType?: ChoiceOption[];
  LegalStatus?: ChoiceOption[];
  Industry?: ChoiceOption[];
  ValuationType?: ChoiceOption[];
  TitleStatus?: ChoiceOption[];
  SaleTerms?: ChoiceOption[];
}

export type ManagedChoiceCategory =
  | 'PartyType'
  | 'BaseAssetType'
  | 'AssetCondition'
  | 'CollateralAssetCategory'
  | 'Industry';

export interface ManagedChoice {
  id: number;
  category: ManagedChoiceCategory;
  value: string;
  label: string;
  is_system: boolean;
  is_active: boolean;
  sort_order: number;
}

export const commonApi = {
  getCurrencies: async (): Promise<CurrencyOption[]> => {
    const { data } = await axiosInstance.get<ApiResponse<CurrencyOption[]>>(
      '/common/currencies/',
    );
    return data.data ?? (data as unknown as CurrencyOption[]);
  },

  getChoices: async (): Promise<CommonChoicesResponse> => {
    const { data } = await axiosInstance.get<
      CommonChoicesResponse | ApiResponse<CommonChoicesResponse>
    >('/common/choices/');
    const body = data as CommonChoicesResponse & {
      data?: CommonChoicesResponse;
    };
    return body.data ?? body;
  },

  listManagedChoices: async (params?: {
    category?: ManagedChoiceCategory;
    active_only?: boolean;
  }): Promise<ManagedChoice[]> => {
    const { data } = await axiosInstance.get<ManagedChoice[]>(
      '/common/managed-choices/',
      {
        params: {
          ...(params?.category ? { category: params.category } : {}),
          active_only:
            params?.active_only === undefined
              ? true
              : params.active_only
                ? 'true'
                : 'false',
        },
      },
    );
    return data ?? [];
  },

  createManagedChoice: async (payload: {
    category: ManagedChoiceCategory;
    value: string;
    label: string;
    sort_order?: number;
  }): Promise<ManagedChoice> => {
    const { data } = await axiosInstance.post<ManagedChoice>(
      '/common/managed-choices/',
      payload,
    );
    return data;
  },

  deleteManagedChoice: async (id: number): Promise<void> => {
    await axiosInstance.delete(`/common/managed-choices/${id}/`);
  },
};
