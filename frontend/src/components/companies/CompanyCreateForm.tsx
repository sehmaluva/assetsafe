import { useForm, useFormState, Controller } from 'react-hook-form';
import { zodResolver } from '@/lib/zodResolver';
import { applyApiValidationErrors } from '@/lib/formErrors';
import { z } from 'zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { companiesApi } from '@/api/companiesApi';
import { commonApi } from '@/api/commonApi';
import { queryOptions } from '@/api/queryOptions';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { LocationCascadeSelects } from '@/components/shared/LocationCascadeSelects';

/** Mirrors Company.LEGAL_STATUS_CHOICES on the backend. */
const LEGAL_STATUS_CHOICES = [
  { value: 'private', label: 'Private Limited' },
  { value: 'public', label: 'Public Limited' },
  { value: 'government', label: 'Government' },
  { value: 'ngo', label: 'NGO' },
  { value: 'other', label: 'Other' },
] as const;

const schema = z.object({
  registration_number: z.string().min(1, 'Required'),
  registration_name: z.string().min(1, 'Required'),
  trading_name: z.string().min(1, 'Required'),
  legal_status: z.enum(['private', 'public', 'government', 'ngo', 'other'], {
    message: 'Legal status is required',
  }),
  industry: z.string().min(1, 'Industry is required'),
  email: z.string().email('Valid email is required'),
  phone: z.string().min(1, 'Phone is required'),
  street_address: z.string().min(1, 'Street address is required'),
  suburb_id: z.coerce.number().min(1, 'Suburb is required'),
});

type FormValues = z.infer<typeof schema>;

interface CompanyCreateFormProps {
  onSuccess: (result: { id: number; name: string }) => void;
  onCancel: () => void;
}

export function CompanyCreateForm({
  onSuccess,
  onCancel,
}: CompanyCreateFormProps) {
  const { register, handleSubmit, setError, control } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    shouldFocusError: true,
    defaultValues: { legal_status: 'private', industry: '' },
  });

  const { errors } = useFormState({ control });

  const { data: choices = {} } = useQuery({
    queryKey: ['common-choices'],
    queryFn: commonApi.getChoices,
    ...queryOptions.lists,
  });

  const industryOptions = choices.Industry ?? [];

  const { mutate: submit, isPending } = useMutation({
    mutationFn: (values: FormValues) =>
      companiesApi.createCompany({
        registration_number: values.registration_number,
        registration_name: values.registration_name,
        trading_name: values.trading_name,
        legal_status: values.legal_status,
        industry: values.industry,
        profile: {
          email: values.email,
          mobile_phone: values.phone,
        },
        addresses: [
          {
            address_type: 'physical',
            is_primary: true,
            street_address: values.street_address,
            suburb_id: values.suburb_id,
          },
        ],
      }),
    onSuccess: (result) => {
      toast.success('Company created');
      onSuccess(result);
    },
    onError: (err: unknown) => {
      if (!applyApiValidationErrors(setError, err)) {
        const data = (
          err as { response?: { data?: { message?: string; error?: string } } }
        )?.response?.data;
        toast.error(data?.message ?? data?.error ?? 'Failed to create company');
      } else {
        toast.error('Please fix the highlighted fields');
      }
    },
  });

  return (
    <form
      onSubmit={handleSubmit(
        (d) => submit(d),
        () => toast.error('Please fix the highlighted fields'),
      )}
      className="space-y-4 p-4"
      noValidate
    >
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Registration Number"
          {...register('registration_number')}
          error={errors.registration_number?.message}
          required
        />
        <Input
          label="Registration Name"
          {...register('registration_name')}
          error={errors.registration_name?.message}
          required
        />
        <Input
          label="Trading Name"
          {...register('trading_name')}
          error={errors.trading_name?.message}
          required
          className="col-span-2"
        />
        <div>
          <label className="text-xs font-medium text-slate-600">
            Legal Status
            <span className="ml-0.5 text-red-500">*</span>
          </label>
          <select
            {...register('legal_status')}
            className="mt-1 h-8 w-full rounded border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:border-[#0f7d8e]"
          >
            {LEGAL_STATUS_CHOICES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {errors.legal_status?.message ? (
            <p className="mt-1 text-xs text-red-600">
              {errors.legal_status.message}
            </p>
          ) : null}
        </div>
        <div>
          <label className="text-xs font-medium text-slate-600">
            Industry
            <span className="ml-0.5 text-red-500">*</span>
          </label>
          <select
            {...register('industry')}
            className="mt-1 h-8 w-full rounded border border-slate-300 bg-white px-2 text-sm focus:outline-none focus:border-[#0f7d8e]"
          >
            <option value="">Select industry...</option>
            {industryOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {errors.industry?.message ? (
            <p className="mt-1 text-xs text-red-600">
              {errors.industry.message}
            </p>
          ) : null}
        </div>
        <Input
          label="Email"
          type="email"
          {...register('email')}
          error={errors.email?.message}
          required
        />
        <Input
          label="Phone"
          type="tel"
          {...register('phone')}
          error={errors.phone?.message}
          required
        />
        <Input
          label="Street Address"
          {...register('street_address')}
          error={errors.street_address?.message}
          required
          className="col-span-2"
        />
        <Controller
          name="suburb_id"
          control={control}
          render={({ field }) => (
            <LocationCascadeSelects
              value={field.value}
              onChange={(id) => field.onChange(id)}
              error={errors.suburb_id?.message}
            />
          )}
        />
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={isPending}>
          Create Company
        </Button>
      </div>
    </form>
  );
}
