import type { AssetEnquiryReport } from '@/api/enquiryApi';
import { Button } from '@/components/ui/button';

function ReportRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(140px,200px)_1fr] items-center gap-3 py-1.5">
      <span className="text-sm font-bold text-slate-900">{label}</span>
      <div className="min-h-8 rounded border border-[#9e9e9e] bg-white px-3 py-1.5 text-center text-sm text-slate-800">
        {value || '—'}
      </div>
    </div>
  );
}

export function AssetEnquiryReportPanel({
  report,
}: {
  report: AssetEnquiryReport;
}) {
  const isSold = report.status === 'sold';
  const isClear = report.status === 'clear';
  const isEncumbered = report.status === 'encumbered';

  const statusLabel = isSold
    ? 'Status - Sold'
    : isClear
      ? 'Asset Status - Clear'
      : 'Asset Status - Encumbered';

  const statusClass = isSold
    ? 'bg-[#c62828]'
    : isClear
      ? 'bg-[#2e7d32]'
      : 'bg-[#c62828]';

  const handlePrint = () => {
    window.print();
  };

  const title = report.is_land ? 'Stand/Plot/Land Report' : 'Asset Report';

  return (
    <div className="mx-auto max-w-xl overflow-hidden rounded border border-[#8f8f8f] bg-white print:border-black">
      <div className="bg-[#0d47a1] px-4 py-3 text-center text-[15px] font-semibold uppercase tracking-wide text-white print:bg-black">
        {title}
      </div>

      <div className="space-y-1 px-4 py-3">
        {report.is_land ? (
          <>
            <ReportRow label="Asset Description" value={report.asset_description} />
            <ReportRow label="Area / Development" value={report.area_development || ''} />
            <ReportRow label="Stand Number" value={report.stand_number || report.reg_number_serial} />
            <ReportRow label="Stand Size" value={report.stand_size || ''} />
            <ReportRow label="City/Town" value={report.city_town || ''} />
          </>
        ) : (
          <>
            <ReportRow label="Asset Description" value={report.asset_description} />
            <ReportRow
              label="Reg. Number/Serial Number"
              value={report.reg_number_serial}
            />
            <ReportRow label="Chassis Number" value={report.chassis_number} />
            <ReportRow label="Engine Number" value={report.engine_number} />
          </>
        )}
        <ReportRow
          label={
            report.source === 'hire_purchase' ||
            report.encumbrance_kind === 'hire_purchase'
              ? 'Purchaser'
              : 'Owner'
          }
          value={report.owner_masked}
        />
        <ReportRow label="ID / Reg. No." value={report.id_reg_masked} />
      </div>

      <div
        className={`${statusClass} px-4 py-2.5 text-center text-sm font-semibold text-white`}
      >
        {statusLabel}
      </div>

      {isSold ? (
        <div className="space-y-1 px-4 py-3">
          <ReportRow label="Purchaser" value={report.purchaser_masked || ''} />
          <ReportRow
            label="ID / Reg. No."
            value={report.purchaser_id_reg_masked || ''}
          />
          {report.sale_date ? (
            <ReportRow label="Date of Sale" value={report.sale_date} />
          ) : null}
        </div>
      ) : null}

      {isEncumbered ? (
        <div className="space-y-1 px-4 py-3">
          {report.encumbrance_details ? (
            <ReportRow
              label="Encumbrance Details"
              value={report.encumbrance_details}
            />
          ) : null}
          {report.encumbrance_kind === 'hire_purchase' && report.financier ? (
            <ReportRow label="Financier" value={report.financier} />
          ) : null}
          {report.encumbrance_kind === 'hire_purchase' &&
          report.purchase_amount ? (
            <ReportRow label="Purchase Amount" value={report.purchase_amount} />
          ) : null}
          {report.encumbrance_kind === 'collateral' && report.loan_amount ? (
            <ReportRow label="Loan Amount" value={report.loan_amount} />
          ) : null}
          {report.encumbrance_kind === 'custody' ? (
            <>
              <ReportRow
                label="Custodian Name"
                value={report.custodian_name_masked || ''}
              />
              <ReportRow
                label="Custodian ID/Reg. No"
                value={report.custodian_id_reg_masked || ''}
              />
            </>
          ) : null}
          {report.expected_encumbrance_end ? (
            <ReportRow
              label="Expected Encumbrance End"
              value={report.expected_encumbrance_end}
            />
          ) : null}
        </div>
      ) : null}

      <div className="flex justify-center px-4 py-4 print:hidden">
        <Button variant="secondary" onClick={handlePrint}>
          Print
        </Button>
      </div>
    </div>
  );
}
