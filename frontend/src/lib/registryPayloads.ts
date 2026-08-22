import { toBackendAssetType } from '@/lib/assetTypes';

type OwnerPayload = {
  owner_type: 'individual' | 'company';
  owner_id: number;
};

export function mapAssetFormToApi(data: Record<string, unknown>) {
  const owner = data as OwnerPayload & Record<string, unknown>;
  const asset_category = toBackendAssetType(String(data.asset_category ?? ''));
  const isVehicle = asset_category === 'vehicles';
  const isMobile = asset_category === 'mobiles';
  const isLand = asset_category === 'land';

  const payload: Record<string, unknown> = {
    owner_type: owner.owner_type,
    asset_category,
    asset_type: String(data.asset_type ?? '').trim(),
    make: isLand ? '' : data.asset_make,
    model: isLand ? '' : data.asset_model,
    year_of_make: isLand ? null : data.year_of_make,
    condition: isLand ? '' : data.condition,
    currency: data.currency,
    estimated_value: data.estimated_value,
    location_address: isLand ? '' : data.location_address,
    subscription_start_date: data.subscription_start_date,
    subscription_end_date: data.subscription_end_date,
    owner_asset_number: data.owner_asset_number ?? '',
    serial_number: isMobile ? '' : (data.serial_number ?? ''),
    custody_type: isLand ? '' : (data.custody_type ?? ''),
    custodian_type: isLand ? '' : (data.custodian_type ?? ''),
    custodian_address: isLand ? '' : (data.custodian_address ?? ''),
    custodian_email: isLand ? '' : (data.custodian_email ?? ''),
    custodian_mobile: isLand ? '' : (data.custodian_mobile ?? ''),
    custodian_telephone: isLand ? '' : (data.custodian_telephone ?? ''),
    guarantor_name: isLand ? '' : (data.guarantor_name ?? ''),
    guarantor_identification: isLand ? '' : (data.guarantor_identification ?? ''),
  };

  if (isVehicle) {
    payload.vehicle = {
      mv_registration_number: data.mv_registration_no ?? '',
      chassis_number: data.chassis_number ?? '',
      engine_number: data.engine_number ?? '',
    };
  }

  if (isMobile) {
    payload.mobile = {
      imei: String(data.imei ?? data.serial_number ?? '').trim(),
    };
  }

  if (isLand) {
    payload.land = {
      suburb: data.suburb_id,
      stand_address: data.stand_address ?? '',
      stand_number: data.stand_number,
      stand_size: data.stand_size ?? '',
      stand_size_unit: 'sq_m',
      valuation_type: data.valuation_type,
      title_status: data.title_status,
    };
    payload.individual_custodian = null;
    payload.company_custodian = null;
  }

  if (owner.owner_type === 'individual') {
    payload.individual_owner = owner.owner_id;
    payload.company_owner = null;
  } else {
    payload.company_owner = owner.owner_id;
    payload.individual_owner = null;
  }

  const custodyType = String(data.custody_type ?? '');
  if (custodyType && !isLand) {
    const custodianType = data.custodian_type as 'individual' | 'company';
    if (custodianType === 'individual') {
      payload.individual_custodian = data.custodian_id;
      payload.company_custodian = null;
    } else {
      payload.company_custodian = data.custodian_id;
      payload.individual_custodian = null;
    }
  } else {
    payload.individual_custodian = null;
    payload.company_custodian = null;
    payload.custodian_type = '';
  }

  return payload;
}

export function mapCollateralFormToApi(data: Record<string, unknown>) {
  const asset_category = toBackendAssetType(String(data.asset_category ?? ''));
  const isVehicle = asset_category === 'vehicles';
  const debtor_type = data.debtor_type as 'individual' | 'company';

  return {
    financier: data.financier_id,
    data_date: data.data_date,
    debtor_type,
    individual_debtor: debtor_type === 'individual' ? data.debtor_id : null,
    company_debtor: debtor_type === 'company' ? data.debtor_id : null,
    agreement_number: data.agreement_number,
    asset_category,
    asset_type: String(data.asset_type ?? '').trim(),
    make: data.asset_make,
    model: data.asset_model,
    year_of_make: data.asset_year,
    condition: data.asset_condition,
    asset_registration_number: isVehicle
      ? (data.asset_registration_no ?? '')
      : '',
    chassis_number: isVehicle ? (data.chassis_number ?? '') : '',
    engine_number: isVehicle ? (data.engine_number ?? '') : '',
    serial_number: data.serial_number ?? '',
    currency: data.currency,
    total_debt: data.loan_amount,
    instalment_amount: data.instalment_amount,
    instalment_day: data.instalment_date,
    total_paid_to_date: data.total_paid_to_date,
    agreement_start_date: data.start_date,
    agreement_end_date: data.end_date,
  };
}

export function mapHirePurchaseFormToApi(data: Record<string, unknown>) {
  const asset_category = toBackendAssetType(String(data.asset_category ?? ''));
  const purchaser_type = data.purchaser_type as 'individual' | 'company';
  const isVehicle = asset_category === 'vehicles';

  return {
    financier: data.financier_id,
    data_date: data.data_date,
    purchaser_type,
    purchaser_individual:
      purchaser_type === 'individual' ? data.purchaser_id : null,
    purchaser_company: purchaser_type === 'company' ? data.purchaser_id : null,
    agreement_number: data.agreement_number,
    asset_category,
    asset_type: String(data.asset_type ?? '').trim(),
    make: data.asset_make,
    model: data.asset_model ?? '',
    year_of_make: data.asset_year,
    condition: data.asset_condition,
    serial_number: data.reg_serial_number ?? '',
    mv_registration_number: isVehicle ? (data.reg_serial_number ?? '') : '',
    chassis_number: isVehicle ? (data.chassis_number ?? '') : '',
    engine_number: isVehicle ? (data.engine_number ?? '') : '',
    currency: data.currency,
    purchase_amount: data.purchase_amount,
    instalment_amount: data.instalment_amount,
    instalment_day: data.instalment_date,
    total_paid_to_date: data.total_paid_to_date,
    balance: data.balance,
    agreement_start_date: data.start_date,
    agreement_end_date: data.end_date,
    ...(data.data_source_user_id
      ? { data_source_user_id: data.data_source_user_id }
      : {}),
  };
}

export function mapSaleTransitionToApi(data: Record<string, unknown>) {
  const purchaser_type = data.purchaser_type as 'individual' | 'company';
  return {
    purchaser_type,
    individual_purchaser:
      purchaser_type === 'individual' ? data.purchaser_id : null,
    company_purchaser: purchaser_type === 'company' ? data.purchaser_id : null,
    sale_date: data.sale_date,
    terms: data.terms,
    valuation_type: data.valuation_type,
    title_status: data.title_status,
    currency: data.currency,
    value_amount: data.value_amount,
  };
}

export function mapOwnershipChangeToApi(data: Record<string, unknown>) {
  const owner_type = data.owner_type as 'individual' | 'company';
  return {
    owner_type,
    individual_owner: owner_type === 'individual' ? data.owner_id : null,
    company_owner: owner_type === 'company' ? data.owner_id : null,
    valuation_type: data.valuation_type ?? '',
    title_status: data.title_status ?? '',
    terms: data.terms ?? '',
    currency: data.currency ?? null,
    value_amount: data.value_amount ?? null,
  };
}
