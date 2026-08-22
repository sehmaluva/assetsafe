import type {
  Control,
  FieldErrors,
  UseFormRegister,
  UseFormSetValue,
} from 'react-hook-form';
import { Controller } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import { LocationCascadeSelects } from '@/components/shared/LocationCascadeSelects';
import { individualsApi } from '@/api/individualsApi';
import { companiesApi } from '@/api/companiesApi';
import type { AssetRecord } from '@/types';

export type PartyContact = {
  name: string;
  id_reg: string;
  email: string;
  street: string;
  suburb: string;
  city: string;
  mobile: string;
  telephone: string;
};

export const emptyPartyContact: PartyContact = {
  name: '',
  id_reg: '',
  email: '',
  street: '',
  suburb: '',
  city: '',
  mobile: '',
  telephone: '',
};

export function ownerTypeLabel(type?: string) {
  if (type === 'company') return 'Company';
  if (type === 'individual') return 'Individual';
  return type ?? '';
}

export async function fetchPartyContact(
  partyType: string | undefined,
  partyId: number | undefined,
  fallbackName = '',
): Promise<PartyContact> {
  if (!partyId || partyId < 1) {
    return { ...emptyPartyContact, name: fallbackName };
  }
  try {
    const details =
      partyType === 'company'
        ? await companiesApi.getBranch(partyId)
        : await individualsApi.getIndividual(partyId);
    const idReg =
      partyType === 'company'
        ? (details.registration_number ?? '')
        : (details.identification_number ?? '');
    return {
      name: details.name || fallbackName,
      id_reg: idReg,
      email: details.email,
      street: details.street_address,
      suburb: details.suburb_name ?? '',
      city: details.city_name ?? '',
      mobile: details.phone,
      telephone: details.telephone,
    };
  } catch {
    return { ...emptyPartyContact, name: fallbackName };
  }
}

export type SellerContactFormValues = {
  seller_name?: string;
  seller_email?: string;
  seller_street?: string;
  seller_suburb?: string;
  seller_city?: string;
  seller_mobile?: string;
  seller_telephone?: string;
  seller_suburb_id?: number;
};

export type SellerFieldKey =
  | 'name'
  | 'email'
  | 'street'
  | 'suburb'
  | 'city'
  | 'mobile'
  | 'telephone';

export type SellerFieldLocks = Record<SellerFieldKey, boolean>;

export const emptySellerFieldLocks = (): SellerFieldLocks => ({
  name: false,
  email: false,
  street: false,
  suburb: false,
  city: false,
  mobile: false,
  telephone: false,
});

export function contactToFieldLocks(contact: PartyContact): SellerFieldLocks {
  return {
    name: Boolean(contact.name?.trim()),
    email: Boolean(contact.email?.trim()),
    street: Boolean(contact.street?.trim()),
    suburb: Boolean(contact.suburb?.trim()),
    city: Boolean(contact.city?.trim()),
    mobile: Boolean(contact.mobile?.trim()),
    telephone: Boolean(contact.telephone?.trim()),
  };
}

export function applySellerContactToForm(
  setValue: UseFormSetValue<SellerContactFormValues>,
  contact: PartyContact,
  suburbId?: number,
) {
  setValue('seller_name', contact.name);
  setValue('seller_email', contact.email);
  setValue('seller_street', contact.street);
  setValue('seller_suburb', contact.suburb);
  setValue('seller_city', contact.city);
  setValue('seller_mobile', contact.mobile);
  setValue('seller_telephone', contact.telephone);
  setValue('seller_suburb_id', suburbId && suburbId > 0 ? suburbId : undefined);
}

export function clearSellerContactForm(
  setValue: UseFormSetValue<SellerContactFormValues>,
) {
  setValue('seller_name', '');
  setValue('seller_email', '');
  setValue('seller_street', '');
  setValue('seller_suburb', '');
  setValue('seller_city', '');
  setValue('seller_mobile', '');
  setValue('seller_telephone', '');
  setValue('seller_suburb_id', undefined);
}

