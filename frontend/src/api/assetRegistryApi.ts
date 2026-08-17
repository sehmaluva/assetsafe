import axiosInstance from './axiosInstance';
import { toBackendAssetType } from '@/lib/assetTypes';
import {
  mapAssetFormToApi,
  mapOwnershipChangeToApi,
  mapSaleTransitionToApi,
} from '@/lib/registryPayloads';
import type {
  ApiResponse,
  AssetRegistryDashboard,
  AssetRecord,
  AssetFormData,
} from '@/types';

function mapRecordFromApi(record: any): AssetRecord {
  const vehicle = record.vehicle ?? {};
  const mobile = record.mobile ?? {};
  const land = record.land ?? {};

  return {
    id: record.id,
    lodge_date: record.lodge_date,
    registration_number: record.registration_number,
    owner_name: record.owner_display ?? record.owner_name ?? '',
    owner_type: record.owner_type ?? 'individual',
    owner_id:
      record.owner_id ?? record.individual_owner ?? record.company_owner ?? 0,
    owner_asset_number: record.owner_asset_number ?? '',
    owner_id_reg: record.owner_id_reg ?? '',
    asset_description:
      record.description ??
      `${record.make ?? record.asset_make ?? ''} ${record.model ?? record.asset_model ?? ''}`.trim(),
    asset_category: toBackendAssetType(record.asset_category ?? ''),
    asset_type: String(record.asset_type ?? ''),
    asset_make: record.make ?? record.asset_make ?? '',
    asset_model: record.model ?? record.asset_model ?? '',
    year_of_make: record.year_of_make ?? 0,
    condition: record.condition ?? 'new',
    mv_registration_no:
      vehicle.mv_registration_number ?? record.mv_registration_number ?? '',
    chassis_number: vehicle.chassis_number ?? record.chassis_number ?? '',
    engine_number: vehicle.engine_number ?? record.engine_number ?? '',
    imei: mobile.imei ?? '',
    serial_number:
      record.primary_identifier ?? record.serial_number ?? mobile.imei ?? '',
    stand_number: land.stand_number ?? '',
    stand_size: land.stand_size_display ?? land.stand_size ?? '',
    stand_address: land.stand_address ?? '',
    city_name: land.city_name ?? '',
    suburb_name: land.suburb_name ?? '',
    valuation_type: land.valuation_type ?? '',
    title_status: land.title_status ?? '',
    stand_status: record.stand_status ?? '',
    open_sale: record.open_sale ?? null,
    currency: record.currency_code ?? record.currency ?? 'USD',
    estimated_value: record.estimated_value ?? 0,
    location_address: record.location_address ?? '',
    subscription_start_date: record.subscription_start_date ?? '',
    subscription_end_date: record.subscription_end_date ?? '',
    status: (record.is_active === false
      ? 'expired'
      : 'active') as AssetRecord['status'],
  };
}

export const assetRegistryApi = {
  getDashboard: async (params?: {
    asset_category?: string;
  }): Promise<AssetRegistryDashboard> => {
    const { data } = await axiosInstance.get<
      ApiResponse<AssetRegistryDashboard>
    >('/asset-management/stats/', { params });
    return data.data ?? (data as unknown as AssetRegistryDashboard);
  },

  getRecords: async (params?: {
    asset_category?: string;
    search?: string;
    page?: number;
    page_size?: number;
  }): Promise<{ records: AssetRecord[]; count: number }> => {
    const queryParams = params?.asset_category
      ? {
          ...params,
          asset_category: toBackendAssetType(params.asset_category),
        }
      : params;
    const { data } = await axiosInstance.get<any>('/asset-management/', {
      params: queryParams,
    });
    const payload = data?.data ?? data;
    const recordsRaw = payload?.results ?? payload?.data ?? payload ?? [];
    const count =
      typeof payload?.count === 'number'
        ? payload.count
        : Array.isArray(recordsRaw)
          ? recordsRaw.length
          : 0;
    const records = Array.isArray(recordsRaw)
      ? recordsRaw.map((record: any) => mapRecordFromApi(record))
      : [];

    return { records, count };
  },

  getRecord: async (id: number): Promise<AssetRecord> => {
    const { data } = await axiosInstance.get<ApiResponse<any>>(
      `/asset-management/${id}/`,
    );
    const r = data.data ?? data;
    return mapRecordFromApi(r);
  },

  createRecord: async (payload: AssetFormData): Promise<AssetRecord> => {
    const { data } = await axiosInstance.post<ApiResponse<AssetRecord>>(
      '/asset-management/',
      mapAssetFormToApi(payload as unknown as Record<string, unknown>),
    );
    const body = data.data ?? data;
    return mapRecordFromApi(body);
  },

  updateRecord: async (
    id: number,
    payload: Partial<AssetFormData>,
  ): Promise<AssetRecord> => {
    const { data } = await axiosInstance.patch<ApiResponse<AssetRecord>>(
      `/asset-management/${id}/`,
      mapAssetFormToApi(payload as unknown as Record<string, unknown>),
    );
    const body = data.data ?? data;
    return mapRecordFromApi(body);
  },

  saleTransition: async (
    id: number,
    payload: Record<string, unknown>,
  ): Promise<AssetRecord> => {
    const { data } = await axiosInstance.post<ApiResponse<any>>(
      `/asset-management/${id}/sale-transition/`,
      mapSaleTransitionToApi(payload),
    );
    const body = data.data ?? data;
    const asset = body.asset ?? body;
    return mapRecordFromApi(asset);
  },

  ownershipChange: async (
    id: number,
    payload: Record<string, unknown>,
  ): Promise<AssetRecord> => {
    const { data } = await axiosInstance.post<ApiResponse<any>>(
      `/asset-management/${id}/ownership-change/`,
      mapOwnershipChangeToApi(payload),
    );
    const body = data.data ?? data;
    return mapRecordFromApi(body);
  },

  deleteRecord: async (id: number): Promise<void> => {
    await axiosInstance.delete(`/asset-management/${id}/`);
  },
};
