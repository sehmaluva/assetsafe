import { useEffect, useRef, useState } from 'react';
import { useForm, useFormState, Controller } from 'react-hook-form';
import { zodResolver } from '@/lib/zodResolver';
import {
  firstFormErrorMessage,
  handleFormSubmitError,
} from '@/lib/formErrors';
import { z } from 'zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { assetRegistryApi } from '@/api/assetRegistryApi';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { DateInput } from '@/components/ui/DateInput';
import AutocompleteInput from '@/components/shared/AutocompleteInput';
import { individualsApi } from '@/api/individualsApi';
import { companiesApi } from '@/api/companiesApi';
import { locationsApi } from '@/api/locationsApi';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/shared/Modal';
import { IndividualCreateForm } from '@/components/individuals/IndividualCreateForm';
import { CompanyCreateForm } from '@/components/companies/CompanyCreateForm';
import { LocationCascadeSelects } from '@/components/shared/LocationCascadeSelects';
import { UserPlus, Building } from 'lucide-react';
import { FormSectionHeader } from '@/components/shared/FormSectionHeader';
import { FieldError } from '@/components/shared/FieldError';
import { commonApi } from '@/api/commonApi';
import { queryOptions } from '@/api/queryOptions';
import { useCommonChoices } from '@/hooks/useCommonChoices';
import { toBackendAssetType } from '@/lib/assetTypes';
import type { SearchOption } from '@/lib/searchResults';
import { partyIdRegDisplay } from '@/lib/searchResults';
import {
  applySellerContactToForm,
  clearSellerContactForm,
  contactToFieldLocks,
  EditableSellerContactGrid,
  emptySellerFieldLocks,
  fetchPartyContactWithSuburbId,
  syncSellerContactToParty,
  type SellerFieldLocks,
} from '@/lib/partyContact';

const LAND_ASSET_TYPES = ['Stand', 'Plot', 'Land'];

const schema = z
  .object({
    owner_type: z.string().min(1, 'Owner Type is required'),
    owner_id: z
      .number({ error: 'Owner is required' })
      .min(1, 'Owner is required'),
    owner_asset_number: z.string().optional(),
    asset_category: z.string().min(1, 'Select asset category'),
    asset_type: z.string().min(1, 'Asset type is required'),
    asset_make: z.string().optional(),
    asset_model: z.string().optional(),
    year_of_make: z.coerce.number().optional(),
    condition: z.string().optional(),
    mv_registration_no: z.string().optional(),
    chassis_number: z.string().optional(),
    engine_number: z.string().optional(),
    imei: z.string().optional(),
    serial_number: z.string().optional(),
    suburb_id: z.coerce.number().optional(),
    stand_address: z.string().optional(),
    stand_number: z.string().optional(),
    stand_size: z.string().optional(),
    valuation_type: z.string().optional(),
    title_status: z.string().optional(),
    currency: z.string().min(1, 'Currency is required'),
    estimated_value: z.coerce.number().min(0),
    location_address: z.string().optional(),
    subscription_start_date: z.string().min(1, 'Required'),
    subscription_end_date: z.string().min(1, 'Required'),
    under_custody: z.boolean().optional(),
    custodian_type: z.string().optional(),
    custodian_id: z.number().optional(),
    custody_type: z.string().optional(),
    custodian_street_address: z.string().optional(),
    custodian_suburb_id: z.coerce.number().optional(),
    custodian_email: z.string().optional(),
    custodian_mobile: z.string().optional(),
    custodian_telephone: z.string().optional(),
    guarantor_name: z.string().optional(),
    guarantor_identification: z.string().optional(),
    seller_name: z.string().optional(),
    seller_email: z.string().optional(),
    seller_street: z.string().optional(),
    seller_suburb: z.string().optional(),
    seller_city: z.string().optional(),
    seller_mobile: z.string().optional(),
    seller_telephone: z.string().optional(),
    seller_suburb_id: z.coerce.number().optional(),
  })
  .superRefine((data, ctx) => {
    const isLand = toBackendAssetType(data.asset_category) === 'land';

    if (isLand) {
      if (!data.suburb_id || data.suburb_id < 1) {
        ctx.addIssue({
          code: 'custom',
          message: 'Suburb/Area/Development is required',
          path: ['suburb_id'],
        });
      }
      if (!data.stand_address?.trim()) {
        ctx.addIssue({
          code: 'custom',
          message: 'Stand address is required',
          path: ['stand_address'],
        });
      }
      if (!data.stand_number?.trim()) {
        ctx.addIssue({
          code: 'custom',
          message: 'Stand number is required',
          path: ['stand_number'],
        });
      }
      if (!data.valuation_type) {
        ctx.addIssue({
          code: 'custom',
          message: 'Valuation type is required',
          path: ['valuation_type'],
        });
      }
      if (!data.title_status) {
        ctx.addIssue({
          code: 'custom',
          message: 'Title status is required',
          path: ['title_status'],
        });
      }
      return;
    }

    if (!data.asset_make?.trim()) {
      ctx.addIssue({
        code: 'custom',
        message: 'Required',
        path: ['asset_make'],
      });
    }
    if (!data.asset_model?.trim()) {
      ctx.addIssue({
        code: 'custom',
        message: 'Required',
        path: ['asset_model'],
      });
    }
    if (
      !data.year_of_make ||
      data.year_of_make < 1900 ||
      data.year_of_make > 2100
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Year of make is required',
        path: ['year_of_make'],
      });
    }
    if (!data.condition) {
      ctx.addIssue({
        code: 'custom',
        message: 'Select condition',
        path: ['condition'],
      });
    }
    if (!data.location_address?.trim()) {
      ctx.addIssue({
        code: 'custom',
        message: 'Required',
        path: ['location_address'],
      });
    }

    if (!data.under_custody) return;
    if (!data.custodian_type) {
      ctx.addIssue({
        code: 'custom',
        message: 'Custodian type is required',
        path: ['custodian_type'],
      });
    }
    if (!data.custodian_id) {
      ctx.addIssue({
        code: 'custom',
        message: 'Custodian is required',
        path: ['custodian_id'],
      });
    }
    if (!data.custody_type) {
      ctx.addIssue({
        code: 'custom',
        message: 'Custody type is required',
        path: ['custody_type'],
      });
    }
    if (!data.custodian_street_address?.trim()) {
      ctx.addIssue({
        code: 'custom',
        message: 'Street address is required',
        path: ['custodian_street_address'],
      });
    }
    if (!data.custodian_suburb_id || data.custodian_suburb_id < 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'Suburb is required',
        path: ['custodian_suburb_id'],
      });
    }
  });

