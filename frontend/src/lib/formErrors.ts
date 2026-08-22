import type {
  FieldErrors,
  FieldValues,
  Path,
  UseFormSetError,
} from 'react-hook-form';
import { toast } from 'sonner';

/** Maps API / serializer field names to form field names. */
const API_FIELD_MAP: Record<string, string> = {
  individual_owner: 'owner_id',
  company_owner: 'owner_id',
  individual_debtor: 'debtor_id',
  company_debtor: 'debtor_id',
  purchaser_individual: 'purchaser_id',
  purchaser_company: 'purchaser_id',
  financier: 'financier_id',
  make: 'asset_make',
  model: 'asset_model',
  year_of_make: 'asset_year',
  condition: 'asset_condition',
  asset_registration_number: 'asset_registration_no',
  mv_registration_number: 'mv_registration_no',
  reg_serial_number: 'reg_serial_number',
  total_debt: 'loan_amount',
  instalment_day: 'instalment_date',
  agreement_start_date: 'start_date',
  agreement_end_date: 'end_date',
  subscription_start_date: 'subscription_start_date',
  subscription_end_date: 'subscription_end_date',
};

function messageFromValue(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] ?? 'Invalid value');
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'message' in value) {
    return String((value as { message: unknown }).message);
  }
  return 'Invalid value';
}

function flattenApiErrors(
  payload: unknown,
  prefix = '',
): { field: string; message: string }[] {
  if (!payload || typeof payload !== 'object') return [];

  const out: { field: string; message: string }[] = [];

  for (const [key, value] of Object.entries(
    payload as Record<string, unknown>,
  )) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !(key in API_FIELD_MAP)
    ) {
      out.push(...flattenApiErrors(value, path));
      continue;
    }

    const formField = API_FIELD_MAP[key] ?? key;
    out.push({ field: formField, message: messageFromValue(value) });
  }

  return out;
}

/**
 * Applies Django / DRF validation errors to react-hook-form fields.
 * Returns true if any field error was set.
 */
export function applyApiValidationErrors<T extends FieldValues>(
  setError: UseFormSetError<T>,
  err: unknown,
): boolean {
  const data = (err as { response?: { data?: unknown } })?.response?.data;
  if (!data || typeof data !== 'object') return false;

  const body = data as Record<string, unknown>;

  // A plain string in `error` / `detail` / non_field_errors is a global message.
  if (typeof body.error === 'string' && !body.errors) return false;
  if (typeof body.detail === 'string') return false;
  if (Array.isArray(body.non_field_errors) && body.non_field_errors.length) {
    return false;
  }

  const errorPayload =
    body.errors ?? (typeof body.error === 'object' ? body.error : null) ?? body;

  const flattened = flattenApiErrors(errorPayload).filter(
    ({ field }) => field !== 'non_field_errors' && field !== 'detail',
  );
  if (!flattened.length) return false;

  for (const { field, message } of flattened) {
    setError(field as Path<T>, { type: 'server', message });
  }

  return true;
}

/** Best-effort global API error message for toasts. */
export function getApiErrorMessage(err: unknown): string | undefined {
  const data = (err as { response?: { data?: unknown } })?.response?.data;
  if (!data) return undefined;
  if (typeof data === 'string') return data;
  if (typeof data !== 'object') return undefined;
  const body = data as Record<string, unknown>;
  if (typeof body.detail === 'string') return body.detail;
  if (typeof body.error === 'string') return body.error;
  if (typeof body.message === 'string') return body.message;
  if (Array.isArray(body.non_field_errors) && body.non_field_errors[0]) {
    return String(body.non_field_errors[0]);
  }
  return undefined;
}

/** Apply field errors when possible; otherwise toast the API message. */
export function handleFormSubmitError<T extends FieldValues>(
  setError: UseFormSetError<T>,
  err: unknown,
  fallbackMessage: string,
): void {
  if (applyApiValidationErrors(setError, err)) {
    toast.error('Please fix the highlighted fields');
    return;
  }
  toast.error(getApiErrorMessage(err) ?? fallbackMessage);
}

/** Returns the first validation message from a react-hook-form errors object. */
export function firstFormErrorMessage(errors: FieldErrors): string | undefined {
  for (const value of Object.values(errors)) {
    if (!value || typeof value !== 'object') continue;
    if ('message' in value && typeof value.message === 'string') {
      return value.message;
    }
    const nested = firstFormErrorMessage(value as FieldErrors);
    if (nested) return nested;
  }
  return undefined;
}
