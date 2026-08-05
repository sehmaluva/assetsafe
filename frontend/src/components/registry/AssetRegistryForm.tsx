import { useEffect, useState } from 'react';
import { useForm, useFormState, Controller } from 'react-hook-form';
import { zodResolver } from '@/lib/zodResolver';
import { applyApiValidationErrors } from '@/lib/formErrors';
import { z } from 'zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { assetRegistryApi } from '@/api/assetRegistryApi';
import { Input } from '@/components/ui/input';
import { DateInput } from '@/components/ui/DateInput';
import AutocompleteInput from '@/components/shared/AutocompleteInput';
import { individualsApi } from '@/api/individualsApi';
import { companiesApi } from '@/api/companiesApi';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/shared/Modal';
import { IndividualCreateForm } from '@/components/individuals/IndividualCreateForm';
import { CompanyCreateForm } from '@/components/companies/CompanyCreateForm';
import { UserPlus, Building } from 'lucide-react';
import { FormSectionHeader } from '@/components/shared/FormSectionHeader';
import { FieldError } from '@/components/shared/FieldError';
import { commonApi } from '@/api/commonApi';
import { queryOptions } from '@/api/queryOptions';
import type { SearchOption } from '@/lib/searchResults';

const schema = z
  .object({
    owner_type: z.string().min(1, 'Owner Type is required'),
    owner_id: z
      .number({ error: 'Owner is required' })
      .min(1, 'Owner is required'),
    owner_asset_number: z.string().optional(),
    asset_category: z.string().min(1, 'Select asset category'),
    asset_type: z.string().min(1, 'Asset type is required'),
    asset_make: z.string().min(1, 'Required'),
    asset_model: z.string().min(1, 'Required'),
    year_of_make: z.coerce.number().min(1900).max(2100),
    condition: z.string().min(1, 'Select condition'),
    mv_registration_no: z.string().optional(),
    chassis_number: z.string().optional(),
    engine_number: z.string().optional(),
    serial_number: z.string().optional(),
    currency: z.string().min(1, 'Currency is required'),
    estimated_value: z.coerce.number().min(0),
    location_address: z.string().min(1, 'Required'),
    subscription_start_date: z.string().min(1, 'Required'),
    subscription_end_date: z.string().min(1, 'Required'),
    under_custody: z.boolean().optional(),
    custodian_type: z.string().optional(),
    custodian_id: z.number().optional(),
    custody_type: z.string().optional(),
    custodian_address: z.string().optional(),
    custodian_email: z.string().optional(),
    custodian_mobile: z.string().optional(),
    custodian_telephone: z.string().optional(),
    guarantor_name: z.string().optional(),
    guarantor_identification: z.string().optional(),
  })
  .superRefine((data, ctx) => {
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
    if (!data.custodian_address?.trim()) {
      ctx.addIssue({
        code: 'custom',
        message: 'Custodian address is required',
        path: ['custodian_address'],
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
  const [guarantorSelectedId, setGuarantorSelectedId] = useState<
    number | undefined
  >();

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
  const { data: choices = {} } = useQuery({
    queryKey: ['common-choices'],
    queryFn: commonApi.getChoices,
    ...queryOptions.lists,
  });

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
    address?: string;
  }) => {
    setValue('custodian_address', contact.address ?? '', {
      shouldValidate: true,
    });
    setValue('custodian_email', contact.email ?? '');
    setValue('custodian_mobile', contact.phone ?? '');
    setValue('custodian_telephone', contact.telephone ?? '');
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
  const isVehicle = watchAssetCategory === 'vehicles';

  const { mutate: submit, isPending } = useMutation({
    mutationFn: (data: FormValues) => {
      const payload = {
        ...data,
        custody_type: data.under_custody ? data.custody_type : '',
        custodian_type: data.under_custody ? data.custodian_type : '',
        custodian_id: data.under_custody ? data.custodian_id : undefined,
      };
      return isEdit && recordId
        ? assetRegistryApi.updateRecord(recordId, payload as any)
        : assetRegistryApi.createRecord(payload as any);
    },
    onSuccess,
    onError: (err: unknown) => {
      if (!applyApiValidationErrors(setError, err)) {
        const data = (
          err as { response?: { data?: { message?: string; error?: string } } }
        )?.response?.data;
        toast.error(data?.message ?? data?.error ?? 'Failed to save');
      } else {
        toast.error('Please fix the highlighted fields');
      }
    },
  });

  const onInvalid = () => {
    toast.error('Please fix the highlighted fields');
  };

  return (
    <>
      <form
        onSubmit={handleSubmit((d) => submit(d), onInvalid)}
        className="bg-white"
        noValidate
      >
        <FormSectionHeader title="Owner Details" variant="teal" />
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
          <div>
            <label className="text-xs font-medium text-slate-600">
              Owner Type
            </label>
            <select
              {...register('owner_type')}
              className="mt-1 h-8 w-full rounded border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:border-[#0f7d8e]"
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
            </select>
          </div>
          <div className="col-span-2">
            <Controller
              name="owner_id"
              control={control}
              render={({ field }) => (
                <AutocompleteInput
                  label="Name / ID / Co. Reg #"
                  placeholder="Search owner..."
                  queryKey={`asset-owner-${watch('owner_type')}`}
                  displayLabel={ownerDisplayLabel}
                  fetchFn={(q) =>
                    watch('owner_type') === 'company'
                      ? companiesApi.searchBranches(q)
                      : individualsApi.searchIndividuals(q)
                  }
                  resolveSelection={(item) =>
                    watch('owner_type') === 'company'
                      ? companiesApi.resolveBranchSelection(item)
                      : individualsApi.resolveIndividualSelection(item)
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
                  onChange={(v) => field.onChange(Number(v))}
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

        {/* ── Asset Details ── */}
        <FormSectionHeader title="Asset Details" variant="dark" />
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
          <div>
            <label className="text-xs font-medium text-slate-600">
              Asset Category<span className="text-red-500 ml-0.5">*</span>
            </label>
            <select
              {...register('asset_category')}
              className="mt-1 h-8 w-full rounded border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:border-[#0f7d8e]"
              disabled={!assetCategoryOptions.length}
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
            </select>
            <FieldError message={errors.asset_category?.message} />
          </div>
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
          <div>
            <label className="text-xs font-medium text-slate-600">
              Condition
            </label>
            <select
              {...register('condition')}
              className="mt-1 h-8 w-full rounded border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:border-[#0f7d8e]"
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
            </select>
          </div>
          <Input
            label="MV Registration No."
            {...register('mv_registration_no')}
            disabled={!isVehicle}
            className={!isVehicle ? 'bg-slate-100' : ''}
          />
          <Input
            label="Chassis Number"
            {...register('chassis_number')}
            disabled={!isVehicle}
            className={!isVehicle ? 'bg-slate-100' : ''}
          />
          <Input
            label="Engine Number"
            {...register('engine_number')}
            disabled={!isVehicle}
            className={!isVehicle ? 'bg-slate-100' : ''}
          />
          <Input label="Serial Number" {...register('serial_number')} />
        </div>

        {/* ── Valuation & Subscription ── */}
        <FormSectionHeader title="Valuation & Subscription" variant="teal" />
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
          <div>
            <label className="text-xs font-medium text-slate-600">
              Currency<span className="text-red-500 ml-0.5">*</span>
            </label>
            <select
              {...register('currency')}
              className="mt-1 h-8 w-full rounded border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:border-[#0f7d8e]"
              disabled={!currencies.length}
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
            </select>
          </div>
          <Input
            label="Estimated Value"
            type="number"
            step="0.01"
            {...register('estimated_value')}
            error={errors.estimated_value?.message}
            required
          />
          <div className="col-span-2">
            <Input
              label="Location Address"
              {...register('location_address')}
              error={errors.location_address?.message}
              placeholder="Primary location of asset"
              required
            />
          </div>
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
                  setValue('custodian_address', '');
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
              <div>
                <label className="text-xs font-medium text-slate-600">
                  Custodian Type
                </label>
                <select
                  {...register('custodian_type', {
                    onChange: () => {
                      setValue('custodian_id', undefined);
                      setCustodianSearchLabel('');
                      setValue('custodian_address', '');
                      setValue('custodian_email', '');
                      setValue('custodian_mobile', '');
                      setValue('custodian_telephone', '');
                    },
                  })}
                  className="mt-1 h-8 w-full rounded border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:border-[#0f7d8e]"
                >
                  {partyTypeOptions.map((option: any) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <FieldError message={errors.custodian_type?.message} />
              </div>
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
                          setValue('custodian_address', '');
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
                  label="Address"
                  {...register('custodian_address')}
                  placeholder="Auto-fill or enter address"
                  required
                  error={errors.custodian_address?.message}
                />
              </div>
              <Input label="Mobile" {...register('custodian_mobile')} />
              <Input label="Email" {...register('custodian_email')} />
              <Input label="Telephone" {...register('custodian_telephone')} />
              <div>
                <label className="text-xs font-medium text-slate-600">
                  Custody Type
                </label>
                <select
                  {...register('custody_type')}
                  className="mt-1 h-8 w-full rounded border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:border-[#0f7d8e]"
                >
                  <option value="">Select custody type...</option>
                  {custodyTypeOptions.map((option: any) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <FieldError message={errors.custody_type?.message} />
              </div>
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
          onSuccess={({ id }) => {
            setValue('owner_type', 'individual');
            setValue('owner_id', id, { shouldValidate: true });
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
          onSuccess={({ id }) => {
            setValue('owner_type', 'company');
            setValue('owner_id', id, { shouldValidate: true });
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
