import { createPortal } from 'react-dom';
import { Modal } from './Modal';
import { Button } from '@/components/ui/button';

interface ConfirmDialogProps {
  open: boolean;
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary' | 'secondary' | 'success';
  loading?: boolean;
  /** Single OK button — for system notices that need acknowledgment, not a choice. */
  alertOnly?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * App-styled replacement for the browser's native `window.confirm()`, so
 * confirmation prompts match the rest of the UI instead of looking like a
 * stock OS alert box.
 *
 * Render as a sibling of other modals (not nested inside them) so the
 * backdrop and z-index behave correctly.
 */
export function ConfirmDialog({
  open,
  title = 'Please Confirm',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  loading = false,
  alertOnly = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  return createPortal(
    <Modal
      open={open}
      onClose={loading ? () => {} : onCancel}
      title={title}
      size="sm"
      disableBackdropClose
      centered
      draggable
    >
      <div className="space-y-4 bg-white p-5">
        <p className="text-sm leading-relaxed text-slate-700">{message}</p>
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-3">
          {!alertOnly && (
            <Button
              type="button"
              variant="ghost"
              disabled={loading}
              onClick={onCancel}
            >
              {cancelLabel}
            </Button>
          )}
          <Button
            type="button"
            variant={variant}
            loading={loading}
            onClick={onConfirm}
          >
            {alertOnly ? 'OK' : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>,
    document.body,
  );
}
