import { useEffect, useRef, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@/lib/zodResolver';
import { optionalFormNumber, requiredFormId } from '@/lib/zodSchemas';
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
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/shared/Modal';
import { IndividualCreateForm } from '@/components/individuals/IndividualCreateForm';
import { CompanyCreateForm } from '@/components/companies/CompanyCreateForm';
import { FormSectionHeader } from '@/components/shared/FormSectionHeader';
import { commonApi } from '@/api/commonApi';
import { queryOptions } from '@/api/queryOptions';
import { useCommonChoices } from '@/hooks/useCommonChoices';
import type { AssetRecord } from '@/types';
import {
  firstFormErrorMessage,
  handleFormSubmitError,
} from '@/lib/formErrors';
import { UserPlus, Building } from 'lucide-react';
import type { SearchOption } from '@/lib/searchResults';
import { partyIdRegDisplay } from '@/lib/searchResults';
import {
  applyNewOwnerContactToForm,
  clearNewOwnerContactForm,
  EditableNewOwnerContactGrid,
  emptyPartyContact,
  fetchPartyContact,
  fetchPartyContactWithSuburbId,
  NewOwnerNameField,
  ReadOnlyField,
  ReadOnlyOwnerSection,
  syncNewOwnerContactToParty,
  type PartyContact,
} from '@/lib/partyContact';

const ownershipSchema = z.object({
  owner_type: z.string().min(1),
  owner_id: requiredFormId('Select a new owner by ID/Comp Reg'),
  new_owner_name: z.string().optional(),
  new_owner_email: z.string().optional(),
  new_owner_street: z.string().optional(),
  new_owner_suburb: z.string().optional(),
  new_owner_city: z.string().optional(),
  new_owner_mobile: z.string().optional(),
  new_owner_telephone: z.string().optional(),
  new_owner_suburb_id: optionalFormNumber(),
  valuation_type: z.string().optional(),
  title_status: z.string().optional(),
  terms: z.string().optional(),
  currency: z.string().optional(),
  value_amount: optionalFormNumber(),
});

function ownershipValuationDefaults(detail: AssetRecord) {
  const sale = detail.open_sale;
  return {
    currency: sale?.currency_code ?? detail.currency ?? 'USD',
    valuation_type: sale?.valuation_type ?? detail.valuation_type ?? '',
    title_status: sale?.title_status ?? detail.title_status ?? '',
    terms: sale?.terms ?? '',
    value_amount: sale?.value_amount ?? (detail.estimated_value || undefined),
  };
}

const saleSchema = z.object({
  purchaser_type: z.string().min(1),
  purchaser_id: z.number().min(1),
  purchaser_name: z.string().optional(),
  purchaser_email: z.string().optional(),
  purchaser_street: z.string().optional(),
  purchaser_suburb: z.string().optional(),
  purchaser_city: z.string().optional(),
  purchaser_mobile: z.string().optional(),
  purchaser_telephone: z.string().optional(),
  sale_date: z.string().min(1),
  terms: z.string().min(1),
  valuation_type: z.string().min(1),
  title_status: z.string().min(1),
  currency: z.string().min(1),
  value_amount: z.coerce.number().min(0),
});

function applyPurchaserContactToForm(
  setValue: ReturnType<typeof useForm<z.infer<typeof saleSchema>>>['setValue'],
  contact: PartyContact,
  fallbackName = '',
) {
  setValue('purchaser_name', contact.name || fallbackName);
  setValue('purchaser_email', contact.email);
  setValue('purchaser_street', contact.street);
  setValue('purchaser_suburb', contact.suburb);
  setValue('purchaser_city', contact.city);
  setValue('purchaser_mobile', contact.mobile);
  setValue('purchaser_telephone', contact.telephone);
}

function clearPurchaserContactForm(
  setValue: ReturnType<typeof useForm<z.infer<typeof saleSchema>>>['setValue'],
) {
  setValue('purchaser_name', '');
  setValue('purchaser_email', '');
  setValue('purchaser_street', '');
  setValue('purchaser_suburb', '');
  setValue('purchaser_city', '');
  setValue('purchaser_mobile', '');
  setValue('purchaser_telephone', '');
}

function ReadOnlyStandSection({
  detail,
  variant = 'default',
}: {
  detail: AssetRecord;
  variant?: 'default' | 'sale';
}) {
  const isSale = variant === 'sale';
  return (
    <div className="grid grid-cols-2 gap-3 px-4 py-3 sm:grid-cols-4">
      <ReadOnlyField
        label="City/Town"
        value={detail.city_name ?? ''}
        required={isSale}
      />
      <ReadOnlyField
        label="Suburb/Area/Development"
        value={detail.suburb_name ?? ''}
        required={isSale}
      />
      <ReadOnlyField label="Stand Address" value={detail.stand_address ?? ''} />
      <ReadOnlyField
        label="Stand Number"
        value={detail.stand_number ?? ''}
        required={isSale}
      />
      {!isSale ? (
        <ReadOnlyField label="Stand Size" value={detail.stand_size ?? ''} />
      ) : null}
    </div>
  );
}

export function StandOwnershipChangeForm({
  record,
  detail,
  onSuccess,
  onCancel,
}: {
  record: AssetRecord;
  detail: AssetRecord;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [addIndividualOpen, setAddIndividualOpen] = useState(false);
  const [addCompanyOpen, setAddCompanyOpen] = useState(false);
  const [ownerSearchLabel, setOwnerSearchLabel] = useState('');
  const [newOwnerBaseline, setNewOwnerBaseline] = useState<{
    contact: PartyContact;
    suburbId?: number;
  }>({ contact: { ...emptyPartyContact } });
  const prevNewOwnerTypeRef = useRef<string | null>(null);
  const { register, control, handleSubmit, watch, setValue, setError, formState: { errors } } = useForm({
    resolver: zodResolver(ownershipSchema),
    defaultValues: {
      owner_type: 'individual',
      owner_id: 0,
      ...ownershipValuationDefaults(detail),
    },
  });

  const newOwnerType = watch('owner_type');
  const newOwnerId = watch('owner_id');

  const { data: choices } = useCommonChoices();
  const { data: currencies = [] } = useQuery({
    queryKey: ['currencies'],
    queryFn: commonApi.getCurrencies,
    ...queryOptions.static,
  });
  const { data: ownerContact = { ...emptyPartyContact, name: detail.owner_name } } =
    useQuery({
      queryKey: ['stand-owner-contact', detail.owner_type, detail.owner_id],
      queryFn: () =>
        fetchPartyContact(
          detail.owner_type,
          detail.owner_id,
          detail.owner_name,
        ),
      enabled: detail.owner_id > 0,
      ...queryOptions.static,
    });

  useEffect(() => {
    if (prevNewOwnerTypeRef.current === null) {
      prevNewOwnerTypeRef.current = newOwnerType;
      return;
    }
    if (prevNewOwnerTypeRef.current !== newOwnerType) {
      prevNewOwnerTypeRef.current = newOwnerType;
      setValue('owner_id', 0);
      setOwnerSearchLabel('');
      clearNewOwnerContactForm(setValue);
      setNewOwnerBaseline({ contact: { ...emptyPartyContact } });
    }
  }, [newOwnerType, setValue]);

  useEffect(() => {
    if (!newOwnerId || newOwnerId < 1) {
      clearNewOwnerContactForm(setValue);
      setNewOwnerBaseline({ contact: { ...emptyPartyContact } });
      return;
    }
    let cancelled = false;
    void fetchPartyContactWithSuburbId(
      newOwnerType,
      newOwnerId,
      ownerSearchLabel,
    ).then(({ contact, suburbId }) => {
      if (!cancelled) {
        applyNewOwnerContactToForm(setValue, contact, suburbId);
        setNewOwnerBaseline({ contact, suburbId });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [newOwnerType, newOwnerId, setValue]);

  const applyNewOwnerSelection = async (item: SearchOption) => {
    const id =
      newOwnerType === 'company'
        ? await companiesApi.resolveBranchSelection(item)
        : await individualsApi.resolveIndividualSelection(item);
    if (newOwnerType === detail.owner_type && id === detail.owner_id) {
      toast.error('The new owner cannot be the same as the current owner.');
      throw new Error('The new owner cannot be the same as the current owner.');
    }
    setOwnerSearchLabel(partyIdRegDisplay(item, newOwnerType));
    return id;
  };

  const submitOwnershipChange = (values: z.infer<typeof ownershipSchema>) => {
    if (
      values.owner_type === detail.owner_type &&
      values.owner_id === detail.owner_id
    ) {
      setError('owner_id', {
        type: 'manual',
        message: 'The new owner cannot be the same as the current owner.',
      });
      toast.error('The new owner cannot be the same as the current owner.');
      return;
    }
    mutation.mutate(values);
  };

  const mutation = useMutation({
    mutationFn: async (values: z.infer<typeof ownershipSchema>) => {
      if (values.owner_id > 0) {
        await syncNewOwnerContactToParty(
          values.owner_type,
          values.owner_id,
          values,
          newOwnerBaseline.contact,
          newOwnerBaseline.suburbId,
        );
      }
      return assetRegistryApi.ownershipChange(record.id, values);
    },
    onSuccess: () => {
      toast.success('Ownership updated');
      onSuccess();
    },
    onError: (err) => {
      handleFormSubmitError(setError, err, 'Ownership change failed');
    },
  });

  return (
    <form
      onSubmit={handleSubmit(
        submitOwnershipChange,
        (formErrors) => {
          toast.error(
            firstFormErrorMessage(formErrors) ??
              'Please fix the highlighted fields',
          );
        },
      )}
      className="bg-white"
    >
      <div className="bg-[#f59e0b] px-4 py-3 text-center text-[15px] font-semibold uppercase tracking-wide text-black">
        Ownership Change - Stand/Plot/Land
      </div>
      <ReadOnlyStandSection detail={detail} />
      <FormSectionHeader title="Owner" variant="teal" />
      <ReadOnlyOwnerSection detail={detail} contact={ownerContact} />
      <FormSectionHeader title="New Owner" variant="teal" />
      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
        <Select label="New Owner Type" {...register('owner_type')}>
          <option value="individual">Individual</option>
          <option value="company">Company</option>
        </Select>
        <div className="col-span-2">
          <Controller
            name="owner_id"
            control={control}
            render={({ field }) => (
              <AutocompleteInput
                key={`stand-owner-change-${newOwnerType}`}
                label="ID/Comp Reg"
                placeholder="Search new owner..."
                queryKey={`stand-owner-change-${newOwnerType}`}
                displayLabel={ownerSearchLabel}
                fetchFn={(q) =>
                  newOwnerType === 'company'
                    ? companiesApi.searchBranches(q)
                    : individualsApi.searchIndividuals(q)
                }
                resolveSelection={applyNewOwnerSelection}
                selectionDisplay={(item) => partyIdRegDisplay(item, newOwnerType)}
                onCreateNew={() =>
                  newOwnerType === 'company'
                    ? setAddCompanyOpen(true)
                    : setAddIndividualOpen(true)
                }
                error={errors.owner_id?.message}
                value={field.value}
                onChange={(v) => {
                  field.onChange(Number(v));
                  if (!v) setOwnerSearchLabel('');
                }}
              />
            )}
          />
        </div>
        {newOwnerId != null && newOwnerId > 0 ? (
          <NewOwnerNameField register={register} errors={errors} />
        ) : null}
      </div>
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
      {newOwnerId != null && newOwnerId > 0 ? (
        <EditableNewOwnerContactGrid
          register={register}
          control={control}
          setValue={setValue}
          errors={errors}
        />
      ) : null}
      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
        <Select label="Valuation Type" {...register('valuation_type')}>
          <option value="">Select...</option>
          {(choices.ValuationType ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <Select label="Currency" {...register('currency')}>
          {currencies.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code}
            </option>
          ))}
        </Select>
        <Input
          label="Value Amount"
          type="number"
          step="0.01"
          error={errors.value_amount?.message}
          {...register('value_amount')}
        />
        <Select label="Title Status" {...register('title_status')}>
          <option value="">Select...</option>
          {(choices.TitleStatus ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <Select label="Terms" {...register('terms')}>
          <option value="">Select...</option>
          {(choices.SaleTerms ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          Save
        </Button>
      </div>
      <Modal
        open={addIndividualOpen}
        onClose={() => setAddIndividualOpen(false)}
        title="Add Individual"
        size="lg"
      >
        <IndividualCreateForm
          onSuccess={(c) => {
            setValue('owner_id', c.id);
            setOwnerSearchLabel(c.identification_number ?? '');
            setAddIndividualOpen(false);
          }}
          onCancel={() => setAddIndividualOpen(false)}
        />
      </Modal>
      <Modal
        open={addCompanyOpen}
        onClose={() => setAddCompanyOpen(false)}
        title="Add Company"
        size="lg"
      >
        <CompanyCreateForm
          onSuccess={(c) => {
            setValue('owner_id', c.id);
            setOwnerSearchLabel(c.registration_number ?? '');
            setAddCompanyOpen(false);
          }}
          onCancel={() => setAddCompanyOpen(false)}
        />
      </Modal>
    </form>
  );
}

export function StandSaleTransitionForm({
  record,
  detail,
  onSuccess,
  onCancel,
}: {
  record: AssetRecord;
  detail: AssetRecord;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const [addIndividualOpen, setAddIndividualOpen] = useState(false);
  const [addCompanyOpen, setAddCompanyOpen] = useState(false);
  const [purchaserSearchLabel, setPurchaserSearchLabel] = useState('');
  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(saleSchema),
    defaultValues: {
      purchaser_type: 'individual',
      sale_date: new Date().toISOString().slice(0, 10),
      currency: detail.currency || 'USD',
      valuation_type: detail.valuation_type ?? '',
      title_status: detail.title_status ?? '',
      value_amount: detail.estimated_value ?? 0,
    },
  });

  const purchaserType = watch('purchaser_type');
  const purchaserId = watch('purchaser_id');

  const { data: ownerContact = { ...emptyPartyContact, name: detail.owner_name } } =
    useQuery({
      queryKey: ['stand-owner-contact', detail.owner_type, detail.owner_id],
      queryFn: () =>
        fetchPartyContact(
          detail.owner_type,
          detail.owner_id,
          detail.owner_name,
        ),
      enabled: detail.owner_id > 0,
      ...queryOptions.static,
    });

  useEffect(() => {
    if (!purchaserId || purchaserId < 1) {
      clearPurchaserContactForm(setValue);
      return;
    }
    let cancelled = false;
    void fetchPartyContact(
      purchaserType,
      purchaserId,
      purchaserSearchLabel,
    ).then((contact) => {
      if (!cancelled) {
        applyPurchaserContactToForm(setValue, contact, purchaserSearchLabel);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [purchaserType, purchaserId, purchaserSearchLabel, setValue]);

  const { data: choices } = useCommonChoices();
  const { data: currencies = [] } = useQuery({
    queryKey: ['currencies'],
    queryFn: commonApi.getCurrencies,
    ...queryOptions.static,
  });

  const applyPurchaserSelection = async (item: SearchOption) => {
    setPurchaserSearchLabel(partyIdRegDisplay(item, purchaserType));
    return purchaserType === 'company'
      ? companiesApi.resolveBranchSelection(item)
      : individualsApi.resolveIndividualSelection(item);
  };

  const mutation = useMutation({
    mutationFn: (values: z.infer<typeof saleSchema>) =>
      assetRegistryApi.saleTransition(record.id, values),
    onSuccess: () => {
      toast.success('Sale transition recorded');
      onSuccess();
    },
    onError: (err) => {
      handleFormSubmitError(setError, err, 'Sale transition failed');
    },
  });

  return (
    <form
      onSubmit={handleSubmit(
        (v) => mutation.mutate(v),
        (formErrors) => {
          toast.error(
            firstFormErrorMessage(formErrors) ??
              'Please fix the highlighted fields',
          );
        },
      )}
      className="bg-white"
    >
      <div className="bg-[#c62828] px-4 py-3 text-center text-[15px] font-semibold uppercase tracking-wide text-white">
        Sale Transition - Stand/Plot/Land
      </div>
      <ReadOnlyStandSection detail={detail} variant="sale" />
      <FormSectionHeader title="Owner" variant="teal" />
      <ReadOnlyOwnerSection detail={detail} contact={ownerContact} />
      <FormSectionHeader title="Purchaser" variant="teal" />
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
      <div className="grid grid-cols-2 gap-3 px-4 pt-2 pb-1 sm:grid-cols-4">
        <Select
          label="Buyer Type"
          value={purchaserType}
          onChange={(e) => {
            setValue('purchaser_type', e.target.value);
            setValue('purchaser_id', 0);
            setPurchaserSearchLabel('');
            clearPurchaserContactForm(setValue);
          }}
        >
          <option value="individual">Individual</option>
          <option value="company">Company</option>
        </Select>
        <div className="col-span-2">
          <Controller
            name="purchaser_id"
            control={control}
            render={({ field }) => (
              <AutocompleteInput
                label="ID/Comp Reg"
                placeholder="Search purchaser..."
                queryKey={`stand-sale-purchaser-${purchaserType}`}
                displayLabel={purchaserSearchLabel}
                fetchFn={(q) =>
                  purchaserType === 'company'
                    ? companiesApi.searchBranches(q)
                    : individualsApi.searchIndividuals(q)
                }
                resolveSelection={applyPurchaserSelection}
                selectionDisplay={(item) => partyIdRegDisplay(item, purchaserType)}
                onCreateNew={() =>
                  purchaserType === 'company'
                    ? setAddCompanyOpen(true)
                    : setAddIndividualOpen(true)
                }
                error={errors.purchaser_id?.message}
                value={field.value}
                onChange={(v) => {
                  field.onChange(Number(v));
                  if (!v) setPurchaserSearchLabel('');
                }}
              />
            )}
          />
        </div>
        <Input label="Buyer Name" {...register('purchaser_name')} />
        <Input label="Buyer Email" {...register('purchaser_email')} />
        <Input label="Buyer Street No." {...register('purchaser_street')} />
        <Input label="Buyer Suburb" {...register('purchaser_suburb')} />
        <Input label="Buyer City/Town" {...register('purchaser_city')} />
        <Input label="Buyer Mobile #" {...register('purchaser_mobile')} />
        <Input label="Buyer Tel #" {...register('purchaser_telephone')} />
      </div>
      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
        <Select
          label="Valuation Type"
          required
          {...register('valuation_type')}
          error={errors.valuation_type?.message}
        >
          <option value="">Select...</option>
          {(choices.ValuationType ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <Select
          label="Currency"
          required
          {...register('currency')}
          error={errors.currency?.message}
        >
          {currencies.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code}
            </option>
          ))}
        </Select>
        <Input
          label="Value Amount"
          type="number"
          step="0.01"
          required
          error={errors.value_amount?.message}
          {...register('value_amount')}
        />
        <Select
          label="Title Status"
          required
          {...register('title_status')}
          error={errors.title_status?.message}
        >
          <option value="">Select...</option>
          {(choices.TitleStatus ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <Select
          label="Terms"
          required
          {...register('terms')}
          error={errors.terms?.message}
        >
          <option value="">Select...</option>
          {(choices.SaleTerms ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        <Controller
          name="sale_date"
          control={control}
          render={({ field, fieldState }) => (
            <DateInput
              label="Date of Sale"
              value={field.value}
              onChange={field.onChange}
              error={fieldState.error?.message}
              required
            />
          )}
        />
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          Save
        </Button>
      </div>
      <Modal
        open={addIndividualOpen}
        onClose={() => setAddIndividualOpen(false)}
        title="Add Individual"
        size="lg"
      >
        <IndividualCreateForm
          onSuccess={(c) => {
            setValue('purchaser_id', c.id);
            setPurchaserSearchLabel(c.identification_number ?? '');
            setAddIndividualOpen(false);
          }}
          onCancel={() => setAddIndividualOpen(false)}
        />
      </Modal>
      <Modal
        open={addCompanyOpen}
        onClose={() => setAddCompanyOpen(false)}
        title="Add Company"
        size="lg"
      >
        <CompanyCreateForm
          onSuccess={(c) => {
            setValue('purchaser_id', c.id);
            setPurchaserSearchLabel(c.registration_number ?? '');
            setAddCompanyOpen(false);
          }}
          onCancel={() => setAddCompanyOpen(false)}
        />
      </Modal>
    </form>
  );
}
