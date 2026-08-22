import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/shared/Modal';
import { AssetRegistryForm } from './AssetRegistryForm';
import { StandViewReport } from './StandViewReport';
import {
  StandOwnershipChangeForm,
  StandSaleTransitionForm,
} from './StandWorkflowForms';
import type { AssetRecord } from '@/types';
import { formatCurrency, formatDate } from '@/lib/utils';
import { assetTypeLabel } from '@/lib/assetTypes';
import { Button } from '@/components/ui/button';
import { Edit } from 'lucide-react';
// import { DeleteRecordButton } from '@/components/shared/DeleteRecordButton';
import { assetRegistryApi } from '@/api/assetRegistryApi';

interface AssetViewModalProps {
  record: AssetRecord;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}

type StandPanel = 'view' | 'ownership' | 'sale';

export function AssetViewModal({
  record,
  onClose,
  onSaved,
  onDeleted,
}: AssetViewModalProps) {
  const queryClient = useQueryClient();
  const [editMode, setEditMode] = useState(false);
  const [standPanel, setStandPanel] = useState<StandPanel>('view');
  const isLand = record.asset_category === 'land';

  const { data: detail, refetch } = useQuery({
    queryKey: ['asset-detail', record.id],
    queryFn: () => assetRegistryApi.getRecord(record.id),
    staleTime: 5 * 60 * 1000,
  });

  const refreshDetail = () => {
    refetch();
    queryClient.invalidateQueries({ queryKey: ['asset-detail', record.id] });
  };

  const handleStandSaved = () => {
    setStandPanel('view');
    refreshDetail();
    onSaved();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={
        isLand
          ? `Stand - ${record.registration_number}`
          : `Asset - ${record.registration_number}`
      }
      size="xl"
    >
      {isLand && !editMode ? (
        <>
          {standPanel === 'view' && detail ? (
            <StandViewReport
              detail={detail}
              onOwnershipChange={() => setStandPanel('ownership')}
              onSaleTransition={() => setStandPanel('sale')}
              onPrint={() => window.print()}
            />
          ) : null}
          {standPanel === 'ownership' && detail ? (
            <StandOwnershipChangeForm
              record={record}
              detail={detail}
              onSuccess={handleStandSaved}
              onCancel={() => setStandPanel('view')}
            />
          ) : null}
          {standPanel === 'sale' && detail ? (
            <StandSaleTransitionForm
              record={record}
              detail={detail}
              onSuccess={handleStandSaved}
              onCancel={() => setStandPanel('view')}
            />
          ) : null}
          {standPanel === 'view' ? (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-4 py-3">
              {/* Delete disabled for now
              <DeleteRecordButton
                onDelete={() => assetRegistryApi.deleteRecord(record.id)}
                onDeleted={onDeleted}
              />
              */}
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
            </div>
          ) : null}
        </>
      ) : editMode ? (
        detail ? (
          <AssetRegistryForm
            isEdit
            recordId={record.id}
            ownerDisplayLabel={
              detail.asset_category === 'land'
                ? (detail.owner_id_reg ?? '')
                : detail.owner_name
            }
            initial={{
              owner_type: detail.owner_type,
              owner_id: detail.owner_id,
              owner_asset_number: detail.owner_asset_number,
              asset_category: detail.asset_category,
              asset_type: detail.asset_type,
              asset_make: detail.asset_make,
              asset_model: detail.asset_model,
              year_of_make: detail.year_of_make,
              condition: detail.condition,
              mv_registration_no: detail.mv_registration_no,
              chassis_number: detail.chassis_number,
              engine_number: detail.engine_number,
              imei: detail.imei,
              serial_number: detail.serial_number,
              currency: detail.currency,
              estimated_value: detail.estimated_value,
              location_address: detail.location_address,
              subscription_start_date: detail.subscription_start_date,
              subscription_end_date: detail.subscription_end_date,
            }}
            onSuccess={onSaved}
            onCancel={() => setEditMode(false)}
          />
        ) : (
          <div className="flex items-center justify-center p-10 text-sm text-slate-400">
            Loading...
          </div>
        )
      ) : (
        <div className="p-5 space-y-4 bg-white">
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
            {[
              ['Registry No.', record.registration_number],
              ['Owner', detail?.owner_name ?? record.owner_name],
              [
                'Asset',
                `${detail?.asset_make ?? ''} ${detail?.asset_model ?? ''}`.trim() ||
                  record.asset_description,
              ],
              [
                'Asset Category',
                assetTypeLabel(detail?.asset_category ?? record.asset_category),
              ],
              ['Asset Type', detail?.asset_type || record.asset_type || '—'],
              ['Year', detail?.year_of_make ?? record.year_of_make],
              ['Condition', detail?.condition ?? record.condition],
              [
                'Reg/Serial/Stand',
                detail?.serial_number ||
                  detail?.stand_number ||
                  detail?.mv_registration_no ||
                  detail?.imei ||
                  record.serial_number ||
                  record.mv_registration_no,
              ],
              ['Currency', detail?.currency ?? record.currency],
              [
                'Est. Value',
                formatCurrency(detail?.estimated_value ?? record.estimated_value),
              ],
              ['Location', detail?.location_address ?? record.location_address],
              [
                'Sub. Start',
                formatDate(
                  detail?.subscription_start_date ??
                    record.subscription_start_date,
                ),
              ],
              [
                'Sub. End',
                formatDate(
                  detail?.subscription_end_date ?? record.subscription_end_date,
                ),
              ],
            ].map(([k, v]) => (
              <div key={String(k)}>
                <dt className="text-xs font-medium uppercase text-slate-400">
                  {k}
                </dt>
                <dd className="mt-0.5 font-medium text-slate-800">
                  {String(v ?? '—')}
                </dd>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-100">
            {/* Delete disabled for now
            <DeleteRecordButton
              onDelete={() => assetRegistryApi.deleteRecord(record.id)}
              onDeleted={onDeleted}
            />
            */}
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
              <Button
                leftIcon={<Edit className="h-3.5 w-3.5" />}
                onClick={() => setEditMode(true)}
              >
                Edit
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