type FormValues = z.infer<typeof schema>;

interface AssetRegistryFormProps {
  initial?: Partial<FormValues>;
  ownerDisplayLabel?: string;
  onSuccess: () => void;
  onCancel: () => void;
  isEdit?: boolean;
  recordId?: number;
}

export function AssetRegistryForm({
  initial,
  ownerDisplayLabel,
  onSuccess,
  onCancel,
  isEdit,
  recordId,
}: AssetRegistryFormProps) {
  const [addIndividualOpen, setAddIndividualOpen] = useState(false);
  const [addCompanyOpen, setAddCompanyOpen] = useState(false);
  const [addCustodianIndividualOpen, setAddCustodianIndividualOpen] =
    useState(false);
  const [addCustodianCompanyOpen, setAddCustodianCompanyOpen] = useState(false);
  const [addGuarantorOpen, setAddGuarantorOpen] = useState(false);
  const [custodianSearchLabel, setCustodianSearchLabel] = useState('');
  const [ownerIdRegLabel, setOwnerIdRegLabel] = useState(ownerDisplayLabel ?? '');
  const [guarantorSelectedId, setGuarantorSelectedId] = useState<
    number | undefined
  >();
  const [sellerFieldLocks, setSellerFieldLocks] = useState<SellerFieldLocks>(
    emptySellerFieldLocks,
  );
  const prevOwnerTypeRef = useRef<string | null>(null);

  const { register, control, handleSubmit, watch, setValue, setError } =
    useForm<FormValues>({
      resolver: zodResolver(schema),
      mode: 'onBlur',
      reValidateMode: 'onChange',
      shouldFocusError: true,
      defaultValues: {
        owner_type: 'company',
        currency: '',
        asset_category: '',
        asset_type: '',
        year_of_make: new Date().getFullYear(),
        condition: 'new',
        under_custody: false,
        custodian_type: 'company',
        ...initial,
      },
    });

  const { errors } = useFormState({ control });
  const { data: currencies = [] } = useQuery({
    queryKey: ['common-currencies'],
    queryFn: commonApi.getCurrencies,
    ...queryOptions.static,
  });
  const { data: choices } = useCommonChoices();

  const CUSTODY_TYPE_FALLBACK = [
    { value: 'rental', label: 'Rental' },
    { value: 'escrow', label: 'Escrow' },
    { value: 'consignment', label: 'Consignment' },
    { value: 'trust', label: 'Trust' },
    { value: 'arrangement', label: 'Arrangement' },
    { value: 'employee', label: 'Employee' },
  ];

  const partyTypeOptions = choices.PartyType ?? [];
  const assetCategoryOptions = choices.BaseAssetType ?? [];
  const assetConditionOptions = choices.AssetCondition ?? [];
  const custodyTypeOptions =
    choices.CustodyType && choices.CustodyType.length > 0
      ? choices.CustodyType
      : CUSTODY_TYPE_FALLBACK;
  const currentOwnerType = watch('owner_type');
  const currentOwnerId = watch('owner_id');
  const underCustody = watch('under_custody');
  const currentCustodianType = watch('custodian_type');
  const currentCustodianId = watch('custodian_id');
  const guarantorName = watch('guarantor_name');
  const guarantorIdentification = watch('guarantor_identification');

  const formatCustodianDisplay = (name?: string, subtitle?: string) => {
    const trimmedName = (name ?? '').trim();
    const trimmedSubtitle = (subtitle ?? '').trim();
    if (!trimmedName) return trimmedSubtitle;
    if (!trimmedSubtitle) return trimmedName;
    return `${trimmedName} - ${trimmedSubtitle}`;
  };

  const applyCustodianContact = (contact: {
    email?: string;
    phone?: string;
    telephone?: string;
    street_address?: string;
    suburb_id?: number;
  }) => {
    setValue('custodian_street_address', contact.street_address ?? '', {
      shouldValidate: true,
    });
    setValue('custodian_suburb_id', contact.suburb_id ?? undefined, {
      shouldValidate: true,
    });
    setValue('custodian_email', contact.email ?? '');
    setValue('custodian_mobile', contact.phone ?? '');
    setValue('custodian_telephone', contact.telephone ?? '');
  };

  const clearCustodianAddress = () => {
    setValue('custodian_street_address', '');
    setValue('custodian_suburb_id', undefined);
  };

  const applyCustodianSelection = async (item: SearchOption) => {
    const id =
      currentCustodianType === 'company'
        ? await companiesApi.resolveBranchSelection(item)
        : await individualsApi.resolveIndividualSelection(item);
    setCustodianSearchLabel(
      formatCustodianDisplay(item.name, item.subtitle ?? ''),
    );
    return id;
  };

  useEffect(() => {
    if (!underCustody || !currentCustodianId || currentCustodianId < 1) {
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        if (currentCustodianType === 'company') {
          const contact = await companiesApi.getBranch(currentCustodianId);
          if (!cancelled) applyCustodianContact(contact);
        } else {
          const contact =
            await individualsApi.getIndividual(currentCustodianId);
          if (!cancelled) applyCustodianContact(contact);
        }
      } catch {
        // Keep manually entered values if lookup fails.
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fill only when custodian selection changes
  }, [underCustody, currentCustodianId, currentCustodianType]);

  const applyGuarantorSelection = async (item: SearchOption) => {
    const id = await individualsApi.resolveIndividualSelection(item);
    setValue('guarantor_name', item.name, { shouldValidate: true });
    setValue('guarantor_identification', item.subtitle ?? '', {
      shouldValidate: true,
    });
    setGuarantorSelectedId(id);
    return id;
  };

  const clearGuarantorSelection = (v: number) => {
    if (v) return;
    setValue('guarantor_name', '');
    setValue('guarantor_identification', '');
    setGuarantorSelectedId(undefined);
  };

  useEffect(() => {
    if (!watch('currency') && currencies.length > 0) {
      setValue('currency', currencies[0].code, { shouldValidate: true });
    }
  }, [currencies, setValue, watch]);

  useEffect(() => {
    if (!watch('condition') && assetConditionOptions.length > 0) {
      setValue('condition', assetConditionOptions[0].value, {
        shouldValidate: true,
      });
    }
  }, [assetConditionOptions, setValue, watch]);

  useEffect(() => {
    if (!currentOwnerType && partyTypeOptions.length > 0) {
      const defaultOwner =
        partyTypeOptions.find((p: any) => p.value === 'company') ||
        partyTypeOptions[0];
      setValue('owner_type', defaultOwner.value, { shouldValidate: true });
    }
  }, [partyTypeOptions, setValue, currentOwnerType]);

  const watchAssetCategory = watch('asset_category');
  const category = toBackendAssetType(watchAssetCategory);
  const isVehicle = category === 'vehicles';
  const isMobile = category === 'mobiles';
  const isLand = category === 'land';

  useEffect(() => {
    if (prevOwnerTypeRef.current === null) {
      prevOwnerTypeRef.current = currentOwnerType;
      return;
    }
    if (prevOwnerTypeRef.current !== currentOwnerType) {
      prevOwnerTypeRef.current = currentOwnerType;
      setValue('owner_id', 0);
      setOwnerIdRegLabel('');
      clearSellerContactForm(setValue);
      setSellerFieldLocks(emptySellerFieldLocks());
    }
  }, [currentOwnerType, setValue]);

  useEffect(() => {
    if (!isLand) return;
    if (!currentOwnerId || currentOwnerId < 1) {
      clearSellerContactForm(setValue);
      setSellerFieldLocks(emptySellerFieldLocks());
      setOwnerIdRegLabel('');
      return;
    }
    let cancelled = false;
    void fetchPartyContactWithSuburbId(
      currentOwnerType,
      currentOwnerId,
      ownerDisplayLabel ?? '',
    ).then(({ contact, suburbId }) => {
      if (!cancelled) {
        applySellerContactToForm(setValue, contact, suburbId);
        setSellerFieldLocks(contactToFieldLocks(contact));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isLand, currentOwnerType, currentOwnerId, setValue]);

  const valuationOptions = choices.ValuationType ?? [];
  const titleStatusOptions = choices.TitleStatus ?? [];

  useEffect(() => {
    if (!isLand || isEdit) return;
    const currentType = watch('asset_type');
    if (!currentType || !LAND_ASSET_TYPES.includes(currentType)) {
      setValue('asset_type', 'Stand', { shouldValidate: true });
    }
    if (underCustody) {
      setValue('under_custody', false);
    }
  }, [isLand, isEdit, setValue, underCustody, watch]);

  const { data: suburbsWithHierarchy = [] } = useQuery({
    queryKey: ['loc-suburbs-view'],
    queryFn: locationsApi.getAllSuburbsWithHierarchy,
    ...queryOptions.static,
    enabled: Boolean(underCustody),
  });

  const { mutate: submit, isPending } = useMutation({
    mutationFn: async (data: FormValues) => {
      if (
        toBackendAssetType(data.asset_category) === 'land' &&
        data.owner_id &&
        data.owner_id > 0
      ) {
        await syncSellerContactToParty(
          data.owner_type,
          data.owner_id,
          data,
          sellerFieldLocks,
        );
      }

      let suburbs = suburbsWithHierarchy;
      if (
        data.under_custody &&
        data.custodian_suburb_id &&
        !suburbs.find((s) => s.id === data.custodian_suburb_id)
      ) {
        suburbs = await locationsApi.getAllSuburbsWithHierarchy();
      }
      const suburb = suburbs.find((s) => s.id === data.custodian_suburb_id);
      const custodian_address = data.under_custody
        ? [
            data.custodian_street_address?.trim() ?? '',
            suburb?.name ?? '',
            suburb?.city_name ?? '',
          ]
            .map((p) => p.trim())
            .filter(Boolean)
            .join(', ')
        : '';
      const payload = {
        ...data,
        custody_type: data.under_custody ? data.custody_type : '',
        custodian_type: data.under_custody ? data.custodian_type : '',
        custodian_id: data.under_custody ? data.custodian_id : undefined,
        custodian_address,
      };
      return isEdit && recordId
        ? assetRegistryApi.updateRecord(recordId, payload as any)
        : assetRegistryApi.createRecord(payload as any);
    },
    onSuccess,
    onError: (err: unknown) => {
      handleFormSubmitError(setError, err, 'Failed to save');
    },
  });

  const onInvalid = (formErrors: Parameters<typeof firstFormErrorMessage>[0]) => {
    toast.error(
      firstFormErrorMessage(formErrors) ?? 'Please fix the highlighted fields',
    );
  };

  return (
    <>
      <form
        onSubmit={handleSubmit((d) => submit(d), onInvalid)}
        className="bg-white"
        noValidate
      >
        <FormSectionHeader
          title={isLand ? 'Seller Details' : 'Owner Details'}
          variant="teal"
        />
        {!isEdit && (
          <div className="flex gap-2 px-4 pt-2 pb-1">
            <Button
              type="button"
              size="sm"
              variant="primary"
              leftIcon={<UserPlus className="h-3 w-3" />}
              onClick={() => setAddIndividualOpen(true)}
            >
              + Add Individual
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              leftIcon={<Building className="h-3 w-3" />}
              onClick={() => setAddCompanyOpen(true)}
            >
              + Add Company
            </Button>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
          <Select
            label={isLand ? 'Seller Type' : 'Owner Type'}
            {...register('owner_type')}
            disabled={!partyTypeOptions.length || isEdit}
          >
            <option value="">
              {partyTypeOptions.length
                ? 'Select owner type...'
                : 'Loading owner types...'}
            </option>
            {partyTypeOptions.map((option: any) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <div className="col-span-2">
            <Controller
              name="owner_id"
              control={control}
              render={({ field }) => (
                <AutocompleteInput
                  key={`asset-owner-${watch('owner_type')}`}
                  label={
                    isLand ? 'ID/Comp Reg search' : 'Name / ID / Co. Reg #'
                  }
                  placeholder="Search owner..."
                  queryKey={`asset-owner-${watch('owner_type')}`}
                  displayLabel={isLand ? ownerIdRegLabel : ownerDisplayLabel}
                  fetchFn={(q) =>
                    watch('owner_type') === 'company'
                      ? companiesApi.searchBranches(q)
                      : individualsApi.searchIndividuals(q)
                  }
                  resolveSelection={async (item) => {
                    const ownerType = watch('owner_type');
                    const id =
                      ownerType === 'company'
                        ? await companiesApi.resolveBranchSelection(item)
                        : await individualsApi.resolveIndividualSelection(item);
                    if (isLand) {
                      setOwnerIdRegLabel(partyIdRegDisplay(item, ownerType));
                    }
                    return id;
                  }}
                  selectionDisplay={
                    isLand
                      ? (item) => partyIdRegDisplay(item, watch('owner_type'))
                      : undefined
                  }
                  createLabel={
                    watch('owner_type') === 'company'
                      ? 'Create company'
                      : 'Create individual'
                  }
                  onCreateNew={() => {
                    if (watch('owner_type') === 'company') {
                      setAddCompanyOpen(true);
                    } else {
                      setAddIndividualOpen(true);
                    }
                  }}
                  error={errors.owner_id?.message}
                  value={field.value}
                  onBlur={field.onBlur}
                  onChange={(v) => {
                    field.onChange(Number(v));
                    if (isLand && !v) setOwnerIdRegLabel('');
                  }}
                />
              )}
            />
          </div>
          <Input
            label="Owner Asset Number"
            {...register('owner_asset_number')}
            placeholder="Internal asset code"
          />
        </div>
        {isLand && currentOwnerId != null && currentOwnerId > 0 ? (
          <EditableSellerContactGrid
            register={register}
            errors={errors}
            fieldLocks={sellerFieldLocks}
            values={{
              seller_name: watch('seller_name'),
              seller_email: watch('seller_email'),
              seller_street: watch('seller_street'),
              seller_suburb: watch('seller_suburb'),
              seller_city: watch('seller_city'),
              seller_mobile: watch('seller_mobile'),
              seller_telephone: watch('seller_telephone'),
            }}
          />
        ) : null}

        {/* ── Asset / Stand Details ── */}
        <FormSectionHeader
          title={isLand ? 'Stand Details' : 'Asset Details'}
          variant="dark"
        />
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
          <Select
            label="Asset Category"
            required
            {...register('asset_category')}
            disabled={!assetCategoryOptions.length || isEdit}
            error={errors.asset_category?.message}
          >
            <option value="">
              {assetCategoryOptions.length
                ? 'Select asset category'
                : 'Loading...'}
            </option>
            {assetCategoryOptions.map((t: any) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>

          {isLand ? (
            <>
              <Select
                label="Asset Description"
                required
                {...register('asset_type')}
                error={errors.asset_type?.message}
              >
                {LAND_ASSET_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </Select>
              <Controller
                name="suburb_id"
                control={control}
                render={({ field }) => (
                  <LocationCascadeSelects
                    variant="stand"
                    value={field.value}
                    onChange={(id) => field.onChange(id > 0 ? id : undefined)}
                    error={errors.suburb_id?.message}
                  />
                )}
              />
              <Input
                label="Stand Address"
                {...register('stand_address')}
                error={errors.stand_address?.message}
                required
              />
              <Input
                label="Stand Number"
                {...register('stand_number')}
                error={errors.stand_number?.message}
                required
              />
              <Input
                label="Stand Size"
                {...register('stand_size')}
                placeholder="e.g. 1200"
              />
            </>
          ) : (
            <>
              <Input
                label="Asset Type"
                {...register('asset_type')}
                error={errors.asset_type?.message}
                required
              />
              <Input
                label="Make"
                {...register('asset_make')}
                error={errors.asset_make?.message}
                required
              />
              <Input
                label="Model"
                {...register('asset_model')}
                error={errors.asset_model?.message}
                required
              />
              <Input
                label="Year of Make"
                type="number"
                {...register('year_of_make', { valueAsNumber: true })}
                error={errors.year_of_make?.message}
              />
              <Select
                label="Condition"
                {...register('condition')}
                disabled={!assetConditionOptions.length}
              >
                <option value="">
                  {assetConditionOptions.length ? 'Select...' : 'Loading...'}
                </option>
                {assetConditionOptions.map((c: any) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
              {isVehicle ? (
                <>
                  <Input
                    label="MV Registration No."
                    {...register('mv_registration_no')}
                  />
                  <Input
                    label="Chassis Number"
                    {...register('chassis_number')}
                  />
                  <Input label="Engine Number" {...register('engine_number')} />
                </>
              ) : null}
              {isMobile ? (
                <Input
                  label="IMEI"
                  {...register('imei')}
                  error={errors.imei?.message}
                />
              ) : (
                <Input label="Serial Number" {...register('serial_number')} />
              )}
            </>
          )}
        </div>

        {/* ── Valuation & Subscription ── */}
        <FormSectionHeader title="Valuation & Subscription" variant="teal" />
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
          {isLand ? (
            <>
              <Select
                label="Valuation Type"
                required
                {...register('valuation_type')}
                error={errors.valuation_type?.message}
              >
                <option value="">Select...</option>
                {valuationOptions.map((o: any) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
              <Select
                label="Title Status"
                required
                {...register('title_status')}
                error={errors.title_status?.message}
              >
                <option value="">Select...</option>
                {titleStatusOptions.map((o: any) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </>
          ) : null}
          <Select
            label="Currency"
            required
            {...register('currency')}
            disabled={!currencies.length}
            error={errors.currency?.message}
          >
            <option value="">
              {currencies.length
                ? 'Select currency...'
                : 'Loading currencies...'}
            </option>
            {currencies.map((currency) => (
              <option key={currency.code} value={currency.code}>
                {currency.code} - {currency.name}
              </option>
            ))}
          </Select>
          <Input
            label={isLand ? 'Value Amount' : 'Estimated Value'}
            type="number"
            step="0.01"
            {...register('estimated_value')}
            error={errors.estimated_value?.message}
            required
          />
          {!isLand ? (
            <div className="col-span-2">
              <Input
                label="Location Address"
                {...register('location_address')}
                error={errors.location_address?.message}
                placeholder="Primary location of asset"
                required
              />
            </div>
          ) : null}
          <Controller
            name="subscription_start_date"
            control={control}
            render={({ field, fieldState }) => (
              <DateInput
                label="Subscription Start Date"
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
                required
              />
            )}
          />
          <Controller
            name="subscription_end_date"
            control={control}
            render={({ field, fieldState }) => (
              <DateInput
                label="Subscription End Date"
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
                required
              />
            )}
          />
        </div>

        {!isLand ? (
          <>
            {/* ── Custody Details ── */}
            <FormSectionHeader title="Custody Details" variant="dark" />
            <div className="space-y-3 p-4">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={Boolean(underCustody)}
                  onChange={(e) => {
                    setValue('under_custody', e.target.checked, {
                      shouldValidate: true,
                    });
                    if (!e.target.checked) {
                      setValue('custody_type', '');
                      setValue('custodian_id', undefined);
                      setCustodianSearchLabel('');
                      clearCustodianAddress();
                      setValue('custodian_email', '');
                      setValue('custodian_mobile', '');
                      setValue('custodian_telephone', '');
                      setValue('guarantor_name', '');
                      setValue('guarantor_identification', '');
                      setGuarantorSelectedId(undefined);
                    }
                  }}
                />
                Asset is under custody of someone other than the owner
              </label>

              {underCustody ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Select
                    label="Custodian Type"
                    {...register('custodian_type', {
                      onChange: () => {
                        setValue('custodian_id', undefined);
                        setCustodianSearchLabel('');
                        clearCustodianAddress();
                        setValue('custodian_email', '');
                        setValue('custodian_mobile', '');
                        setValue('custodian_telephone', '');
                      },
                    })}
                    error={errors.custodian_type?.message}
                  >
                    {partyTypeOptions.map((option: any) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                  <div className="col-span-2">
                    <Controller
                      name="custodian_id"
                      control={control}
                      render={({ field }) => (
                        <AutocompleteInput
                          label="Custodian Name / ID/Reg Number"
                          placeholder="Search custodian..."
                          queryKey={`asset-custodian-${currentCustodianType}`}
                          displayLabel={custodianSearchLabel}
                          fetchFn={(q) =>
                            currentCustodianType === 'company'
                              ? companiesApi.searchBranches(q)
                              : individualsApi.searchIndividuals(q)
                          }
                          resolveSelection={applyCustodianSelection}
                          createLabel={
                            currentCustodianType === 'company'
                              ? 'Create company'
                              : 'Create individual'
                          }
                          onCreateNew={() => {
                            if (currentCustodianType === 'company') {
                              setAddCustodianCompanyOpen(true);
                            } else {
                              setAddCustodianIndividualOpen(true);
                            }
                          }}
                          error={errors.custodian_id?.message}
                          value={field.value}
                          onBlur={field.onBlur}
                          onChange={(v) => {
                            const id = Number(v) || undefined;
                            field.onChange(id);
                            if (!id) {
                              setCustodianSearchLabel('');
                              clearCustodianAddress();
                              setValue('custodian_email', '');
                              setValue('custodian_mobile', '');
                              setValue('custodian_telephone', '');
                            }
                          }}
                        />
                      )}
                    />
                    <div className="mt-2 flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="primary"
                        onClick={() => {
                          if (currentCustodianType === 'company') {
                            setAddCustodianCompanyOpen(true);
                          } else {
                            setAddCustodianIndividualOpen(true);
                          }
                        }}
                      >
                        +Add Custodian
                      </Button>
                    </div>
                  </div>
                  <div className="col-span-2">
                    <Input
                      label="Street Address"
                      {...register('custodian_street_address')}
                      placeholder="Street name, house/building number"
                      required
                      error={errors.custodian_street_address?.message}
                    />
                  </div>
                  <Controller
                    name="custodian_suburb_id"
                    control={control}
                    render={({ field }) => (
                      <LocationCascadeSelects
                        value={field.value}
                        onChange={(id) =>
                          field.onChange(id > 0 ? id : undefined)
                        }
                        error={errors.custodian_suburb_id?.message}
                      />
                    )}
                  />
                  <Input label="Mobile" {...register('custodian_mobile')} />
                  <Input label="Email" {...register('custodian_email')} />
                  <Input
                    label="Telephone"
                    {...register('custodian_telephone')}
                  />
                  <Select
                    label="Custody Type"
                    {...register('custody_type')}
                    error={errors.custody_type?.message}
                  >
                    <option value="">Select custody type...</option>
                    {custodyTypeOptions.map((option: any) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                  <AutocompleteInput
                    label="Guarantor"
                    placeholder="Search individuals..."
                    queryKey="asset-guarantor-name"
                    minChars={1}
                    displayLabel={guarantorName}
                    value={guarantorSelectedId}
                    fetchFn={(q) => individualsApi.searchIndividuals(q)}
                    resolveSelection={applyGuarantorSelection}
                    onChange={clearGuarantorSelection}
                    onCreateNew={() => setAddGuarantorOpen(true)}
                    createLabel="Create individual"
                  />
                  <AutocompleteInput
                    label="Guarantor ID"
                    placeholder="Search by ID number..."
                    queryKey="asset-guarantor-id"
                    minChars={1}
                    displayLabel={guarantorIdentification}
                    value={guarantorSelectedId}
                    fetchFn={(q) => individualsApi.searchIndividuals(q)}
                    resolveSelection={applyGuarantorSelection}
                    onChange={clearGuarantorSelection}
                    onCreateNew={() => setAddGuarantorOpen(true)}
                    createLabel="Create individual"
                  />
                  <div className="flex items-end">
                    <Button
                      type="button"
                      size="sm"
                      variant="primary"
                      onClick={() => setAddGuarantorOpen(true)}
                    >
                      +Add Guarantor
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </>
        ) : null}

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" loading={isPending}>
            {isEdit ? 'Edit' : 'Upload'}
          </Button>
        </div>
      </form>

      <Modal
        open={addIndividualOpen}
        onClose={() => setAddIndividualOpen(false)}
        title="Add Individual"
        size="lg"
      >
        <IndividualCreateForm
          onCancel={() => setAddIndividualOpen(false)}
          onSuccess={({ id, identification_number }) => {
            setValue('owner_type', 'individual');
            setValue('owner_id', id, { shouldValidate: true });
            if (isLand) {
              setOwnerIdRegLabel(identification_number ?? '');
            }
            setAddIndividualOpen(false);
          }}
        />
      </Modal>
      <Modal
        open={addCompanyOpen}
        onClose={() => setAddCompanyOpen(false)}
        title="Add Company"
        size="lg"
        disableBackdropClose
      >
        <CompanyCreateForm
          onCancel={() => setAddCompanyOpen(false)}
          onSuccess={({ id, registration_number }) => {
            setValue('owner_type', 'company');
            setValue('owner_id', id, { shouldValidate: true });
            if (isLand) {
              setOwnerIdRegLabel(registration_number ?? '');
            }
            setAddCompanyOpen(false);
          }}
        />
      </Modal>
      <Modal
        open={addCustodianIndividualOpen || addCustodianCompanyOpen}
        onClose={() => {
          setAddCustodianIndividualOpen(false);
          setAddCustodianCompanyOpen(false);
        }}
        title={
          currentCustodianType === 'company'
            ? 'Add Company Custodian'
            : 'Add Individual Custodian'
        }
        size="lg"
        disableBackdropClose
      >
        {currentCustodianType === 'company' ? (
          <CompanyCreateForm
            onCancel={() => setAddCustodianCompanyOpen(false)}
            onSuccess={({ id, name }) => {
              setValue('custodian_type', 'company');
              setValue('custodian_id', id, { shouldValidate: true });
              setCustodianSearchLabel(name || `Company #${id}`);
              setAddCustodianCompanyOpen(false);
              setAddCustodianIndividualOpen(false);
            }}
          />
        ) : (
          <IndividualCreateForm
            onCancel={() => setAddCustodianIndividualOpen(false)}
            onSuccess={({ id, name, identification_number }) => {
              setValue('custodian_type', 'individual');
              setValue('custodian_id', id, { shouldValidate: true });
              setCustodianSearchLabel(
                formatCustodianDisplay(
                  name || `Individual #${id}`,
                  identification_number ?? '',
                ),
              );
              setAddCustodianIndividualOpen(false);
              setAddCustodianCompanyOpen(false);
            }}
          />
        )}
      </Modal>
      <Modal
        open={addGuarantorOpen}
        onClose={() => setAddGuarantorOpen(false)}
        title="Add Guarantor"
        size="lg"
      >
        <IndividualCreateForm
          onCancel={() => setAddGuarantorOpen(false)}
          onSuccess={({ id, name, identification_number }) => {
            setValue('guarantor_name', name || `Individual #${id}`, {
              shouldValidate: true,
            });
            setValue('guarantor_identification', identification_number ?? '', {
              shouldValidate: true,
            });
            setGuarantorSelectedId(id);
            setAddGuarantorOpen(false);
          }}
        />
      </Modal>
    </>
  );
}
