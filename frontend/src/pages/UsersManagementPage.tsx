import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { usersApi, type CreateUserPayload } from '@/api/usersApi';
import { clientsApi } from '@/api/clientsApi';
import { TableSkeleton } from '@/components/shared/TableSkeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { NumberedPaginationFooter } from '@/components/shared/NumberedPaginationFooter';
import { Modal } from '@/components/shared/Modal';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import AutocompleteInput from '@/components/shared/AutocompleteInput';
import { ClientCreateForm } from '@/components/clients/ClientCreateForm';
import { formatDate } from '@/lib/utils';
import type { SearchOption } from '@/lib/searchResults';

const PAGE_SIZE = 20;

function initialFormState(): CreateUserPayload {
  return {
    email: '',
    username: '',
    password: '',
    first_name: '',
    last_name: '',
    position: '',
    is_staff: false,
    is_superuser: false,
  };
}

export default function UsersManagementPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [addClientOpen, setAddClientOpen] = useState(false);
  const [form, setForm] = useState<CreateUserPayload>(initialFormState);
  const [clientId, setClientId] = useState<number | undefined>();
  const [clientLabel, setClientLabel] = useState('');
  const [clientEntityType, setClientEntityType] = useState<
    'individual' | 'company'
  >('company');
  const [saving, setSaving] = useState(false);
  const clientSearchResults = useRef<SearchOption[]>([]);

  const resetCreateForm = () => {
    setForm(initialFormState());
    setClientId(undefined);
    setClientLabel('');
    setClientEntityType('company');
  };

  const closeCreateModal = () => {
    setCreateOpen(false);
    resetCreateForm();
  };

  const { data, isLoading, isFetching, isError } = useQuery({
    queryKey: ['managed-users', page, appliedSearch],
    queryFn: () =>
      usersApi.list({
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

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.is_staff && !clientId) {
      toast.error('Client users must be linked to a client.');
      return;
    }

    setSaving(true);
    try {
      await usersApi.create({
        ...form,
        email: form.email.trim().toLowerCase(),
        username: form.username?.trim() || form.email.split('@')[0],
        ...(clientId ? { client_id: clientId } : {}),
        ...(form.position?.trim() ? { position: form.position.trim() } : {}),
      });
      toast.success('User created');
      closeCreateModal();
      queryClient.invalidateQueries({ queryKey: ['managed-users'] });
    } catch (err: unknown) {
      const detail = (
        err as { response?: { data?: { detail?: string; email?: string[] } } }
      )?.response?.data;
      const message =
        (typeof detail?.detail === 'string' && detail.detail) ||
        (Array.isArray(detail?.email) && detail.email.join(' ')) ||
        'Could not create user';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">User management</h1>
          <p className="text-sm text-slate-600">
            Create and manage system users.
          </p>
        </div>
        <Button type="button" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> New user
        </Button>
      </div>

      <div className="flex gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search username or email"
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

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-[#8f8f8f]">
        <div className="min-h-0 flex-1 overflow-auto">
          {isError && !loading ? (
            <EmptyState message="Could not load users." />
          ) : !loading && rows.length === 0 ? (
            <EmptyState message="No users found." />
          ) : (
            <table className="w-full min-w-[700px] border-collapse text-left text-sm">
              <thead className="sticky top-0 bg-[#e3e0da] text-xs font-bold uppercase">
                <tr>
                  <th className="px-3 py-2">Username</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Staff</th>
                  <th className="px-3 py-2">Superuser</th>
                  <th className="px-3 py-2">Joined</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <TableSkeleton cols={6} rows={8} />
                ) : (
                  rows.map((row) => (
                    <tr key={row.id} className="border-t border-slate-200">
                      <td className="px-3 py-2 font-medium">{row.username}</td>
                      <td className="px-3 py-2">{row.email}</td>
                      <td className="px-3 py-2">{row.user_type}</td>
                      <td className="px-3 py-2">{row.is_staff ? 'Yes' : 'No'}</td>
                      <td className="px-3 py-2">
                        {row.is_superuser ? 'Yes' : 'No'}
                      </td>
                      <td className="px-3 py-2">{formatDate(row.date_joined)}</td>
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

      <Modal
        open={createOpen}
        onClose={closeCreateModal}
        title="Create user"
        size="md"
      >
        <form onSubmit={handleCreate} className="space-y-4 p-1">
          {(
            [
              ['email', 'Email', 'email'],
              ['username', 'Username', 'text'],
              ['password', 'Password', 'password'],
              ['first_name', 'First name', 'text'],
              ['last_name', 'Last name', 'text'],
              ['position', 'Position', 'text'],
            ] as const
          ).map(([key, label, type]) => (
            <div key={key}>
              <label className="text-sm font-semibold">{label}</label>
              <input
                type={type}
                required={key === 'email' || key === 'password'}
                value={form[key] as string}
                onChange={(e) =>
                  setForm((f) => ({ ...f, [key]: e.target.value }))
                }
                className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          ))}

          <div className="rounded border border-slate-200 bg-slate-50 p-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-slate-800">
                Client association
              </p>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                leftIcon={<Building2 className="h-3.5 w-3.5" />}
                onClick={() => setAddClientOpen(true)}
              >
                Add Client
              </Button>
            </div>

            <Select
              label="Client type"
              value={clientEntityType}
              onChange={(e) => {
                setClientEntityType(
                  e.target.value as 'individual' | 'company',
                );
                setClientId(undefined);
                setClientLabel('');
              }}
            >
              <option value="company">Company</option>
              <option value="individual">Individual</option>
            </Select>

            <AutocompleteInput
              label="Link client"
              placeholder="Search client by name..."
              queryKey={`user-create-client-${clientEntityType}`}
              displayLabel={clientLabel}
              fetchFn={async (q) => {
                const results = await clientsApi.searchClients(q, {
                  entityType: clientEntityType,
                });
                clientSearchResults.current = results;
                return results;
              }}
              value={clientId}
              onChange={(id) => {
                if (!id) {
                  setClientId(undefined);
                  setClientLabel('');
                  return;
                }
                setClientId(Number(id));
                const match = clientSearchResults.current.find((r) => r.id === id);
                setClientLabel(match?.name ?? '');
              }}
            />

            {clientId ? (
              <button
                type="button"
                className="text-xs text-[#196A86] underline"
                onClick={() => {
                  setClientId(undefined);
                  setClientLabel('');
                }}
              >
                Clear linked client
              </button>
            ) : null}

            <p className="text-xs text-slate-500">
              {form.is_staff
                ? 'Optional for staff. Link a client to create a client portal user; leave blank for internal staff only.'
                : 'Required for non-staff users. Search an existing client or use Add Client to register one first.'}
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.is_staff}
              onChange={(e) =>
                setForm((f) => ({ ...f, is_staff: e.target.checked }))
              }
            />
            Staff (can access asset registry)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.is_superuser}
              onChange={(e) =>
                setForm((f) => ({ ...f, is_superuser: e.target.checked }))
              }
            />
            Superuser (admin tools)
          </label>

          <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
            <Button type="button" variant="outline" onClick={closeCreateModal}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={addClientOpen}
        onClose={() => setAddClientOpen(false)}
        title="Add Client"
        size="md"
      >
        <ClientCreateForm
          initialEntityType={clientEntityType}
          onCancel={() => setAddClientOpen(false)}
          onSuccess={({ id, name }) => {
            setClientId(id);
            setClientLabel(name);
            setAddClientOpen(false);
            toast.success(`${name} linked — ready to assign to user`);
          }}
        />
      </Modal>
    </div>
  );
}
