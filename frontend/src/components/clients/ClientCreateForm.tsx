import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { clientsApi } from '@/api/clientsApi';
import { individualsApi } from '@/api/individualsApi';
import { companiesApi } from '@/api/companiesApi';
import AutocompleteInput from '@/components/shared/AutocompleteInput';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Modal } from '@/components/shared/Modal';
import { IndividualCreateForm } from '@/components/individuals/IndividualCreateForm';
import { CompanyCreateForm } from '@/components/companies/CompanyCreateForm';

interface ClientCreateFormProps {
  onSuccess: (result: { id: number; name: string }) => void;
  onCancel: () => void;
  initialEntityType?: 'individual' | 'company';
}

export function ClientCreateForm({
  onSuccess,
  onCancel,
  initialEntityType = 'company',
}: ClientCreateFormProps) {
  const [entityType, setEntityType] = useState<'individual' | 'company'>(
    initialEntityType,
  );
  const [entityId, setEntityId] = useState<number>(0);
  const [entityError, setEntityError] = useState('');
  const [addIndividualOpen, setAddIndividualOpen] = useState(false);
  const [addCompanyOpen, setAddCompanyOpen] = useState(false);

  useEffect(() => {
    setEntityType(initialEntityType);
    setEntityId(0);
    setEntityError('');
  }, [initialEntityType]);

  const { mutate: submit, isPending } = useMutation({
    mutationFn: () =>
      clientsApi.createClient(
        entityType === 'individual'
          ? { individual_id: entityId }
          : { company_branch_id: entityId },
      ),
    onSuccess: (client) => {
      toast.success(`Client "${client.name}" created`);
      onSuccess(client);
    },
    onError: (err: unknown) => {
      const data = (
        err as { response?: { data?: Record<string, string | string[]> } }
      )?.response?.data;
      if (data && typeof data === 'object') {
        const messages = Object.values(data).flat().join(' ');
        if (messages) {
          toast.error(messages);
          return;
        }
      }
      toast.error('Failed to create client');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!entityId) {
      setEntityError('Select an individual or company branch');
      return;
    }
    setEntityError('');
    submit();
  };

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-4 p-4" noValidate>
        <Select
          label="Client Type"
          value={entityType}
          onChange={(e) => {
            setEntityType(e.target.value as 'individual' | 'company');
            setEntityId(0);
            setEntityError('');
          }}
        >
          <option value="company">Company</option>
          <option value="individual">Individual</option>
        </Select>

        <AutocompleteInput
          label={entityType === 'individual' ? 'Individual' : 'Company Branch'}
          placeholder={
            entityType === 'individual'
              ? 'Search by name or national ID...'
              : 'Search by name or registration number...'
          }
          queryKey={`client-create-${entityType}`}
          fetchFn={(q) =>
            entityType === 'company'
              ? companiesApi.searchBranches(q)
              : individualsApi.searchIndividuals(q)
          }
          resolveSelection={(item) =>
            entityType === 'company'
              ? companiesApi.resolveBranchSelection(item)
              : individualsApi.resolveIndividualSelection(item)
          }
          createLabel={
            entityType === 'company' ? 'Create company' : 'Create individual'
          }
          onCreateNew={() => {
            if (entityType === 'company') {
              setAddCompanyOpen(true);
            } else {
              setAddIndividualOpen(true);
            }
          }}
          error={entityError}
          value={entityId || undefined}
          onChange={(v) => {
            setEntityId(Number(v));
            setEntityError('');
          }}
        />

        <p className="text-xs text-slate-500">
          Creates a client record linked to the selected{' '}
          {entityType === 'individual' ? 'individual' : 'company branch'}.
        </p>

        <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" loading={isPending}>
            Create Client
          </Button>
        </div>
      </form>

      <Modal
        open={addIndividualOpen}
        onClose={() => setAddIndividualOpen(false)}
        title="Add Individual"
        size="lg"
      >
        <IndividualCreateForm
          onCancel={() => setAddIndividualOpen(false)}
          onSuccess={({ id }) => {
            setEntityType('individual');
            setEntityId(id);
            setEntityError('');
            setAddIndividualOpen(false);
          }}
        />
      </Modal>

      <Modal
        open={addCompanyOpen}
        onClose={() => setAddCompanyOpen(false)}
        title="Add Company"
        size="lg"
        disableBackdropClose
      >
        <CompanyCreateForm
          onCancel={() => setAddCompanyOpen(false)}
          onSuccess={({ id }) => {
            setEntityType('company');
            setEntityId(id);
            setEntityError('');
            setAddCompanyOpen(false);
          }}
        />
      </Modal>
    </>
  );
}
