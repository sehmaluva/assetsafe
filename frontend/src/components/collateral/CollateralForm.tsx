import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm, useFormState, Controller } from 'react-hook-form';
import { zodResolver } from '@/lib/zodResolver';
import {
  applyApiValidationErrors,
  firstFormErrorMessage,
  getApiErrorMessage,
} from '@/lib/formErrors';
import type { FieldErrors } from 'react-hook-form';
import { z } from 'zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { UserPlus, Building } from 'lucide-react';
import { collateralApi } from '@/api/collateralApi';
import { clientsApi } from '@/api/clientsApi';
import { individualsApi } from '@/api/individualsApi';
import { companiesApi } from '@/api/companiesApi';
import { Input } from '@/components/ui/input';
import { DateInput } from '@/components/ui/DateInput';
import AutocompleteInput from '@/components/shared/AutocompleteInput';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { FormSectionHeader } from '@/components/shared/FormSectionHeader';
import { FieldError } from '@/components/shared/FieldError';
import { Modal } from '@/components/shared/Modal';
import { IndividualCreateForm } from '@/components/individuals/IndividualCreateForm';
import { CompanyCreateForm } from '@/components/companies/CompanyCreateForm';
import { ClientCreateForm } from '@/components/clients/ClientCreateForm';
import { commonApi } from '@/api/commonApi';
import { queryOptions } from '@/api/queryOptions';
import { useAuthStore } from '@/store';
import { isStaffUser } from '@/lib/registryNav';
import { cn } from '@/lib/utils';
import { authApi } from '@/api/authApi';
import { usersApi } from '@/api/usersApi';

const collateralCoreSchema = z.object({
  data_date: z.string().min(1, 'Required'),
  debtor_type: z.string().min(1, 'Debtor Type is required'),
  debtor_id: z
    .number({ error: 'Debtor is required' })
    .min(1, 'Debtor is required'),
  agreement_number: z.string().min(1, 'Required'),
  asset_category: z.string().min(1, 'Select asset category'),
  asset_type: z.string().min(1, 'Asset type is required'),
  asset_make: z.string().min(1, 'Required'),
  asset_model: z.string().min(1, 'Required'),
  asset_year: z.coerce.number().min(1900).max(2100),
  asset_condition: z.string().min(1, 'Select condition'),
  asset_registration_no: z.string().optional(),
  chassis_number: z.string().optional(),
  engine_number: z.string().optional(),
  serial_number: z.string().optional(),
  currency: z.string().min(1, 'Currency is required'),
  loan_amount: z.coerce.number().min(0),
  instalment_amount: z.coerce.number().min(0),
  instalment_date: z.coerce.number().min(1).max(31),
  total_paid_to_date: z.coerce.number().min(0),
  start_date: z.string().min(1),
  end_date: z.string().min(1),
});

const staffCollateralSchema = collateralCoreSchema.extend({
  financier_id: z
    .number({ error: 'Financier is required' })
    .min(1, 'Financier is required'),
});

function buildCollateralSchema(isClientUser: boolean) {
  return isClientUser ? collateralCoreSchema : staffCollateralSchema;
}

type CoreFormValues = z.infer<typeof collateralCoreSchema>;
type StaffFormValues = z.infer<typeof staffCollateralSchema>;
type FormValues = CoreFormValues & { financier_id?: number };

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-slate-700">{label}</label>
      <div className="flex h-8 w-full items-center rounded-sm border border-slate-200 bg-slate-50 px-2.5 text-sm text-slate-800">
        {value || '—'}
      </div>
    </div>
  );
}

interface CollateralFormProps {
  initial?: Partial<FormValues>;
  financierDisplayLabel?: string;
  dataSourceDisplayLabel?: string;
  dataSourcePositionLabel?: string;
  debtorDisplayLabel?: string;
  onSuccess: () => void;
  onCancel: () => void;
  /** When true shows "Save & Add Another" instead of "Upload" */
  onSuccessAndAddAnother?: () => void;
  isEdit?: boolean;
  recordId?: number;
  /** Edit mode only: invoked when "Close" is clicked, to discharge the record. */
  onDischarge?: () => void;
  /** Edit mode only: loading state for the discharge action. */
  dischargePending?: boolean;
}

