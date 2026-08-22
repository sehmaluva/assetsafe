import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Eye,
  Layers,
  Plus,
  Search,
} from 'lucide-react';
import { hirePurchaseApi } from '@/api/hirePurchaseApi';
import { InlineStat } from '@/components/shared/InlineStat';
import { TableSkeleton } from '@/components/shared/TableSkeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Modal } from '@/components/shared/Modal';
import { HirePurchaseForm } from '@/components/hire-purchase/HirePurchaseForm';
import { HirePurchaseViewModal } from '@/components/hire-purchase/HirePurchaseViewModal';
import { NumberedPaginationFooter } from '@/components/shared/NumberedPaginationFooter';
import {
  cn,
  formatCurrency,
  formatDate,
  formatDollarAmount,
} from '@/lib/utils';
import { invalidateRegistryQueries } from '@/lib/registryCache';
import { registryQueryOptions } from '@/lib/registryQueryOptions';
import { isStaffUser } from '@/lib/registryNav';
import { useAuthStore } from '@/store';
import type { HirePurchaseRecord } from '@/types';

const PAGE_SIZE = 20;

type HirePurchaseSortOption =
  | 'date-desc'
  | 'date-asc'
  | 'name-asc'
  | 'name-desc';

type HirePurchaseSearchField =
  | 'agreement_number'
  | 'purchaser'
  | 'reg_serial_number'
  | 'financier';

const SEARCH_FIELD_OPTIONS: {
  value: HirePurchaseSearchField;
  label: string;
}[] = [
  { value: 'agreement_number', label: 'Agreement Number' },
  { value: 'purchaser', label: 'Purchaser Name' },
  { value: 'reg_serial_number', label: 'Reg/Serial Number' },
  { value: 'financier', label: 'Financier' },
];

const SEARCH_FIELD_PLACEHOLDERS: Record<HirePurchaseSearchField, string> = {
  agreement_number: 'Search by agreement number...',
  purchaser: 'Search by purchaser name...',
  reg_serial_number: 'Search by reg/serial number...',
  financier: 'Search by financier name...',
};