export async function fetchPartyContactWithSuburbId(
  partyType: string | undefined,
  partyId: number | undefined,
  fallbackName = '',
): Promise<{ contact: PartyContact; suburbId?: number }> {
  if (!partyId || partyId < 1) {
    return { contact: { ...emptyPartyContact, name: fallbackName } };
  }
  try {
    const details =
      partyType === 'company'
        ? await companiesApi.getBranch(partyId)
        : await individualsApi.getIndividual(partyId);
    const idReg =
      partyType === 'company'
        ? (details.registration_number ?? '')
        : (details.identification_number ?? '');
    return {
      suburbId: details.suburb_id,
      contact: {
        name: details.name || fallbackName,
        id_reg: idReg,
        email: details.email,
        street: details.street_address,
        suburb: details.suburb_name ?? '',
        city: details.city_name ?? '',
        mobile: details.phone,
        telephone: details.telephone,
      },
    };
  } catch {
    return { contact: { ...emptyPartyContact, name: fallbackName } };
  }
}

export type NewOwnerContactFormValues = {
  new_owner_name?: string;
  new_owner_email?: string;
  new_owner_street?: string;
  new_owner_suburb?: string;
  new_owner_city?: string;
  new_owner_mobile?: string;
  new_owner_telephone?: string;
  new_owner_suburb_id?: number;
};

export type PartyFieldLocks = SellerFieldLocks;

export function applyNewOwnerContactToForm(
  setValue: UseFormSetValue<NewOwnerContactFormValues>,
  contact: PartyContact,
  suburbId?: number,
) {
  setValue('new_owner_name', contact.name);
  setValue('new_owner_email', contact.email);
  setValue('new_owner_street', contact.street);
  setValue('new_owner_suburb', contact.suburb);
  setValue('new_owner_city', contact.city);
  setValue('new_owner_mobile', contact.mobile);
  setValue('new_owner_telephone', contact.telephone);
  setValue(
    'new_owner_suburb_id',
    suburbId && suburbId > 0 ? suburbId : undefined,
  );
}

export function clearNewOwnerContactForm(
  setValue: UseFormSetValue<NewOwnerContactFormValues>,
) {
  setValue('new_owner_name', '');
  setValue('new_owner_email', '');
  setValue('new_owner_street', '');
  setValue('new_owner_suburb', '');
  setValue('new_owner_city', '');
  setValue('new_owner_mobile', '');
  setValue('new_owner_telephone', '');
  setValue('new_owner_suburb_id', undefined);
}

function normalizeContactValue(value?: string): string {
  return (value ?? '').trim();
}

function buildChangedPartyContactPatch(
  values: NewOwnerContactFormValues,
  original: PartyContact,
  originalSuburbId?: number,
) {
  const payload: {
    name?: string;
    email?: string;
    street?: string;
    suburb_id?: number;
    mobile?: string;
    telephone?: string;
  } = {};

  const name = normalizeContactValue(values.new_owner_name);
  if (name && name !== normalizeContactValue(original.name)) {
    payload.name = name;
  }

  const email = normalizeContactValue(values.new_owner_email);
  if (email !== normalizeContactValue(original.email)) {
    payload.email = email;
  }

  const street = normalizeContactValue(values.new_owner_street);
  const suburbId =
    values.new_owner_suburb_id && values.new_owner_suburb_id > 0
      ? values.new_owner_suburb_id
      : undefined;
  const streetChanged = street !== normalizeContactValue(original.street);
  const suburbChanged = suburbId !== originalSuburbId;
  if (streetChanged || suburbChanged) {
    const streetValue = street || normalizeContactValue(original.street);
    if (streetValue) {
      payload.street = streetValue;
    }
    if (suburbId) {
      payload.suburb_id = suburbId;
    }
  }

  const mobile = normalizeContactValue(values.new_owner_mobile);
  if (mobile !== normalizeContactValue(original.mobile)) {
    payload.mobile = mobile;
  }

  const telephone = normalizeContactValue(values.new_owner_telephone);
  if (telephone !== normalizeContactValue(original.telephone)) {
    payload.telephone = telephone;
  }

  return payload;
}

export async function syncNewOwnerContactToParty(
  ownerType: string,
  ownerId: number,
  values: NewOwnerContactFormValues,
  original: PartyContact,
  originalSuburbId?: number,
): Promise<void> {
  const payload = buildChangedPartyContactPatch(
    values,
    original,
    originalSuburbId,
  );

  if (Object.keys(payload).length === 0) {
    return;
  }

  if (ownerType === 'company') {
    await companiesApi.updateBranchContact(ownerId, payload);
  } else {
    await individualsApi.updateIndividualContact(ownerId, payload);
  }
}

