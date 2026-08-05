import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm, useFormState, Controller } from 'react-hook-form';
import { zodResolver } from '@/lib/zodResolver';
import { applyApiValidationErrors, getApiErrorMessage } from '@/lib/formErrors';
import { z } from 'zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { UserPlus, Building } from 'lucide-react';
import { hirePurchaseApi } from '@/api/hirePurchaseApi';
import { clientsApi } from '@/api/clientsApi';
import { Modal } from '@/components/shared/Modal';
import { IndividualCreateForm } from '@/components/individuals/IndividualCreateForm';
import { CompanyCreateForm } from '@/components/companies/CompanyCreateForm';
import { ClientCreateForm } from '@/components/clients/ClientCreateForm';
import { Input } from '@/components/ui/input';
import { DateInput } from '@/components/ui/DateInput';
import AutocompleteInput from '@/components/shared/AutocompleteInput';
import { individualsApi } from '@/api/individualsApi';
import { companiesApi } from '@/api/companiesApi';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { FormSectionHeader } from '@/components/shared/FormSectionHeader';
import { FieldError } from '@/components/shared/FieldError';
import { commonApi } from '@/api/commonApi';
import { queryOptions } from '@/api/queryOptions';
import { useAuthStore } from '@/store';
import { isStaffUser } from '@/lib/registryNav';
import { cn } from '@/lib/utils';
import { authApi } from '@/api/authApi';
import { usersApi } from '@/api/usersApi';

const hpCoreSchema = z.object({
  data_date: z.string().min(1, 'Required'),
  purchaser_type: z.string().min(1, 'Purchaser Type is required'),
  purchaser_id: z
    .number({ error: 'Purchaser is required' })
    .min(1, 'Purchaser is required'),
  agreement_number: z.string().min(1, 'Required'),
  asset_category: z.string().min(1, 'Select asset category'),
  asset_type: z.string().min(1, 'Asset type is required'),
  asset_make: z.string().min(1, 'Required'),
  asset_model: z.string().optional(),
  asset_year: z.coerce.number().min(1900).max(2100),
  asset_condition: z.string().min(1, 'Select condition'),
  reg_serial_number: z.string().optional(),
  chassis_number: z.string().optional(),
  engine_number: z.string().optional(),
  currency: z.string().min(1, 'Currency is required'),
  purchase_amount: z.coerce.number().min(0),
  instalment_amount: z.coerce.number().min(0),
  instalment_date: z.coerce.number().min(1).max(31),
  total_paid_to_date: z.coerce.number().min(0),
  balance: z.coerce.number().min(0),
  start_date: z.string().min(1),
  end_date: z.string().min(1),
});

const staffHpSchema = hpCoreSchema.extend({
  financier_id: z
    .number({ error: 'Financier is required' })
    .min(1, 'Financier is required'),
});

function buildHpSchema(isClientUser: boolean) {
  return isClientUser ? hpCoreSchema : staffHpSchema;
}

type CoreFormValues = z.infer<typeof hpCoreSchema>;
type StaffFormValues = z.infer<typeof staffHpSchema>;
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

interface HirePurchaseFormProps {
  initial?: Partial<FormValues>;
  financierDisplayLabel?: string;
  purchaserDisplayLabel?: string;
  dataSourceDisplayLabel?: string;
  dataSourcePositionLabel?: string;
  onSuccess: () => void;
  onSaveAndAdd?: () => void;
  onCancel: () => void;
  isEdit?: boolean;
  recordId?: number;
  /** Edit mode only: invoked when "Close" is clicked, to confirm closure of the record. */
  onCloseRecord?: () => void;
  /** Edit mode only: loading state for the closure action. */
  closurePending?: boolean;
}

