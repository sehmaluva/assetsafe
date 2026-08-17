// ─── Common ──────────────────────────────────────────────────────────────────

export type OwnerType = 'individual' | 'company';
export type AssetCondition =
  | 'new'
  | 'second_hand'
  | 'reconditioned'
  | 'non_functioning';
export type Currency = string;

export { toBackendAssetType } from '@/lib/assetTypes';

// ─── API Response Wrapper ─────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T;
  message: string;
  errors?: Record<string, string[]>;
}

export interface PaginatedResponse<T> {
  data: T[];
  count: number;
  next: string | null;
  previous: string | null;
  message: string;
}

// ─── User / Owner ─────────────────────────────────────────────────────────────

export interface User {
  id: number;
  name: string;
  id_number?: string;
  reg_number?: string;
  type: OwnerType;
}

// ─── Collateral Registry ──────────────────────────────────────────────────────

export interface CollateralRecord {
  id: number;
  lodge_date: string;
  agreement_number: string;
  debtor_name: string;
  debtor_type: OwnerType;
  debtor_id: number;
  asset_description: string;
  asset_category: string;
  asset_type: string;
  asset_make: string;
  asset_model: string;
  asset_year: number;
  asset_condition: AssetCondition;
  asset_registration_no: string;
  chassis_number: string;
  engine_number: string;
  serial_number: string;
  currency: Currency;
  loan_amount: number;
  instalment_amount: number;
  instalment_date: number;
  total_paid_to_date: number;
  balance: number;
  start_date: string;
  end_date: string;
  financier_name: string;
  financier_type: OwnerType;
  financier_id: number;
  data_date: string;
  status: 'active' | 'pending_discharge' | 'discharged';
  data_source_display?: string;
  data_source_position?: string;
}

export interface CollateralDashboard {
  number_of_financiers: number;
  active_agreements: number;
  pending_discharge_confirmation: number;
  total_active_loan_value: number;
  records: CollateralRecord[];
}

export interface CollateralFormData {
  financier_type: OwnerType;
  financier_id: number;
  data_date: string;
  debtor_type: OwnerType;
  debtor_id: number;
  agreement_number: string;
  asset_category: string;
  asset_type: string;
  asset_make: string;
  asset_model: string;
  asset_year: number;
  asset_condition: AssetCondition;
  asset_registration_no: string;
  chassis_number: string;
  engine_number: string;
  serial_number: string;
  currency: Currency;
  loan_amount: number;
  instalment_amount: number;
  instalment_date: number;
  total_paid_to_date: number;
  balance: number;
  start_date: string;
  end_date: string;
}

// ─── Hire Purchase Registry ───────────────────────────────────────────────────

export interface HirePurchaseRecord {
  id: number;
  lodge_date: string;
  agreement_number: string;
  purchaser_name: string;
  purchaser_type: OwnerType;
  purchaser_id: number;
  asset_description: string;
  asset_make: string;
  asset_model: string;
  asset_category: string;
  asset_type: string;
  asset_year: number;
  asset_condition: AssetCondition;
  reg_serial_number: string;
  chassis_number: string;
  engine_number: string;
  currency: Currency;
  purchase_amount: number;
  instalment_amount: number;
  instalment_date: number;
  total_paid_to_date: number;
  balance: number;
  start_date: string;
  end_date: string;
  financier_name: string;
  financier_id: number;
  data_date: string;
  status: 'active' | 'pending_closure' | 'closed';
  data_source_display?: string;
  data_source_position?: string;
}

export interface HirePurchaseDashboard {
  number_of_financiers: number;
  active_agreements: number;
  pending_closure_confirmation: number;
  total_active_loan_value: number;
  records: HirePurchaseRecord[];
}

export interface HirePurchaseFormData {
  financier_id: number;
  data_date: string;
  purchaser_type: OwnerType;
  purchaser_id: number;
  agreement_number: string;
  asset_category: string;
  asset_type: string;
  asset_make: string;
  asset_model: string;
  asset_year: number;
  asset_condition: AssetCondition;
  reg_serial_number: string;
  chassis_number?: string;
  engine_number?: string;
  currency: Currency;
  purchase_amount: number;
  instalment_amount: number;
  instalment_date: number;
  total_paid_to_date: number;
  balance: number;
  start_date: string;
  end_date: string;
}

// ─── Asset Registry ───────────────────────────────────────────────────────────

export interface StandSaleInfo {
  id: number;
  purchaser_type: OwnerType;
  individual_purchaser?: number;
  company_purchaser?: number;
  purchaser_display?: string;
  purchaser_id_reg?: string;
  sale_date: string;
  terms: string;
  valuation_type: string;
  title_status: string;
  currency_code?: string;
  value_amount: number;
  is_completed: boolean;
}

export interface AssetRecord {
  id: number;
  lodge_date: string;
  registration_number: string;
  owner_name: string;
  owner_type: OwnerType;
  owner_id: number;
  owner_asset_number: string;
  owner_id_reg?: string;
  asset_description: string;
  asset_category: string;
  asset_type: string;
  asset_make: string;
  asset_model: string;
  year_of_make: number;
  condition: AssetCondition;
  mv_registration_no: string;
  chassis_number: string;
  engine_number: string;
  imei?: string;
  serial_number: string;
  stand_number?: string;
  stand_size?: string;
  stand_address?: string;
  city_name?: string;
  suburb_name?: string;
  valuation_type?: string;
  title_status?: string;
  stand_status?: string;
  open_sale?: StandSaleInfo | null;
  currency: Currency;
  estimated_value: number;
  location_address: string;
  subscription_start_date: string;
  subscription_end_date: string;
  status: 'active' | 'expired';
}

export interface AssetRegistryDashboard {
  total_assets: number;
  total_estimate_value: number;
  records: AssetRecord[];
}

export interface AssetFormData {
  owner_type: OwnerType;
  owner_id: number;
  owner_asset_number: string;
  asset_category: string;
  asset_type: string;
  asset_make: string;
  asset_model: string;
  year_of_make: number;
  condition: AssetCondition;
  mv_registration_no?: string;
  chassis_number?: string;
  engine_number?: string;
  imei?: string;
  serial_number: string;
  currency: Currency;
  estimated_value: number;
  location_address: string;
  subscription_start_date: string;
  subscription_end_date: string;
}

// ─── Search Filters ───────────────────────────────────────────────────────────

export type CollateralSearchField =
  | 'agreement_number'
  | 'debtor'
  | 'reg_serial_number'
  | 'financier';
export type AssetSearchField = string;