export function CollateralForm({
  initial,
  financierDisplayLabel,
  dataSourceDisplayLabel,
  dataSourcePositionLabel,
  debtorDisplayLabel,
  onSuccess,
  onCancel,
  onSuccessAndAddAnother,
  isEdit,
  recordId,
  onDischarge,
  dischargePending,
}: CollateralFormProps) {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const isStaff = isStaffUser(user);
  const isClientUser = !isStaff && !!user;
  const clientFinancierId = user?.client_id;

  const formSchema = useMemo(
    () => buildCollateralSchema(isClientUser),
    [isClientUser],
  );

  const [addIndividualOpen, setAddIndividualOpen] = useState(false);
  const [addCompanyOpen, setAddCompanyOpen] = useState(false);
  const [addClientOpen, setAddClientOpen] = useState(false);
  const [financierLabel, setFinancierLabel] = useState(
    financierDisplayLabel ?? '',
  );
  const [financierClientType, setFinancierClientType] = useState<
    'individual' | 'company'
  >('company');
  const isFirstFinancierClientTypeRender = useRef(true);
  const [debtorLabel, setDebtorLabel] = useState(debtorDisplayLabel ?? '');
  const isFirstDebtorTypeRender = useRef(true);
  const [dataSourceUserId, setDataSourceUserId] = useState<
    number | undefined
  >();
  const [staffDataSourceName, setStaffDataSourceName] = useState('');
  const [staffDataSourcePosition, setStaffDataSourcePosition] = useState('');
  const [staffDataSourceSearchLabel, setStaffDataSourceSearchLabel] =
    useState('');
  const [positionOverride, setPositionOverride] = useState('');

  const clearDataSource = () => {
    setDataSourceUserId(undefined);
    setStaffDataSourceName('');
    setStaffDataSourcePosition('');
    setStaffDataSourceSearchLabel('');
    setPositionOverride('');
  };

  const { register, handleSubmit, control, watch, setError, setValue } =
    useForm<FormValues>({
      resolver: zodResolver(formSchema),
      mode: 'onBlur',
      reValidateMode: 'onChange',
      shouldFocusError: true,
      defaultValues: {
        debtor_type: 'individual',
        data_date: new Date().toISOString().split('T')[0],
        currency: '',
        asset_category: '',
        asset_type: '',
        asset_year: new Date().getFullYear(),
        total_paid_to_date: 0,
        instalment_amount: 0,
        instalment_date: 1,
        ...(isClientUser ? {} : { financier_id: clientFinancierId }),
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
    ...queryOptions.static,
  });

  const partyTypeOptions = choices.PartyType ?? [];
  const assetCategoryOptions =
    choices.CollateralAssetCategory ?? choices.CollateralAssetType ?? [];
  const assetConditionOptions = choices.AssetCondition ?? [];
  const selectedFinancierId = watch('financier_id');

  const { data: clientUsers = [], isLoading: clientUsersLoading } = useQuery({
    queryKey: ['collateral-client-users', selectedFinancierId],
    queryFn: () => clientsApi.listClientUsers(Number(selectedFinancierId)),
    enabled:
      !isEdit &&
      isStaff &&
      !!selectedFinancierId &&
      Number(selectedFinancierId) > 0,
  });
  const clientUsersBusy = clientUsersLoading;

  const { data: clientDetail } = useQuery({
    queryKey: ['collateral-client-detail', selectedFinancierId],
    queryFn: () => clientsApi.getClient(Number(selectedFinancierId)),
    enabled:
      !isEdit &&
      isStaff &&
      financierClientType === 'individual' &&
      !!selectedFinancierId &&
      Number(selectedFinancierId) > 0,
  });

  useEffect(() => {
    if (!watch('currency') && currencies.length > 0) {
      setValue('currency', currencies[0].code, { shouldValidate: true });
    }
  }, [currencies, setValue, watch]);

  useEffect(() => {
    if (!watch('asset_condition') && assetConditionOptions.length > 0) {
      setValue('asset_condition', assetConditionOptions[0].value, {
        shouldValidate: true,
      });
    }
  }, [assetConditionOptions, setValue, watch]);

  useEffect(() => {
    if (!watch('debtor_type') && partyTypeOptions.length > 0) {
      const defaultDebtor =
        partyTypeOptions.find((p: any) => p.value === 'individual') ||
        partyTypeOptions[0];
      setValue('debtor_type', defaultDebtor.value, { shouldValidate: true });
    }
  }, [partyTypeOptions, setValue, watch]);

  useEffect(() => {
    if (isStaff || user?.client_id) return;
    void authApi
      .me()
      .then(setUser)
      .catch(() => {});
  }, [isStaff, user?.client_id, setUser]);

  useEffect(() => {
    if (!isClientUser || !clientFinancierId) return;
    if (financierDisplayLabel) {
      setFinancierLabel(financierDisplayLabel);
    } else {
      setFinancierLabel(user?.client_name ?? '');
    }
  }, [
    isClientUser,
    clientFinancierId,
    user?.client_name,
    financierDisplayLabel,
  ]);

  useEffect(() => {
    if (isClientUser || isEdit) return;
    if (isFirstFinancierClientTypeRender.current) {
      isFirstFinancierClientTypeRender.current = false;
      return;
    }
    setValue('financier_id', 0 as unknown as number);
    setFinancierLabel('');
    setAddClientOpen(false);
  }, [financierClientType, isClientUser, isEdit, setValue]);

  useEffect(() => {
    if (isEdit || isClientUser) return;
    clearDataSource();
  }, [selectedFinancierId, isEdit, isClientUser]);

  useEffect(() => {
    if (
      isEdit ||
      !isStaff ||
      financierClientType !== 'individual' ||
      !clientDetail
    ) {
      return;
    }
    const details = clientDetail.client_details;
    const individualName =
      (details?.full_name ??
        `${details?.first_name ?? ''} ${details?.last_name ?? ''}`.trim()) ||
      clientDetail.name;
    setStaffDataSourceName(individualName);
    setStaffDataSourceSearchLabel(individualName);
    setStaffDataSourcePosition('');
  }, [clientDetail, financierClientType, isEdit, isStaff]);

  useEffect(() => {
    if (isEdit || !isStaff || financierClientType !== 'individual') return;
    if (clientUsers.length === 1) {
      const linkedUser = clientUsers[0];
      setDataSourceUserId(linkedUser.id);
      if (linkedUser.position) {
        setStaffDataSourcePosition(linkedUser.position);
      }
    }
  }, [clientUsers, financierClientType, isEdit, isStaff]);

  const watchedDebtorType = watch('debtor_type');
  useEffect(() => {
    if (isEdit) return;
    if (isFirstDebtorTypeRender.current) {
      isFirstDebtorTypeRender.current = false;
      return;
    }
    setValue('debtor_id', 0 as unknown as number);
    setDebtorLabel('');
    setAddIndividualOpen(false);
    setAddCompanyOpen(false);
  }, [watchedDebtorType, isEdit, setValue]);

  useEffect(() => {
    if (debtorDisplayLabel) {
      setDebtorLabel(debtorDisplayLabel);
    }
  }, [debtorDisplayLabel]);

  useEffect(() => {
    if (financierDisplayLabel) {
      setFinancierLabel(financierDisplayLabel);
    }
  }, [financierDisplayLabel]);

  const debtorTypeLabel =
    partyTypeOptions.find(
      (option: { value: string }) => option.value === watchedDebtorType,
    )?.label ?? watchedDebtorType;

  const watchedAssetCategory = watch('asset_category');
  const isVehicle = watchedAssetCategory === 'vehicles';
  const computedBalance =
    (watch('loan_amount') ?? 0) - (watch('total_paid_to_date') ?? 0);

  const [addAnother, setAddAnother] = useState(false);
  const [confirmingUpdate, setConfirmingUpdate] = useState(false);
  const [pendingSubmit, setPendingSubmit] = useState<FormValues | null>(null);

  const { mutate: submit, isPending } = useMutation({
    mutationFn: (data: FormValues) =>
      isEdit && recordId
        ? collateralApi.updateRecord(recordId, data as any)
        : collateralApi.createRecord(data as any),
    onSuccess: () => {
      setConfirmingUpdate(false);
      setPendingSubmit(null);
      if (addAnother && onSuccessAndAddAnother) {
        onSuccessAndAddAnother();
      } else {
        onSuccess();
      }
    },
    onError: (err: unknown) => {
      setConfirmingUpdate(false);
      setAddAnother(false);
      if (!applyApiValidationErrors(setError, err)) {
        toast.error(getApiErrorMessage(err) ?? 'Failed to save record');
      } else {
        toast.error('Please fix the highlighted fields');
      }
    },
  });

  const onInvalid = (formErrors: FieldErrors<FormValues>) => {
    setAddAnother(false);
    toast.error(
      firstFormErrorMessage(formErrors) ?? 'Please fix the highlighted fields',
    );
  };

  const buildSubmitPayload = (data: FormValues) => {
    const payload = isClientUser
      ? ({ ...data, financier_id: clientFinancierId } as StaffFormValues)
      : (data as StaffFormValues);

    if (isStaff && !isEdit && dataSourceUserId) {
      return { ...payload, data_source_user_id: dataSourceUserId };
    }
    return payload;
  };

  const persistBlankDataSourcePosition = async () => {
    if (isEdit) return;
    const override = positionOverride.trim();
    if (!override) return;

    if (isClientUser) {
      if (!(user?.position ?? '').trim() && user?.id) {
        await authApi.updateProfile({ position: override });
        useAuthStore.getState().setUser({
          ...user,
          position: override,
        });
      }
      return;
    }

    if (dataSourceUserId && !staffDataSourcePosition.trim()) {
      await usersApi.update(dataSourceUserId, { position: override });
      setStaffDataSourcePosition(override);
    }
  };

  const performSubmit = async (data: FormValues) => {
    try {
      await persistBlankDataSourcePosition();
    } catch {
      toast.error('Could not save data source position');
      return;
    }
    submit(buildSubmitPayload(data) as any);
  };

  const validateStaffDataSource = () => {
    if (
      !isStaff ||
      isEdit ||
      !selectedFinancierId ||
      Number(selectedFinancierId) <= 0
    ) {
      return true;
    }
    if (financierClientType === 'company' && !dataSourceUserId) {
      toast.error(
        'Please select a data source user for this company financier.',
      );
      return false;
    }
    return true;
  };

  const onFormSubmit = handleSubmit((data) => {
    if (isClientUser && !clientFinancierId) {
      toast.error(
        'Unable to load your financier profile. Please refresh and try again.',
      );
      return;
    }
    if (!validateStaffDataSource()) return;
    if (isEdit) {
      setPendingSubmit(data);
      setConfirmingUpdate(true);
      return;
    }
    performSubmit(data);
  }, onInvalid);

  const handleConfirmUpdate = () => {
    if (pendingSubmit) {
      performSubmit(pendingSubmit);
    }
  };

  return (
    <>
      <form onSubmit={onFormSubmit} className="bg-white" noValidate>
        {/* ── Financier Section ── */}
        <FormSectionHeader title="Financier" variant="teal" />
        {isEdit ? (
          <>
            <div className="grid grid-cols-2 gap-3 p-4 pb-2 sm:grid-cols-4">
              <div className="col-span-2">
                <ReadOnlyField
                  label="Financier Name"
                  value={financierLabel || financierDisplayLabel || ''}
                />
              </div>
              <Controller
                name="data_date"
                control={control}
                render={({ field, fieldState }) => (
                  <DateInput
                    label="Data Date"
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    error={fieldState.error?.message}
                    required
                  />
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-3 px-4 pb-4 sm:grid-cols-4">
              <div className="col-span-2">
                <ReadOnlyField
                  label="Data Source Name"
                  value={dataSourceDisplayLabel ?? user?.name ?? ''}
                />
              </div>
              <div className="col-span-2">
                <ReadOnlyField
                  label="Position"
                  value={dataSourcePositionLabel ?? user?.position ?? ''}
                />
              </div>
            </div>
          </>
        ) : isClientUser ? (
          <>
            <div className="grid grid-cols-2 gap-3 p-4 pb-2 sm:grid-cols-4">
              <div className="col-span-2 space-y-1">
                <label className="text-xs font-medium text-slate-700">
                  Financier Name
                </label>
                <div
                  className={cn(
                    'flex h-8 w-full items-center rounded-sm border bg-slate-50 px-2.5 text-sm text-slate-800',
                    !clientFinancierId ? 'border-red-500' : 'border-slate-200',
                  )}
                >
                  {financierLabel || user?.client_name || '—'}
                </div>
                {!clientFinancierId && (
                  <FieldError message="Financier profile not loaded. Please refresh the page." />
                )}
              </div>
              <Controller
                name="data_date"
                control={control}
                render={({ field, fieldState }) => (
                  <DateInput
                    label="Data Date"
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    error={fieldState.error?.message}
                    required
                  />
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-3 px-4 pb-4 sm:grid-cols-4">
              <div className="col-span-2 space-y-1">
                <label className="text-xs font-medium text-slate-700">
                  Data Source Name
                </label>
                <div className="flex h-8 w-full items-center rounded-sm border border-slate-200 bg-slate-50 px-2.5 text-sm text-slate-800">
                  {user?.name ?? '—'}
                </div>
              </div>
              <div className="col-span-2 space-y-1">
                <label className="text-xs font-medium text-slate-700">
                  Position
                </label>
                {(user?.position ?? '').trim() ? (
                  <div className="flex h-8 w-full items-center rounded-sm border border-slate-200 bg-slate-50 px-2.5 text-sm text-slate-800">
                    {user?.position}
                  </div>
                ) : (
                  <input
                    type="text"
                    value={positionOverride}
                    onChange={(e) => setPositionOverride(e.target.value)}
                    placeholder="Enter position"
                    className="mt-0 h-8 w-full rounded-sm border border-slate-300 bg-white px-2.5 text-sm text-slate-900 focus:border-[#0f7d8e] focus:outline-none"
                  />
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 p-4 pb-2 sm:grid-cols-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-700">
                  Financier Type
                </label>
                <select
                  value={financierClientType}
                  onChange={(e) =>
                    setFinancierClientType(
                      e.target.value as 'individual' | 'company',
                    )
                  }
                  className="h-8 w-full rounded-sm border border-slate-500 bg-white px-2.5 text-sm text-slate-900 focus:border-black focus:outline-none focus:ring-0"
                  disabled={!partyTypeOptions.length}
                >
                  {partyTypeOptions.length === 0 ? (
                    <option value="company">Loading...</option>
                  ) : (
                    partyTypeOptions.map((option: any) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))
                  )}
                </select>
              </div>
              <div className="col-span-2">
                <Controller
                  name="financier_id"
                  control={control}
                  render={({ field }) => (
                    <AutocompleteInput
                      label="Financier Name"
                      placeholder="Search financier..."
                      queryKey={`collateral-financier-${financierClientType}`}
                      displayLabel={financierLabel}
                      fetchFn={(q) =>
                        clientsApi.searchClients(q, {
                          entityType: financierClientType,
                        })
                      }
                      error={errors.financier_id?.message}
                      value={field.value}
                      onBlur={field.onBlur}
                      onChange={(v) => field.onChange(Number(v))}
                    />
                  )}
                />
              </div>
              <Controller
                name="data_date"
                control={control}
                render={({ field, fieldState }) => (
                  <DateInput
                    label="Data Date"
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    error={fieldState.error?.message}
                    required
                  />
                )}
              />
            </div>
            {selectedFinancierId && Number(selectedFinancierId) > 0 ? (
              <div className="grid grid-cols-2 gap-3 px-4 pb-4 sm:grid-cols-4">
                <div className="col-span-2">
                  {financierClientType === 'company' ? (
                    <AutocompleteInput
                      label="Data Source Name"
                      placeholder="Search user under client..."
                      queryKey={`collateral-data-source-${selectedFinancierId}-${clientUsers.length}`}
                      displayLabel={staffDataSourceSearchLabel}
                      minChars={1}
                      externalLoading={clientUsersBusy}
                      loadingLabel="Fetching users..."
                      fetchFn={async (q) => {
                        const term = q.trim().toLowerCase();
                        if (!term) return [];
                        return clientUsers
                          .filter(
                            (u) =>
                              u.name.toLowerCase().includes(term) ||
                              (u.position?.toLowerCase().includes(term) ??
                                false),
                          )
                          .map((u) => ({
                            id: u.id,
                            name: u.name,
                            subtitle: u.position,
                          }));
                      }}
                      value={dataSourceUserId}
                      onChange={(id) => {
                        const selected = clientUsers.find((u) => u.id === id);
                        setDataSourceUserId(id);
                        setStaffDataSourceName(selected?.name ?? '');
                        setStaffDataSourcePosition(selected?.position ?? '');
                        setStaffDataSourceSearchLabel(selected?.name ?? '');
                        setPositionOverride('');
                      }}
                    />
                  ) : (
                    <ReadOnlyField
                      label="Data Source Name"
                      value={staffDataSourceName}
                    />
                  )}
                </div>
                <div className="col-span-2">
                  {staffDataSourcePosition.trim() ? (
                    <ReadOnlyField
                      label="Position"
                      value={staffDataSourcePosition}
                    />
                  ) : (
                    <Input
                      label="Position"
                      value={positionOverride}
                      onChange={(e) => setPositionOverride(e.target.value)}
                      placeholder="Enter position"
                    />
                  )}
                </div>
              </div>
            ) : null}
            {isStaff && (
              <div className="flex gap-2 px-4 pb-4">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  leftIcon={<UserPlus className="h-3 w-3" />}
                  onClick={() => setAddClientOpen(true)}
                >
                  + Add Client
                </Button>
              </div>
            )}
          </>
        )}

        {/* ── Debtor Section ── */}
        <FormSectionHeader title="Debtor" variant="teal" />
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
        {isEdit ? (
          <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
            <ReadOnlyField label="Debtor Type" value={debtorTypeLabel} />
            <div className="col-span-3">
              <ReadOnlyField
                label="Debtor"
                value={debtorLabel || debtorDisplayLabel || ''}
              />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
            <div>
              <label className="text-xs font-medium text-slate-600">
                Debtor Type
              </label>
              <select
                {...register('debtor_type')}
                className="mt-1 h-8 w-full rounded border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:border-[#0f7d8e]"
                disabled={!partyTypeOptions.length}
              >
                <option value="">
                  {partyTypeOptions.length ? 'Select type...' : 'Loading...'}
                </option>
                {partyTypeOptions.map((option: any) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-3">
              <Controller
                name="debtor_id"
                control={control}
                render={({ field }) => (
                  <AutocompleteInput
                    label="Name / ID / Reg. No."
                    placeholder="Search debtor..."
                    queryKey={`collateral-debtor-${watch('debtor_type')}`}
                    displayLabel={debtorLabel}
                    fetchFn={(q) =>
                      watch('debtor_type') === 'company'
                        ? companiesApi.searchBranches(q)
                        : individualsApi.searchIndividuals(q)
                    }
                    resolveSelection={(item) =>
                      watch('debtor_type') === 'company'
                        ? companiesApi.resolveBranchSelection(item)
                        : individualsApi.resolveIndividualSelection(item)
                    }
                    createLabel={
                      watch('debtor_type') === 'company'
                        ? 'Create company'
                        : 'Create individual'
                    }
                    onCreateNew={() => {
                      if (watch('debtor_type') === 'company') {
                        setAddCompanyOpen(true);
                      } else {
                        setAddIndividualOpen(true);
                      }
                    }}
                    error={errors.debtor_id?.message}
                    value={field.value}
                    onBlur={field.onBlur}
                    onChange={(v) => field.onChange(Number(v))}
                  />
                )}
              />
            </div>
          </div>
        )}

        {/* ── Agreement & Asset Details ── */}
        <FormSectionHeader title="Agreement & Asset Details" variant="dark" />
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
          <Input
            label="Agreement Number"
            {...register('agreement_number')}
            error={errors.agreement_number?.message}
            required
          />
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
                  ? 'Click to select...'
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
            label="Year"
            type="number"
            {...register('asset_year')}
            error={errors.asset_year?.message}
            required
          />
          <div>
            <label className="text-xs font-medium text-slate-600">
              Condition
            </label>
            <select
              {...register('asset_condition')}
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
            <FieldError message={errors.asset_condition?.message} />
          </div>
          <Input
            label="MV Registration No."
            {...register('asset_registration_no')}
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

        {/* ── Financial Details ── */}
        <FormSectionHeader title="Financial Details" variant="teal" />
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
                {currencies.length ? 'Select currency...' : 'Loading...'}
              </option>
              {currencies.map((currency) => (
                <option key={currency.code} value={currency.code}>
                  {currency.code} - {currency.name}
                </option>
              ))}
            </select>
            <FieldError message={errors.currency?.message} />
          </div>
          <Input
            label="Total Debt"
            type="number"
            step="0.01"
            {...register('loan_amount')}
            error={errors.loan_amount?.message}
            required
          />
          <Input
            label="Instalment Amount"
            type="number"
            step="0.01"
            {...register('instalment_amount')}
          />
          <Input
            label="Instalment Date (dd)"
            type="number"
            min="1"
            max="31"
            {...register('instalment_date')}
            error={errors.instalment_date?.message}
          />
          <Input
            label="Total Paid to Date"
            type="number"
            step="0.01"
            {...register('total_paid_to_date')}
          />
          <div>
            <label className="text-xs font-medium text-slate-600">
              Balance
            </label>
            <div className="mt-1 flex h-8 w-full items-center rounded border border-slate-200 bg-slate-50 px-2 text-sm text-slate-700">
              {computedBalance.toFixed(2)}
            </div>
          </div>
          <Controller
            name="start_date"
            control={control}
            render={({ field, fieldState }) => (
              <DateInput
                label="Agreement Start Date"
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
                required
              />
            )}
          />
          <Controller
            name="end_date"
            control={control}
            render={({ field, fieldState }) => (
              <DateInput
                label="Agreement End Date"
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                error={fieldState.error?.message}
                required
              />
            )}
          />
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3">
          {isEdit ? (
            <>
              <Button
                type="submit"
                variant="secondary"
                loading={isPending}
                onClick={() => setAddAnother(false)}
              >
                Update
              </Button>
              <Button
                type="button"
                variant="danger"
                loading={dischargePending}
                onClick={onDischarge}
              >
                Close
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="ghost" onClick={onCancel}>
                {onSuccessAndAddAnother ? 'Done' : 'Cancel'}
              </Button>
              <div className="flex gap-2">
                {onSuccessAndAddAnother && (
                  <Button
                    type="submit"
                    variant="secondary"
                    loading={isPending && addAnother}
                    disabled={isPending && !addAnother}
                    onClick={() => setAddAnother(true)}
                  >
                    Save & Add Another
                  </Button>
                )}
                <Button
                  type="submit"
                  loading={isPending && !addAnother}
                  disabled={isPending && addAnother}
                  onClick={() => setAddAnother(false)}
                >
                  {onSuccessAndAddAnother ? 'Save' : 'Upload'}
                </Button>
              </div>
            </>
          )}
        </div>
      </form>

      <Modal
        open={addClientOpen}
        onClose={() => setAddClientOpen(false)}
        title="Add Client"
        size="md"
      >
        <ClientCreateForm
          onCancel={() => setAddClientOpen(false)}
          initialEntityType={financierClientType}
          onSuccess={({ id, name }) => {
            setValue('financier_id', id, { shouldValidate: true });
            setFinancierLabel(name);
            setAddClientOpen(false);
          }}
        />
      </Modal>

      <Modal
        open={addIndividualOpen}
        onClose={() => setAddIndividualOpen(false)}
        title="Add Individual"
        size="lg"
      >
        <IndividualCreateForm
          onCancel={() => setAddIndividualOpen(false)}
          onSuccess={({ id, name }) => {
            setValue('debtor_type', 'individual');
            setValue('debtor_id', id, { shouldValidate: true });
            setDebtorLabel(name);
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
          onSuccess={({ id, name }) => {
            setValue('debtor_type', 'company');
            setValue('debtor_id', id, { shouldValidate: true });
            setDebtorLabel(name);
            setAddCompanyOpen(false);
          }}
        />
      </Modal>

      <ConfirmDialog
        open={confirmingUpdate}
        title="Confirm Update"
        message="Are you sure you want to save these changes?"
        confirmLabel="Yes, Update"
        variant="primary"
        loading={isPending}
        onConfirm={handleConfirmUpdate}
        onCancel={() => {
          setConfirmingUpdate(false);
          setPendingSubmit(null);
        }}
      />
    </>
  );
}
