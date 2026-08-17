import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  enquiryApi,
  type EnquirySearchField,
  type EnquirySearchHit,
} from '@/api/enquiryApi';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AssetEnquiryReportPanel } from '@/components/enquiry/AssetEnquiryReportPanel';
import { useIsStaff } from '@/hooks/useIsStaff';

const FILTER_OPTIONS: { value: EnquirySearchField; label: string }[] = [
  { value: 'agreement_number', label: 'Agreement Number' },
  { value: 'serial_number', label: 'Serial Number' },
  { value: 'registration_number', label: 'Registration Number' },
  { value: 'chassis_number', label: 'Chassis Number' },
  { value: 'engine_number', label: 'Engine Number' },
  { value: 'stand_number', label: 'Stand Number' },
];

export default function AssetEnquiryPage() {
  const [params] = useSearchParams();
  const isStaff = useIsStaff();
  const logId = params.get('log') ? Number(params.get('log')) : undefined;
  const kind = params.get('kind') ?? 'internal';

  const [query, setQuery] = useState('');
  const [searchField, setSearchField] =
    useState<EnquirySearchField>('agreement_number');
  const [hits, setHits] = useState<EnquirySearchHit[] | null>(null);
  const [selected, setSelected] = useState<EnquirySearchHit | null>(null);
  const [searched, setSearched] = useState(false);

  const ensureLog = useMutation({
    mutationFn: async () => {
      if (logId) return logId;
      if (kind === 'external') {
        throw new Error('External enquiry requires a logged session');
      }
      const log = await enquiryApi.createLog({ kind: 'internal' });
      return log.id;
    },
  });

  const searchMutation = useMutation({
    mutationFn: async () => {
      const activeLogId = await ensureLog.mutateAsync();
      return enquiryApi.search({
        q: query.trim(),
        search_field: searchField,
        enquiry_log_id: activeLogId,
      });
    },
    onSuccess: (data) => {
      setSearched(true);
      setHits(data.results);
      setSelected(data.results.length > 0 ? data.results[0] : null);
    },
    onError: () => toast.error('Search failed'),
  });

  const reportQuery = useQuery({
    queryKey: ['asset-enquiry-report', selected?.source, selected?.id],
    queryFn: () =>
      enquiryApi.getReport({
        source: selected!.source,
        id: selected!.id,
      }),
    enabled: Boolean(selected),
  });

  const addLinks = useMemo(
    () => [
      { label: 'Collateral', to: '/collateral?add=1' },
      { label: 'HP', to: '/hire-purchase?add=1' },
      ...(isStaff
        ? [{ label: 'Asset Registry', to: '/registry?add=1' }]
        : []),
    ],
    [isStaff],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <div className="bg-[#0d47a1] px-4 py-3 text-center text-[15px] font-semibold uppercase tracking-wide text-white">
        Asset Enquiry
      </div>

      <div className="flex flex-wrap items-end gap-3 border-b border-[#8f8f8f] p-4">
        <div className="min-w-[220px] flex-1">
          <Input
            label="Agreement No./Reg. Number/Serial No./Eng-Chas. No"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (query.trim()) searchMutation.mutate();
              }
            }}
          />
        </div>
        <div className="w-52">
          <label className="text-xs font-medium text-slate-600">
            Filter Parameter
          </label>
          <select
            value={searchField}
            onChange={(e) =>
              setSearchField(e.target.value as EnquirySearchField)
            }
            className="mt-1 h-8 w-full rounded border border-slate-300 bg-white px-2 text-sm"
          >
            {FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <Button
          type="button"
          onClick={() => {
            if (!query.trim()) {
              toast.error('Enter a reference to search');
              return;
            }
            searchMutation.mutate();
          }}
          loading={searchMutation.isPending}
        >
          Search
        </Button>
      </div>

      {searched && hits && hits.length === 0 ? (
        <div className="m-4 rounded border border-[#8f8f8f] bg-[#fafafa] p-4 text-sm text-slate-700">
          <p>
            The particular asset with the reference given was not found in our
            database. Either use another reference or add the asset by clicking
            below.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#cfcfcf] bg-[#ececec] px-3 py-2 text-sm">
            <span className="font-medium text-slate-700">Add to :</span>
            {addLinks.map((link, i) => (
              <span key={link.to} className="inline-flex items-center gap-2">
                {i > 0 ? <span className="text-slate-400">/</span> : null}
                <Link
                  to={link.to}
                  className="font-semibold text-[#1565c0] hover:underline"
                >
                  {link.label}
                </Link>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {selected && reportQuery.data ? (
        <div className="p-4">
          <AssetEnquiryReportPanel report={reportQuery.data} />
        </div>
      ) : null}

      {selected && reportQuery.isLoading ? (
        <p className="p-4 text-sm text-slate-500">Loading report...</p>
      ) : null}

      {selected && reportQuery.isError ? (
        <p className="p-4 text-sm text-red-600">Could not load asset report.</p>
      ) : null}
    </div>
  );
}
