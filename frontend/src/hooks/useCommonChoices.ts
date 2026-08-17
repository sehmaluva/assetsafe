import { useQuery } from '@tanstack/react-query';
import { commonApi, type CommonChoicesResponse } from '@/api/commonApi';
import { queryOptions } from '@/api/queryOptions';
import {
  mergeChoiceOptions,
  SALE_TERMS_FALLBACK,
  TITLE_STATUS_FALLBACK,
  VALUATION_TYPE_FALLBACK,
} from '@/lib/lookupChoices';

export function useCommonChoices() {
  const query = useQuery({
    queryKey: ['common-choices'],
    queryFn: commonApi.getChoices,
    ...queryOptions.lists,
  });

  const choices: CommonChoicesResponse = {
    ...query.data,
    ValuationType: mergeChoiceOptions(
      query.data?.ValuationType,
      VALUATION_TYPE_FALLBACK,
    ),
    TitleStatus: mergeChoiceOptions(
      query.data?.TitleStatus,
      TITLE_STATUS_FALLBACK,
    ),
    SaleTerms: mergeChoiceOptions(query.data?.SaleTerms, SALE_TERMS_FALLBACK),
  };

  return { ...query, data: choices };
}
