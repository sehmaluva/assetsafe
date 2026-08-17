import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@/lib/zodResolver';
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
import { commonApi } from '@/api/commonApi';
import { queryOptions } from '@/api/queryOptions';
import { useCommonChoices } from '@/hooks/useCommonChoices';
import type { AssetRecord } from '@/types';
import { applyApiValidationErrors } from '@/lib/formErrors';

const ownershipSchema = z.object({
  owner_type: z.string().min(1),
  owner_id: z.number().min(1),
  valuation_type: z.string().optional(),
  title_status: z.string().optional(),
  terms: z.string().optional(),
  value_amount: z.coerce.number().optional(),
});

const saleSchema = z.object({
  purchaser_type: z.string().min(1),
  purchaser_id: z.number().min(1),
  sale_date: z.string().min(1),
  terms: z.string().min(1),
  valuation_type: z.string().min(1),
  title_status: z.string().min(1),
  currency: z.string().min(1),
  value_amount: z.coerce.number().min(0),
});

function ReadOnlyStandFields({ detail }: { detail: AssetRecord }) {
  return (
    <div className="grid grid-cols-2 gap-2 rounded border border-slate-200 bg-slate-50 p-3 text-sm sm:grid-cols-3">
      <div>
        <span className="text-xs text-slate-500">City/Town</span>
        <p className="font-medium">{detail.city_name || '—'}</p>
      </div>
      <div>
        <span className="text-xs text-slate-500">Area/Development</span>
        <p className="font-medium">{detail.suburb_name || '—'}</p>
      </div>
      <div>
        <span className="text-xs text-slate-500">Stand Number</span>
        <p className="font-medium">{detail.stand_number || '—'}</p>
      </div>
      <div>
        <span className="text-xs text-slate-500">Stand Size</span>
        <p className="font-medium">{detail.stand_size || '—'}</p>
      </div>
      <div className="col-span-2">
        <span className="text-xs text-slate-500">Stand Address</span>
        <p className="font-medium">{detail.stand_address || '—'}</p>
      </div>
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
  const { register, control, handleSubmit, watch, setValue, setError } = useForm({
    resolver: zodResolver(ownershipSchema),
    defaultValues: { owner_type: 'individual' },
  });

  const { data: choices } = useCommonChoices();

  const mutation = useMutation({
    mutationFn: (values: z.infer<typeof ownershipSchema>) =>
      assetRegistryApi.ownershipChange(record.id, values),
    onSuccess: () => {
      toast.success('Ownership updated');
      onSuccess();
    },
    onError: (err) => {
      if (!applyApiValidationErrors(err, setError)) {
        toast.error('Ownership change failed');
      }
    },
  });

  return (
    <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4 p-4">
      <h3 className="text-sm font-bold uppercase">Ownership Change — Stand/Plot/Land</h3>
      <ReadOnlyStandFields detail={detail} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div>
          <label className="text-xs font-medium">New Owner Type</label>
          <select {...register('owner_type')} className="mt-1 h-8 w-full rounded border px-2 text-sm">
            <option value="individual">Individual</option>
            <option value="company">Company</option>
          </select>
        </div>
        <div className="col-span-2">
          <Controller
            name="owner_id"
            control={control}
            render={({ field }) => (
              <AutocompleteInput
                label="ID/Comp Reg / New Owner"
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
                onCreateNew={() =>
                  watch('owner_type') === 'company'
                    ? setAddCompanyOpen(true)
                    : setAddIndividualOpen(true)
                }
                value={field.value}
                onChange={(v) => field.onChange(Number(v))}
              />
            )}
          />
        </div>
        <div>
          <label className="text-xs font-medium">Valuation Type</label>
          <select {...register('valuation_type')} className="mt-1 h-8 w-full rounded border px-2 text-sm">
            <option value="">—</option>
            {(choices.ValuationType ?? []).map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium">Title Status</label>
          <select {...register('title_status')} className="mt-1 h-8 w-full rounded border px-2 text-sm">
            <option value="">—</option>
            {(choices.TitleStatus ?? []).map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <Input label="Value Amount" type="number" step="0.01" {...register('value_amount')} />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={mutation.isPending}>Save</Button>
      </div>
      <Modal open={addIndividualOpen} onClose={() => setAddIndividualOpen(false)} title="Add Individual" size="lg">
        <IndividualCreateForm onSuccess={(c) => { setValue('owner_id', c.id); setAddIndividualOpen(false); }} onCancel={() => setAddIndividualOpen(false)} />
      </Modal>
      <Modal open={addCompanyOpen} onClose={() => setAddCompanyOpen(false)} title="Add Company" size="lg">
        <CompanyCreateForm onSuccess={(c) => { setValue('owner_id', c.id); setAddCompanyOpen(false); }} onCancel={() => setAddCompanyOpen(false)} />
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
  const { register, control, handleSubmit, watch, setValue, setError } = useForm({
    resolver: zodResolver(saleSchema),
    defaultValues: {
      purchaser_type: 'individual',
      sale_date: new Date().toISOString().slice(0, 10),
      currency: detail.currency || 'USD',
    },
  });

  const { data: choices } = useCommonChoices();
  const { data: currencies = [] } = useQuery({
    queryKey: ['currencies'],
    queryFn: commonApi.getCurrencies,
    ...queryOptions.static,
  });

  const mutation = useMutation({
    mutationFn: (values: z.infer<typeof saleSchema>) =>
      assetRegistryApi.saleTransition(record.id, values),
    onSuccess: () => {
      toast.success('Sale transition recorded');
      onSuccess();
    },
    onError: (err) => {
      if (!applyApiValidationErrors(err, setError)) {
        toast.error('Sale transition failed');
      }
    },
  });

  return (
    <form onSubmit={handleSubmit((v) => mutation.mutate(v))} className="space-y-4 p-4">
      <h3 className="text-sm font-bold uppercase">Sale Transition — Stand/Plot/Land</h3>
      <ReadOnlyStandFields detail={detail} />
      <div className="rounded border border-slate-200 p-3 text-sm">
        <p className="text-xs font-semibold uppercase text-slate-500">Current Owner</p>
        <p className="font-medium">{detail.owner_name}</p>
        <p className="text-slate-600">{detail.owner_id_reg}</p>
      </div>
      <p className="text-xs font-semibold uppercase text-slate-500">Purchaser</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div>
          <label className="text-xs font-medium">Buyer Type</label>
          <select {...register('purchaser_type')} className="mt-1 h-8 w-full rounded border px-2 text-sm">
            <option value="individual">Individual</option>
            <option value="company">Company</option>
          </select>
        </div>
        <div className="col-span-2">
          <Controller
            name="purchaser_id"
            control={control}
            render={({ field }) => (
              <AutocompleteInput
                label="ID/Comp Reg / Buyer"
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
                onCreateNew={() =>
                  watch('purchaser_type') === 'company'
                    ? setAddCompanyOpen(true)
                    : setAddIndividualOpen(true)
                }
                value={field.value}
                onChange={(v) => field.onChange(Number(v))}
              />
            )}
          />
        </div>
        <Controller
          name="sale_date"
          control={control}
          render={({ field, fieldState }) => (
            <DateInput label="Date of Sale" value={field.value} onChange={field.onChange} error={fieldState.error?.message} required />
          )}
        />
        <div>
          <label className="text-xs font-medium">Terms</label>
          <select {...register('terms')} className="mt-1 h-8 w-full rounded border px-2 text-sm">
            <option value="">Select...</option>
            {(choices.SaleTerms ?? []).map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium">Valuation Type</label>
          <select {...register('valuation_type')} className="mt-1 h-8 w-full rounded border px-2 text-sm">
            <option value="">Select...</option>
            {(choices.ValuationType ?? []).map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium">Title Status</label>
          <select {...register('title_status')} className="mt-1 h-8 w-full rounded border px-2 text-sm">
            <option value="">Select...</option>
            {(choices.TitleStatus ?? []).map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium">Currency</label>
          <select {...register('currency')} className="mt-1 h-8 w-full rounded border px-2 text-sm">
            {currencies.map((c) => (
              <option key={c.code} value={c.code}>{c.code}</option>
            ))}
          </select>
        </div>
        <Input label="Value Amount" type="number" step="0.01" {...register('value_amount')} required />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={mutation.isPending}>Save</Button>
      </div>
      <Modal open={addIndividualOpen} onClose={() => setAddIndividualOpen(false)} title="Add Individual" size="lg">
        <IndividualCreateForm onSuccess={(c) => { setValue('purchaser_id', c.id); setAddIndividualOpen(false); }} onCancel={() => setAddIndividualOpen(false)} />
      </Modal>
      <Modal open={addCompanyOpen} onClose={() => setAddCompanyOpen(false)} title="Add Company" size="lg">
        <CompanyCreateForm onSuccess={(c) => { setValue('purchaser_id', c.id); setAddCompanyOpen(false); }} onCancel={() => setAddCompanyOpen(false)} />
      </Modal>
    </form>
  );
}
