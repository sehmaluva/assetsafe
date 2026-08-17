import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';

interface DeleteRecordButtonProps {
  label?: string;
  onDelete: () => Promise<void>;
  onDeleted: () => void;
}

export function DeleteRecordButton({
  label = 'Delete',
  onDelete,
  onDeleted,
}: DeleteRecordButtonProps) {
  const [confirming, setConfirming] = useState(false);

  const { mutate, isPending } = useMutation({
    mutationFn: onDelete,
    onSuccess: () => {
      setConfirming(false);
      toast.success('Record deleted');
      onDeleted();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message ?? 'Failed to delete record');
    },
  });

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="danger"
        leftIcon={<Trash2 className="h-3.5 w-3.5" />}
        onClick={() => setConfirming(true)}
      >
        {label}
      </Button>
      <ConfirmDialog
        open={confirming}
        title="Delete Record"
        message="Are you sure you want to delete this record? This cannot be undone."
        confirmLabel="Yes, Delete"
        variant="danger"
        loading={isPending}
        onConfirm={() => mutate()}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
