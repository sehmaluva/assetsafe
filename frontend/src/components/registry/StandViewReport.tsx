import type { AssetRecord } from '@/types';
import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/button';

function ReportRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(140px,200px)_1fr] items-center gap-3 py-1.5">
      <span className="text-sm font-bold text-slate-900">{label}</span>
      <div className="min-h-8 rounded border border-[#9e9e9e] bg-white px-3 py-1.5 text-sm text-slate-800">
        {value || '—'}
      </div>
    </div>
  );
}

export function StandViewReport({
  detail,
  onOwnershipChange,
  onSaleTransition,
  onPrint,
}: {
  detail: AssetRecord;
  onOwnershipChange: () => void;
  onSaleTransition: () => void;
  onPrint: () => void;
}) {
  const isSold =
    detail.stand_status === 'sold' || Boolean(detail.open_sale);

  return (
    <div>
      <div className="bg-[#0d47a1] px-4 py-3 text-center text-[15px] font-semibold uppercase tracking-wide text-white">
        Stand/Plot/Land Report
      </div>
      <div className="space-y-1 px-4 py-3">
        <ReportRow label="Asset Description" value={detail.asset_type || 'Stand'} />
        <ReportRow label="Area / Development" value={detail.suburb_name ?? ''} />
        <ReportRow label="Stand Number" value={detail.stand_number ?? ''} />
        <ReportRow label="Stand Size" value={detail.stand_size ?? ''} />
        <ReportRow label="City/Town" value={detail.city_name ?? ''} />
        <ReportRow label="Owner" value={detail.owner_name} />
        <ReportRow label="ID / Reg. No." value={detail.owner_id_reg ?? ''} />
        <ReportRow
          label="Est. Value"
          value={formatCurrency(detail.estimated_value)}
        />
      </div>

      <div
        className={`px-4 py-2.5 text-center text-sm font-semibold text-white ${
          isSold ? 'bg-[#ef6c00]' : 'bg-[#2e7d32]'
        }`}
      >
        {isSold ? 'Status - Sold' : 'Status - Clear'}
      </div>

      {isSold && detail.open_sale ? (
        <div className="space-y-1 px-4 py-3">
          <ReportRow
            label="Purchaser"
            value={detail.open_sale.purchaser_display ?? ''}
          />
          <ReportRow
            label="ID / Reg. No."
            value={detail.open_sale.purchaser_id_reg ?? ''}
          />
          <ReportRow label="Date of Sale" value={detail.open_sale.sale_date} />
        </div>
      ) : null}

      <div className="grid grid-cols-3 gap-2 px-4 py-4 print:hidden">
        <Button
          variant="success"
          size="md"
          className="h-10 min-w-0 w-full px-2 text-xs sm:text-sm"
          onClick={onOwnershipChange}
        >
          Ownership Change
        </Button>
        <Button
          variant="secondary"
          size="md"
          className="h-10 min-w-0 w-full px-2 text-xs sm:text-sm"
          onClick={onSaleTransition}
        >
          Sale Transition
        </Button>
        <Button
          variant="primary"
          size="md"
          className="h-10 min-w-0 w-full px-2 text-xs sm:text-sm"
          onClick={onPrint}
        >
          Print
        </Button>
      </div>
    </div>
  );
}