function PartyContactField<T extends Record<string, unknown>>({
  label,
  name,
  locked,
  value,
  register,
  error,
  className,
}: {
  label: string;
  name: keyof T & string;
  locked: boolean;
  value?: string;
  register: UseFormRegister<T>;
  error?: string;
  className?: string;
}) {
  if (locked) {
    return (
      <div className={className}>
        <ReadOnlyField label={label} value={value ?? ''} />
      </div>
    );
  }
  return (
    <div className={className}>
      <Input label={label} {...register(name)} error={error} />
    </div>
  );
}

export function NewOwnerNameField({
  register,
  errors,
}: {
  register: UseFormRegister<NewOwnerContactFormValues>;
  errors: FieldErrors<NewOwnerContactFormValues>;
}) {
  return (
    <Input
      label="New Owner Name"
      {...register('new_owner_name')}
      error={errors.new_owner_name?.message}
    />
  );
}

export function EditableNewOwnerContactGrid({
  register,
  control,
  setValue,
  errors,
  className = 'grid grid-cols-2 gap-3 px-4 pb-4 sm:grid-cols-4',
}: {
  register: UseFormRegister<NewOwnerContactFormValues>;
  control: Control<NewOwnerContactFormValues>;
  setValue: UseFormSetValue<NewOwnerContactFormValues>;
  errors: FieldErrors<NewOwnerContactFormValues>;
  className?: string;
}) {
  return (
    <div className={className}>
      <Input
        label="New Owner Email"
        {...register('new_owner_email')}
        error={errors.new_owner_email?.message}
      />
      <Input
        label="New Owner Street No."
        {...register('new_owner_street')}
        error={errors.new_owner_street?.message}
      />
      <Controller
        name="new_owner_suburb_id"
        control={control}
        render={({ field }) => (
          <LocationCascadeSelects
            hideCountry
            suburbRequired={false}
            suburbLabel="New Owner Suburb"
            cityLabel="New Owner City/Town"
            value={field.value}
            onChange={(id) => {
              const suburbId = id > 0 ? id : undefined;
              field.onChange(suburbId);
              if (!suburbId) {
                setValue('new_owner_suburb', '');
                setValue('new_owner_city', '');
              }
            }}
            error={errors.new_owner_suburb_id?.message}
          />
        )}
      />
      <Input
        label="New Owner Mobile #"
        {...register('new_owner_mobile')}
        error={errors.new_owner_mobile?.message}
      />
      <Input
        label="New Owner Tel #"
        {...register('new_owner_telephone')}
        error={errors.new_owner_telephone?.message}
      />
    </div>
  );
}

export async function syncSellerContactToParty(
  ownerType: string,
  ownerId: number,
  values: SellerContactFormValues,
  fieldLocks: SellerFieldLocks,
): Promise<void> {
  const payload: {
    name?: string;
    email?: string;
    street?: string;
    suburb_id?: number;
    mobile?: string;
    telephone?: string;
  } = {};

  if (!fieldLocks.name && values.seller_name?.trim()) {
    payload.name = values.seller_name.trim();
  }
  if (!fieldLocks.email && values.seller_email?.trim()) {
    payload.email = values.seller_email.trim();
  }
  if (!fieldLocks.street && values.seller_street?.trim()) {
    payload.street = values.seller_street.trim();
  }
  if (!fieldLocks.mobile && values.seller_mobile?.trim()) {
    payload.mobile = values.seller_mobile.trim();
  }
  if (!fieldLocks.telephone && values.seller_telephone?.trim()) {
    payload.telephone = values.seller_telephone.trim();
  }
  if (
    !fieldLocks.street &&
    values.seller_suburb_id &&
    values.seller_suburb_id > 0
  ) {
    payload.suburb_id = values.seller_suburb_id;
  }

  if (Object.keys(payload).length === 0) {
    return;
  }

  if (ownerType === 'company') {
    await companiesApi.updateBranchContact(ownerId, payload);
  } else {
    await individualsApi.updateIndividualContact(ownerId, payload);
  }
}

export function ReadOnlyField({
  label,
  value,
  required,
}: {
  label: string;
  value: string;
  required?: boolean;
}) {
  return (
    <div>
      <span className="text-xs font-medium text-slate-600">
        {label}
        {required ? <span className="ml-0.5 text-red-500">*</span> : null}
      </span>
      <div className="mt-1 min-h-8 rounded border border-[#9e9e9e] bg-white px-3 py-1.5 text-sm text-slate-800">
        {value || '—'}
      </div>
    </div>
  );
}