/** Agreement end date has passed (matches backend pending-closure logic). */
function isExpired(rec: HirePurchaseRecord): boolean {
  if (!rec.end_date) {
    return false;
  }
  const end = new Date(rec.end_date);
  if (Number.isNaN(end.getTime())) {
    return false;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return end < today;
}

export default function HirePurchasePage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const authReady = useAuthStore((s) => s.authReady);
  const user = useAuthStore((s) => s.user);
  const isStaff = isStaffUser(user);
  const searchFieldOptions = useMemo(
    () =>
      SEARCH_FIELD_OPTIONS.filter(
        (opt) => isStaff || opt.value !== 'financier',
      ),
    [isStaff],
  );
  const [searchField, setSearchField] =
    useState<HirePurchaseSearchField>('agreement_number');
  const [searchValue, setSearchValue] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [appliedSearchField, setAppliedSearchField] =
    useState<HirePurchaseSearchField>('agreement_number');
  const [sortOption, setSortOption] =
    useState<HirePurchaseSortOption>('date-desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const [addMultipleOpen, setAddMultipleOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [viewRecord, setViewRecord] = useState<HirePurchaseRecord | null>(null);

  useEffect(() => {
    if (isStaff) return;
    if (searchField === 'financier') {
      setSearchField('agreement_number');
    }
    if (appliedSearchField === 'financier') {
      setAppliedSearchField('agreement_number');
      setAppliedSearch('');
      setSearchValue('');
      setCurrentPage(1);
    }
  }, [isStaff, searchField, appliedSearchField]);

  const openAddSingle = async () => {
    setAddOpen(true);
  };

  const openAddMultiple = async (file: File) => {
    setUploadFile(file);
    setAddMultipleOpen(true);
  };

  useEffect(() => {
    if (searchParams.get('add') === '1') {
      void openAddSingle();
      const next = new URLSearchParams(searchParams);
      next.delete('add');
      setSearchParams(next, { replace: true });
    }
    // Intentionally only react to the add=1 deep link.
  }, [searchParams, setSearchParams]);

  const { data: statsData } = useQuery({
    queryKey: ['hp-dashboard'],
    queryFn: () => hirePurchaseApi.getDashboard(),
    enabled: authReady,
    ...registryQueryOptions,
  });

  const {
    data: recordsData,
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: ['hp-records', appliedSearch, appliedSearchField, currentPage],
    queryFn: () =>
      hirePurchaseApi.getRecords({
        ...(appliedSearch
          ? { search: appliedSearch, search_field: appliedSearchField }
          : {}),
        page: currentPage,
        page_size: PAGE_SIZE,
      }),
    enabled: authReady,
    ...registryQueryOptions,
  });

  const loadingRecords = !authReady || isLoading || isFetching;

  const handleViewRecord = (rec: HirePurchaseRecord) => {
    void queryClient.prefetchQuery({
      queryKey: ['hire-purchase-detail', rec.id],
      queryFn: () => hirePurchaseApi.getRecord(rec.id),
      staleTime: 5 * 60 * 1000,
    });
    setViewRecord(rec);
  };

  const handleSearch = () => {
    setAppliedSearch(searchValue.trim());
    setAppliedSearchField(searchField);
    setCurrentPage(1);
  };

  const refreshList = (clearFilters = false, id?: number) => {
    if (clearFilters) {
      setSearchValue('');
      setAppliedSearch('');
      setSearchField('agreement_number');
      setAppliedSearchField('agreement_number');
    }
    setCurrentPage(1);
    invalidateRegistryQueries(queryClient, 'hp', id);
  };

  const totalRecords = recordsData?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRecords / PAGE_SIZE));
  const activePage = Math.min(currentPage, totalPages);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const activeSortField = sortOption.startsWith('date') ? 'date' : 'name';
  const activeSortDirection = sortOption.endsWith('asc') ? 'asc' : 'desc';

  const toggleSort = (field: 'date' | 'name') => {
    setSortOption((current) => {
      const currentField = current.startsWith('date') ? 'date' : 'name';
      const currentDirection = current.endsWith('asc') ? 'asc' : 'desc';

      if (currentField === field) {
        return `${field}-${currentDirection === 'asc' ? 'desc' : 'asc'}` as HirePurchaseSortOption;
      }

      return field === 'date' ? 'date-desc' : 'name-asc';
    });
    setCurrentPage(1);
  };

  const sortedRecords = useMemo(() => {
    if (!recordsData?.records) {
      return [] as HirePurchaseRecord[];
    }

    const compareDate = (
      left: HirePurchaseRecord,
      right: HirePurchaseRecord,
    ) => {
      const leftTime = new Date(left.lodge_date ?? '').getTime();
      const rightTime = new Date(right.lodge_date ?? '').getTime();
      return leftTime - rightTime;
    };

    const compareName = (left: HirePurchaseRecord, right: HirePurchaseRecord) =>
      (left.purchaser_name ?? '').localeCompare(
        right.purchaser_name ?? '',
        undefined,
        {
          sensitivity: 'base',
        },
      );

    const sorted = [...recordsData.records];

    sorted.sort((left, right) => {
      switch (sortOption) {
        case 'date-asc':
          return compareDate(left, right);
        case 'date-desc':
          return compareDate(right, left);
        case 'name-asc':
          return compareName(left, right);
        case 'name-desc':
          return compareName(right, left);
        default:
          return 0;
      }
    });

    return sorted;
  }, [recordsData, sortOption]);

  const startItem = totalRecords === 0 ? 0 : (activePage - 1) * PAGE_SIZE + 1;
  const endItem = Math.min(activePage * PAGE_SIZE, totalRecords);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden border border-[#8f8f8f] bg-white">
        <div className="bg-[#7f7a7b] px-3 py-1.5 text-center text-[15px] font-bold uppercase tracking-wide text-white">
          Hire Purchase Registry
        </div>

        <div className="flex flex-wrap items-center gap-3 border-b border-[#8f8f8f] bg-[#f8f7f2] px-3 py-2">
          {isStaff ? (
            <InlineStat
              label="Financiers"
              value={statsData?.number_of_financiers ?? 0}
            />
          ) : null}
          <InlineStat
            label="Active"
            value={statsData?.active_agreements ?? 0}
          />
          <InlineStat
            label="Pending Closure"
            value={statsData?.pending_closure_confirmation ?? 0}
          />
          <InlineStat
            label="Active Loan Value"
            value={formatDollarAmount(statsData?.total_active_loan_value ?? 0)}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#8f8f8f] px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-bold text-black">Search</span>
            <Select
              value={searchField}
              onChange={(e) =>
                setSearchField(e.target.value as HirePurchaseSearchField)
              }
              className="h-7 min-w-[140px] rounded-none border-black text-[12px] leading-7"
            >
              {searchFieldOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
            <input
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder={SEARCH_FIELD_PLACEHOLDERS[searchField]}
              className="h-7 w-56 border border-black bg-white px-2 text-[12px] focus:outline-none"
            />
            <Button
              size="sm"
              variant="primary"
              leftIcon={<Search className="h-3 w-3" />}
              onClick={handleSearch}
              className="h-7 px-2 text-[12px]"
            >
              Search
            </Button>
            {appliedSearch ? (
              <button
                type="button"
                className="text-[11px] text-[#196A86] underline"
                onClick={() => {
                  setSearchValue('');
                  setAppliedSearch('');
                  setSearchField('agreement_number');
                  setAppliedSearchField('agreement_number');
                  setCurrentPage(1);
                }}
              >
                Clear filter
              </button>
            ) : null}
          </div>

          <div className="flex flex-col items-stretch">
            <div className="flex gap-1">
              <Button
                size="sm"
                variant="success"
                leftIcon={<Plus className="h-3.5 w-3.5" />}
                onClick={() => void openAddSingle()}
                className="h-7 rounded-none px-3 text-[12px] font-bold"
              >
                Add Single
              </Button>
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<Layers className="h-3.5 w-3.5" />}
                onClick={() => fileInputRef.current?.click()}
                className="h-7 rounded-none px-3 text-[12px] font-bold"
              >
                Add Multiple
              </Button>
              {/* Hidden file input — CSV / Excel only */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  if (file) {
                    void openAddMultiple(file);
                  }
                  // reset so the same file can be re-selected if needed
                  e.target.value = '';
                }}
              />
            </div>
          </div>
        </div>

        <div className="bg-[#7f7a7b] px-3 py-1 text-center text-[14px] font-bold uppercase text-white">
          Active Agreements
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="sticky top-0 z-10 border-b border-[#8f8f8f] bg-white text-left divide-x divide-[#8f8f8f]">
                  <th className="w-8 px-2 py-2 font-bold">#</th>
                  <th className="px-2 py-2 font-bold">
                    <button
                      type="button"
                      onClick={() => toggleSort('date')}
                      className="flex items-center gap-1"
                    >
                      Lodge Date
                      {activeSortField === 'date' ? (
                        activeSortDirection === 'asc' ? (
                          <ArrowUp className="h-3 w-3" />
                        ) : (
                          <ArrowDown className="h-3 w-3" />
                        )
                      ) : (
                        <ArrowUpDown className="h-3 w-3" />
                      )}
                    </button>
                  </th>
                  <th className="px-2 py-2 font-bold">
                    {isStaff ? 'Financier' : 'Agreement Number'}
                  </th>
                  <th className="px-2 py-2 font-bold">
                    <button
                      type="button"
                      onClick={() => toggleSort('name')}
                      className="flex items-center gap-1"
                    >
                      Purchaser
                      {activeSortField === 'name' ? (
                        activeSortDirection === 'asc' ? (
                          <ArrowUp className="h-3 w-3" />
                        ) : (
                          <ArrowDown className="h-3 w-3" />
                        )
                      ) : (
                        <ArrowUpDown className="h-3 w-3" />
                      )}
                    </button>
                  </th>
                  <th className="px-2 py-2 font-bold">Asset</th>
                  <th className="px-2 py-2 font-bold">Reg/Serial</th>
                  <th className="px-2 py-2 font-bold">Currency</th>
                  <th className="px-2 py-2 font-bold text-right">
                    Purchase Amount
                  </th>
                  <th className="px-2 py-2 font-bold">Start</th>
                  <th className="px-2 py-2 font-bold">End</th>
                  <th className="px-2 py-2 font-bold" />
                </tr>
              </thead>
              <tbody>
                {loadingRecords ? (
                  <TableSkeleton rows={8} cols={11} />
                ) : !sortedRecords.length ? (
                  <EmptyState message="No hire purchase agreements found." />
                ) : (
                  sortedRecords.map((rec, idx) => (
                    <tr
                      key={rec.id}
                      className={cn(
                        'border-b border-[#8f8f8f]',
                        idx % 2 === 0 ? 'bg-white' : 'bg-[#fafafa]',
                      )}
                    >
                      <td className="border-r border-[#8f8f8f] px-2 py-2">
                        {(activePage - 1) * PAGE_SIZE + idx + 1}
                      </td>
                      <td className="border-r border-[#8f8f8f] px-2 py-2">
                        {formatDate(rec.lodge_date)}
                      </td>
                      <td
                        className={cn(
                          'border-r border-[#8f8f8f] px-2 py-2',
                          isStaff && 'font-medium text-[#196A86]',
                        )}
                      >
                        {isStaff ? rec.financier_name : rec.agreement_number}
                      </td>
                      <td className="border-r border-[#8f8f8f] px-2 py-2">
                        {rec.purchaser_name}
                      </td>
                      <td className="border-r border-[#8f8f8f] px-2 py-2">
                        {rec.asset_description}
                      </td>
                      <td className="border-r border-[#8f8f8f] px-2 py-2">
                        {rec.reg_serial_number}
                      </td>
                      <td className="border-r border-[#8f8f8f] px-2 py-2">
                        {rec.currency}
                      </td>
                      <td className="border-r border-[#8f8f8f] px-2 py-2 text-right">
                        {formatCurrency(rec.purchase_amount)}
                      </td>
                      <td className="border-r border-[#8f8f8f] px-2 py-2">
                        {formatDate(rec.start_date)}
                      </td>
                      <td className="border-r border-[#8f8f8f] px-2 py-2">
                        {formatDate(rec.end_date)}
                      </td>
                      <td className="px-2 py-2">
                        <button
                          type="button"
                          onClick={() => handleViewRecord(rec)}
                          className={cn(
                            'flex items-center gap-1 px-2 py-1 text-[11px] font-bold uppercase text-white',
                            isExpired(rec)
                              ? 'bg-[#f97316] hover:bg-[#ea580c]'
                              : 'bg-[#196A86] hover:bg-[#15586f]',
                          )}
                        >
                          <Eye className="h-3 w-3" />
                          View
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <NumberedPaginationFooter
            startItem={startItem}
            endItem={endItem}
            totalRecords={totalRecords}
            activePage={activePage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
          />
        </div>
      </div>

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Hire Purchase Form"
        size="xl"
      >
        <HirePurchaseForm
          onSuccess={() => {
            setAddOpen(false);
            toast.success('Hire purchase record created successfully');
            refreshList(true);
          }}
          onCancel={() => setAddOpen(false)}
        />
      </Modal>

      <Modal
        open={addMultipleOpen}
        onClose={() => {
          setAddMultipleOpen(false);
          setUploadFile(null);
        }}
        title="Upload Multiple Records"
        size="sm"
      >
        <div className="flex flex-col gap-4 p-6">
          <div className="flex items-center gap-3 rounded border border-slate-200 bg-slate-50 px-4 py-3">
            <Layers className="h-5 w-5 shrink-0 text-slate-400" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-800">
                {uploadFile?.name}
              </p>
              <p className="text-xs text-slate-500">
                {uploadFile ? (uploadFile.size / 1024).toFixed(1) + ' KB' : ''}
              </p>
            </div>
          </div>
          <p className="text-sm text-slate-500">
            Import functionality coming soon. Your file has been selected and is
            ready for processing.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setAddMultipleOpen(false);
                setUploadFile(null);
              }}
            >
              Close
            </Button>
          </div>
        </div>
      </Modal>

      {viewRecord && (
        <HirePurchaseViewModal
          record={viewRecord}
          onClose={() => setViewRecord(null)}
          onSaved={(id) => {
            setViewRecord(null);
            refreshList(false, id);
          }}
        />
      )}
    </div>
  );
}
