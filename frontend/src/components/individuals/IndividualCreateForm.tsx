import { useEffect } from 'react';
import { useForm, useFormState, Controller } from 'react-hook-form';
import { zodResolver } from '@/lib/zodResolver';
import { applyApiValidationErrors } from '@/lib/formErrors';
import { z } from 'zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { individualsApi } from '@/api/individualsApi';
import { commonApi } from '@/api/commonApi';
import { queryOptions } from '@/api/queryOptions';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { LocationCascadeSelects } from '@/components/shared/LocationCascadeSelects';

const schema = z.object({
  first_name: z.string().min(1, 'Required'),
  last_name: z.string().min(1, 'Required'),
  identification_type: z.string().min(1, 'ID Type is required'),
  identification_number: z.string().min(1, 'Required'),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().min(1, 'Phone is required'),
  street_address: z.string().min(1, 'Street address is required'),
  suburb_id: z.coerce.number().min(1, 'Suburb is required'),
});

type FormValues = z.infer<typeof schema>;

interface IndividualCreateFormProps {
  onSuccess: (result: {
    id: number;
    name: string;
    identification_number?: string;
  }) => void;
  onCancel: () => void;
}

export function IndividualCreateForm({
  onSuccess,
  onCancel,
}: IndividualCreateFormProps) {
  const { register, handleSubmit, setError, control, setValue, watch } =
    useForm<FormValues>({
      resolver: zodResolver(schema),
      mode: 'onSubmit',
      reValidateMode: 'onChange',
      shouldFocusError: true,
      defaultValues: {
        identification_type: '',
      },
    });

  const { errors } = useFormState({ control });

  const { data: choices = {} } = useQuery({
    queryKey: ['common-choices'],
    queryFn: commonApi.getChoices,
    ...queryOptions.static,
  });

  const identificationTypeOptions = choices.IdentificationType ?? [];

  useEffect(() => {
    if (!watch('identification_type') && identificationTypeOptions.length > 0) {
      setValue('identification_type', identificationTypeOptions[0].value, {
        shouldValidate: true,
      });
    }
  }, [identificationTypeOptions, setValue, watch]);

  const { mutate: submit, isPending } = useMutation({
    mutationFn: async (values: FormValues) => {
      const result = await individualsApi.createIndividual({
        first_name: values.first_name,
        last_name: values.last_name,
        identification_type: values.identification_type,
        identification_number: values.identification_number,
        email: values.email || undefined,
        contact_details: [{ type: 'mobile', phone_number: values.phone }],
        addresses: [
          {
            address_type: 'physical',
            is_primary: true,
            street_address: values.street_address,
            suburb_id: values.suburb_id,
          },
        ],
      });
      return {
        ...result,
        identification_number: values.identification_number,
      };
    },
    onSuccess: (result) => {
      toast.success('Individual created');
      onSuccess(result);
    },
    onError: (err: unknown) => {
      if (!applyApiValidationErrors(setError, err)) {
        const data = (
          err as { response?: { data?: { message?: string; error?: string } } }
        )?.response?.data;
        toast.error(
          data?.message ?? data?.error ?? 'Failed to create individual',
        );
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
          label="First Name"
          {...register('first_name')}
          error={errors.first_name?.message}
          required
        />
        <Input
          label="Last Name"
          {...register('last_name')}
          error={errors.last_name?.message}
          required
        />
        <Select
          label="ID Type"
          {...register('identification_type')}
          disabled={!identificationTypeOptions.length}
        >
          <option value="">
            {identificationTypeOptions.length
              ? 'Select ID type...'
              : 'Loading ID types...'}
          </option>
          {identificationTypeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <Input
          label="ID Number"
          {...register('identification_number')}
          error={errors.identification_number?.message}
          required
        />
        <Input label="Email" type="email" {...register('email')} />
        <Input
          label="Mobile Phone"
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
          Create Individual
        </Button>
      </div>
    </form>
  );
}
