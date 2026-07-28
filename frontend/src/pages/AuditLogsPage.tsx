import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { auditApi } from '@/api/auditApi';
import { TableSkeleton } from '@/components/shared/TableSkeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { NumberedPaginationFooter } from '@/components/shared/NumberedPaginationFooter';
import { formatDate } from '@/lib/utils';

const PAGE_SIZE = 20;

export default function AuditLogsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');

  const { data, isLoading, isFetching, isError } = useQuery({
    queryKey: ['audit-logs', page, appliedSearch],
    queryFn: () =>
      auditApi.list({
        page,
        page_size: PAGE_SIZE,
        ...(appliedSearch ? { search: appliedSearch } : {}),
      }),
  });

  const loading = isLoading || isFetching;
  const totalRecords = data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRecords / PAGE_SIZE));
  const activePage = Math.min(page, totalPages);
  const rows = data?.results ?? [];
  const startItem = totalRecords === 0 ? 0 : (activePage - 1) * PAGE_SIZE + 1;
  const endItem = Math.min(activePage * PAGE_SIZE, totalRecords);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Audit logs</h1>
          <p className="text-sm text-slate-600">
            System activity trail (superuser only).
          </p>
        </div>
        <div className="flex gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search action, resource…"
            className="rounded border border-slate-300 px-3 py-1.5 text-sm"
          />
          <button
            type="button"
            className="rounded bg-[#0f7d8e] px-3 py-1.5 text-sm font-semibold text-white"
            onClick={() => {
              setAppliedSearch(search.trim());
              setPage(1);
            }}
          >
            Search
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-[#8f8f8f]">
        <div className="min-h-0 flex-1 overflow-auto">
          {isError && !loading ? (
            <EmptyState message="Could not load audit logs." />
          ) : !loading && rows.length === 0 ? (
            <EmptyState message="No audit entries found." />
          ) : (
            <table className="w-full min-w-[800px] border-collapse text-left text-sm">
              <thead className="sticky top-0 bg-[#e3e0da] text-xs font-bold uppercase">
                <tr>
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">User</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Resource</th>
                  <th className="px-3 py-2">Success</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <TableSkeleton cols={5} rows={10} />
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} className="border-t border-slate-200">
                      <td className="px-3 py-2 whitespace-nowrap">
                        {formatDate(row.timestamp)}
                      </td>
                      <td className="px-3 py-2">
                        {row.created_by_username ?? '—'}
                      </td>
                      <td className="px-3 py-2 font-medium">{row.action}</td>
                      <td className="px-3 py-2">
                        {row.resource_type}
                        {row.resource_id != null ? ` #${row.resource_id}` : ''}
                      </td>
                      <td className="px-3 py-2">
                        {row.success ? (
                          <span className="text-green-700">Yes</span>
                        ) : (
                          <span className="text-red-700">No</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
        {totalRecords > 0 ? (
          <NumberedPaginationFooter
            startItem={startItem}
            endItem={endItem}
            totalRecords={totalRecords}
            activePage={activePage}
            totalPages={totalPages}
            onPageChange={setPage}
          />
        ) : null}
      </div>
    </div>
  );
}
