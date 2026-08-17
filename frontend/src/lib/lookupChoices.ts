import type { ChoiceOption } from '@/api/commonApi';

export const VALUATION_TYPE_FALLBACK: ChoiceOption[] = [
  { value: 'purchase_price', label: 'Purchase Price' },
  { value: 'estimated_value', label: 'Estimated Value' },
  { value: 'professional_valuation', label: 'Professional Valuation' },
];

export const TITLE_STATUS_FALLBACK: ChoiceOption[] = [
  { value: 'deeds', label: 'Deeds' },
  { value: 'purchase_agreement', label: 'Purchase Agreement' },
];

export const SALE_TERMS_FALLBACK: ChoiceOption[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'installments', label: 'Installments' },
];

export function mergeChoiceOptions(
  apiOptions: ChoiceOption[] | undefined,
  fallbackOptions: ChoiceOption[],
): ChoiceOption[] {
  return apiOptions && apiOptions.length > 0 ? apiOptions : fallbackOptions;
}