function SellerContactField({
  label,
  name,
  locked,
  value,
  register,
  error,
  className,
}: {
  label: string;
  name: keyof SellerContactFormValues;
  locked: boolean;
  value?: string;
  register: UseFormRegister<SellerContactFormValues>;
  error?: string;
  className?: string;
}) {
  if (locked) {
    return (
      <div className={className}>
        <ReadOnlyField label={label} value={value ?? ''} />
      </div>
    );
  }
  return (
    <div className={className}>
      <Input label={label} {...register(name)} error={error} />
    </div>
  );
}

export function EditableSellerContactGrid({
  register,
  errors,
  fieldLocks,
  values,
  className = 'grid grid-cols-2 gap-3 px-4 pb-4 sm:grid-cols-4',
}: {
  register: UseFormRegister<SellerContactFormValues>;
  errors: FieldErrors<SellerContactFormValues>;
  fieldLocks: SellerFieldLocks;
  values: SellerContactFormValues;
  className?: string;
}) {
  return (
    <div className={className}>
      <SellerContactField
        label="Seller Name"
        name="seller_name"
        locked={fieldLocks.name}
        value={values.seller_name}
        register={register}
        error={errors.seller_name?.message}
        className="col-span-2"
      />
      <SellerContactField
        label="Seller Email"
        name="seller_email"
        locked={fieldLocks.email}
        value={values.seller_email}
        register={register}
        error={errors.seller_email?.message}
      />
      <SellerContactField
        label="Seller City/Town"
        name="seller_city"
        locked={fieldLocks.city}
        value={values.seller_city}
        register={register}
        error={errors.seller_city?.message}
      />
      <SellerContactField
        label="Seller Suburb"
        name="seller_suburb"
        locked={fieldLocks.suburb}
        value={values.seller_suburb}
        register={register}
        error={errors.seller_suburb?.message}
      />
      <SellerContactField
        label="Seller Street No."
        name="seller_street"
        locked={fieldLocks.street}
        value={values.seller_street}
        register={register}
        error={errors.seller_street?.message}
      />
      <SellerContactField
        label="Seller Mobile #"
        name="seller_mobile"
        locked={fieldLocks.mobile}
        value={values.seller_mobile}
        register={register}
        error={errors.seller_mobile?.message}
      />
      <SellerContactField
        label="Seller Tel #"
        name="seller_telephone"
        locked={fieldLocks.telephone}
        value={values.seller_telephone}
        register={register}
        error={errors.seller_telephone?.message}
      />
    </div>
  );
}

export function PartyContactGrid({
  contact,
  labelPrefix,
  className = 'grid grid-cols-2 gap-3 px-4 pb-4 sm:grid-cols-4',
}: {
  contact: PartyContact;
  labelPrefix: 'Seller' | 'Owner';
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="col-span-2">
        <ReadOnlyField label={`${labelPrefix} Name`} value={contact.name} />
      </div>
      <ReadOnlyField label={`${labelPrefix} Email`} value={contact.email} />
      <ReadOnlyField
        label={`${labelPrefix} City/Town`}
        value={contact.city}
      />
      <ReadOnlyField label={`${labelPrefix} Suburb`} value={contact.suburb} />
      <ReadOnlyField
        label={`${labelPrefix} Street No.`}
        value={contact.street}
      />
      <ReadOnlyField
        label={`${labelPrefix} Mobile #`}
        value={contact.mobile}
      />
      <ReadOnlyField label={`${labelPrefix} Tel #`} value={contact.telephone} />
    </div>
  );
}

export function ReadOnlyOwnerSection({
  detail,
  contact,
}: {
  detail: AssetRecord;
  contact: PartyContact;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 px-4 py-3 sm:grid-cols-4">
      <ReadOnlyField
        label="Owner Type"
        value={ownerTypeLabel(detail.owner_type)}
      />
      <ReadOnlyField label="ID/Comp Reg" value={detail.owner_id_reg ?? ''} />
      <ReadOnlyField label="Owner Name" value={detail.owner_name} />
      <ReadOnlyField label="Owner Email" value={contact.email} />
      <ReadOnlyField label="Owner Street No." value={contact.street} />
      <ReadOnlyField label="Owner Suburb" value={contact.suburb} />
      <ReadOnlyField label="Owner City/Town" value={contact.city} />
      <ReadOnlyField label="Owner Mobile #" value={contact.mobile} />
      <ReadOnlyField label="Owner Tel #" value={contact.telephone} />
    </div>
  );
}