export function HirePurchaseForm({
  initial,
  financierDisplayLabel,
  purchaserDisplayLabel,
  dataSourceDisplayLabel,
  dataSourcePositionLabel,
  onSuccess,
  onSaveAndAdd,
  onCancel,
  isEdit,
  recordId,
  onCloseRecord,
  closurePending,
}: HirePurchaseFormProps) {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const isStaff = isStaffUser(user);
  const isClientUser = !isStaff && !!user;
  const clientFinancierId = user?.client_id;

  const formSchema = useMemo(
    () => buildHpSchema(isClientUser && !isEdit),
    [isClientUser, isEdit],
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
  const [purchaserLabel, setPurchaserLabel] = useState(
    purchaserDisplayLabel ?? '',
  );
  const isFirstPurchaserTypeRender = useRef(true);
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

  const { register, control, handleSubmit, watch, reset, setValue, setError } =
    useForm<FormValues>({
      resolver: zodResolver(formSchema),
      mode: 'onBlur',
      reValidateMode: 'onChange',
      shouldFocusError: true,
      defaultValues: {
        purchaser_type: 'individual',
        data_date: new Date().toISOString().split('T')[0],
        currency: '',
        asset_category: '',
        asset_type: '',
        asset_year: new Date().getFullYear(),
        asset_condition: 'new',
        total_paid_to_date: 0,
        balance: 0,
        ...(isClientUser && !isEdit ? {} : {}),
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
  const assetCategoryOptions = choices.BaseAssetType ?? [];
  const assetConditionOptions = choices.AssetCondition ?? [];
  const currentPurchaserType = watch('purchaser_type');
  const selectedFinancierId = watch('financier_id');

  const { data: clientUsers = [], isLoading: clientUsersLoading } = useQuery({
    queryKey: ['hp-client-users', selectedFinancierId],
    queryFn: () => clientsApi.listClientUsers(Number(selectedFinancierId)),
    enabled:
      !isEdit &&
      isStaff &&
      !!selectedFinancierId &&
      Number(selectedFinancierId) > 0,
  });
  const clientUsersBusy = clientUsersLoading;

  const { data: clientDetail } = useQuery({
    queryKey: ['hp-client-detail', selectedFinancierId],
    queryFn: () => clientsApi.getClient(Number(selectedFinancierId)),
    enabled:
      !isEdit &&
      isStaff &&
      financierClientType === 'individual' &&
      !!selectedFinancierId &&
      Number(selectedFinancierId) > 0,
  });

  const purchaserTypeLabel =
    partyTypeOptions.find(
      (option: { value: string }) => option.value === currentPurchaserType,
    )?.label ?? currentPurchaserType;

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
    if (!currentPurchaserType && partyTypeOptions.length > 0) {
      const defaultPurchaser =
        partyTypeOptions.find(
          (p: { value: string }) => p.value === 'individual',
        ) || partyTypeOptions[0];
      setValue('purchaser_type', defaultPurchaser.value, {
        shouldValidate: true,
      });
    }
  }, [partyTypeOptions, setValue, currentPurchaserType]);

  useEffect(() => {
    if (isStaff || user?.client_id) return;
    void authApi
      .me()
      .then(setUser)
      .catch(() => {});
  }, [isStaff, user?.client_id, setUser]);

  useEffect(() => {
    if (!isClientUser || isEdit) return;
    if (financierDisplayLabel) {
      setFinancierLabel(financierDisplayLabel);
    } else {
      setFinancierLabel(user?.client_name ?? '');
    }
  }, [isClientUser, isEdit, user?.client_name, financierDisplayLabel]);

  useEffect(() => {
    if (isClientUser || isEdit) return;
    if (isFirstFinancierClientTypeRender.current) {
      isFirstFinancierClientTypeRender.current = false;
      return;
    }
    setValue('financier_id', 0 as unknown as number);
    setFinancierLabel('');
    clearDataSource();
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

  useEffect(() => {
    if (isEdit) return;
    if (isFirstPurchaserTypeRender.current) {
      isFirstPurchaserTypeRender.current = false;
      return;
    }
    setValue('purchaser_id', 0 as unknown as number);
    setPurchaserLabel('');
    setAddIndividualOpen(false);
    setAddCompanyOpen(false);
  }, [currentPurchaserType, isEdit, setValue]);

  useEffect(() => {
    if (purchaserDisplayLabel) {
      setPurchaserLabel(purchaserDisplayLabel);
    }
  }, [purchaserDisplayLabel]);

  useEffect(() => {
    if (financierDisplayLabel) {
      setFinancierLabel(financierDisplayLabel);
    }
  }, [financierDisplayLabel]);

  const watchAssetCategory = watch('asset_category');
  const isVehicle = watchAssetCategory === 'vehicles';
  const computedBalance =
    (watch('purchase_amount') ?? 0) - (watch('total_paid_to_date') ?? 0);

  const [confirmingUpdate, setConfirmingUpdate] = useState(false);
  const [pendingSubmit, setPendingSubmit] = useState<FormValues | null>(null);

  const { mutate: submit, isPending } = useMutation({
    mutationFn: (data: FormValues) =>
      isEdit && recordId
        ? hirePurchaseApi.updateRecord(recordId, data as any)
        : hirePurchaseApi.createRecord(data as any),
    onSuccess: () => {
      setConfirmingUpdate(false);
      setPendingSubmit(null);
      onSuccess();
    },
    onError: (err: unknown) => {
      setConfirmingUpdate(false);
      if (!applyApiValidationErrors(setError, err)) {
        toast.error(getApiErrorMessage(err) ?? 'Failed to save');
      } else {
        toast.error('Please fix the highlighted fields');
      }
    },
  });

  const onInvalid = () => {
    toast.error('Please fix the highlighted fields');
  };

  const buildSubmitPayload = (data: FormValues) => {
    const payload =
      isClientUser && !isEdit
        ? ({ ...data, financier_id: clientFinancierId } as StaffFormValues)
        : (data as StaffFormValues);

    const withBalance = {
      ...payload,
      balance: (data.purchase_amount ?? 0) - (data.total_paid_to_date ?? 0),
    };

    if (isStaff && !isEdit && dataSourceUserId) {
      return { ...withBalance, data_source_user_id: dataSourceUserId };
    }
    return withBalance;
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

  const performSubmit = async (
    data: FormValues,
    options?: Parameters<typeof submit>[1],
  ) => {
    try {
      await persistBlankDataSourcePosition();
    } catch {
      toast.error('Could not save data source position');
      return;
    }
    submit(buildSubmitPayload(data) as any, options);
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
    if (isClientUser && !isEdit) {
      if (!clientFinancierId) {
        toast.error(
          'Unable to load your financier profile. Please refresh and try again.',
        );
        return;
      }
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

  const handleSaveAndAdd = handleSubmit((data) => {
    if (isClientUser && !isEdit && !clientFinancierId) {
      toast.error(
        'Unable to load your financier profile. Please refresh and try again.',
      );
      return;
    }
    if (!validateStaffDataSource()) return;

    performSubmit(data, {
      onSuccess: () => {
        reset();
        clearDataSource();
        onSaveAndAdd?.();
      },
    });
  }, onInvalid);

  const editDataSourceName = dataSourceDisplayLabel ?? '—';
  const editDataSourcePosition = dataSourcePositionLabel ?? '—';

  return (
    <>
      <form onSubmit={onFormSubmit} className="bg-white" noValidate>
        {/* ── Financier Section ── */}
        <FormSectionHeader title="Financier" variant="red" />
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
                  value={editDataSourceName}
                />
              </div>
              <div className="col-span-2">
                <ReadOnlyField
                  label="Position"
                  value={editDataSourcePosition}
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
              <div className="col-span-2">
                <ReadOnlyField
                  label="Data Source Name"
                  value={user?.name ?? ''}
                />
              </div>
              <div className="col-span-2">
                {(user?.position ?? '').trim() ? (
                  <ReadOnlyField
                    label="Position"
                    value={user?.position ?? ''}
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
                    partyTypeOptions.map(
                      (option: { value: string; label: string }) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ),
                    )
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
                      queryKey={`hp-financier-${financierClientType}`}
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
                      queryKey={`hp-data-source-${selectedFinancierId}-${clientUsers.length}`}
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

        {/* ── Lessee / Purchaser Section ── */}
        <FormSectionHeader title="Lessee" variant="teal" />
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
            <ReadOnlyField label="Purchaser Type" value={purchaserTypeLabel} />
            <div className="col-span-3">
              <ReadOnlyField
                label="Purchaser"
                value={purchaserLabel || purchaserDisplayLabel || ''}
              />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
            <div>
              <label className="text-xs font-medium text-slate-600">
                Purchaser Type
              </label>
              <select
                {...register('purchaser_type')}
                className="mt-1 h-8 w-full rounded border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:border-[#0f7d8e]"
                disabled={!partyTypeOptions.length}
              >
                <option value="">
                  {partyTypeOptions.length
                    ? 'Select type...'
                    : 'Loading types...'}
                </option>
                {partyTypeOptions.map(
                  (option: { value: string; label: string }) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ),
                )}
              </select>
            </div>
            <div className="col-span-3">
              <Controller
                name="purchaser_id"
                control={control}
                render={({ field }) => (
                  <AutocompleteInput
                    label="Name / ID / Reg. No."
                    placeholder={
                      watch('purchaser_type') === 'individual'
                        ? 'Search by Name / National ID'
                        : 'Search by Name / Reg Number'
                    }
                    queryKey={`hp-purchaser-${watch('purchaser_type')}`}
                    displayLabel={purchaserLabel}
                    fetchFn={(q) =>
                      watch('purchaser_type') === 'company'
                        ? companiesApi.searchBranches(q)
                        : individualsApi.searchIndividuals(q)
                    }
                    resolveSelection={(item) =>
                      watch('purchaser_type') === 'company'
                        ? companiesApi.resolveBranchSelection(item)
                        : individualsApi.resolveIndividualSelection(item)
                    }
                    createLabel={
                      watch('purchaser_type') === 'company'
                        ? 'Create company'
                        : 'Create individual'
                    }
                    onCreateNew={() => {
                      if (watch('purchaser_type') === 'company') {
                        setAddCompanyOpen(true);
                      } else {
                        setAddIndividualOpen(true);
                      }
                    }}
                    value={field.value}
                    onBlur={field.onBlur}
                    error={errors.purchaser_id?.message}
                    onChange={(v) => field.onChange(Number(v))}
                  />
                )}
              />
            </div>
          </div>
        )}

        {/* ── HP Details ── */}
        <FormSectionHeader title="Hire Purchase Details" variant="dark" />
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3">
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
              {assetCategoryOptions.map(
                (t: { value: string; label: string }) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ),
              )}
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
          <Input label="Model" {...register('asset_model')} />
          <Input label="Year" type="number" {...register('asset_year')} />
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
              {assetConditionOptions.map(
                (c: { value: string; label: string }) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ),
              )}
            </select>
          </div>
          <Input label="Serial Number" {...register('reg_serial_number')} />
          {isVehicle && (
            <>
              <Input label="Chassis Number" {...register('chassis_number')} />
              <Input label="Engine Number" {...register('engine_number')} />
            </>
          )}
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
            label="Purchase Amount"
            type="number"
            step="0.01"
            {...register('purchase_amount')}
            required
          />
          <Input
            label="Instalment Amount"
            type="number"
            step="0.01"
            {...register('instalment_amount')}
            required
          />
          <Input
            label="Instalment Date (dd)"
            type="number"
            min="1"
            max="31"
            {...register('instalment_date')}
            required
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
              <Button type="submit" variant="secondary" loading={isPending}>
                Update
              </Button>
              <Button
                type="button"
                variant="danger"
                loading={closurePending}
                onClick={onCloseRecord}
              >
                Close
              </Button>
            </>
          ) : (
            <>
              {!isEdit && (
                <Button
                  type="button"
                  variant="primary"
                  loading={isPending}
                  onClick={handleSaveAndAdd}
                >
                  + Save And Add
                </Button>
              )}
              <div className="flex gap-2 ml-auto">
                <Button type="button" variant="ghost" onClick={onCancel}>
                  Cancel
                </Button>
                <Button type="submit" variant="secondary" loading={isPending}>
                  Save And Exit
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
            setValue('purchaser_type', 'individual');
            setValue('purchaser_id', id, { shouldValidate: true });
            setPurchaserLabel(name);
            setAddIndividualOpen(false);
            toast.success(`${name} added — select from search if needed`);
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
            setValue('purchaser_type', 'company');
            setValue('purchaser_id', id, { shouldValidate: true });
            setPurchaserLabel(name);
            setAddCompanyOpen(false);
            toast.success(`${name} added — search branch to link purchaser`);
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
