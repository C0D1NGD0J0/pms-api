import {
  IInspectionDocument,
  IInspectionMedia,
  IInspectionRoom,
  IInspectionItem,
  ConditionRating,
  InspectionType,
} from '@interfaces/inspection.interface';

export interface InspectionReportData {
  refund?: {
    originalDeposit: number;
    deductions: number;
    refundAmount: number;
    currency: string;
    items: { description: string; amount: number }[];
  };
  company: {
    name: string;
    email?: string;
    phone?: string;
    website?: string;
    logo?: string;
  };
  inspection: IInspectionDocument;
  includePhotos: boolean;
  inspectorName: string;
  propertyName: string;
  unitNumber: string;
  tenantName: string;
}

export function buildInspectionReportHtml(data: InspectionReportData): string {
  const { inspection, company, includePhotos } = data;
  const isMoveOut = inspection.type === InspectionType.MOVE_OUT;
  const iuid = inspection.iuid;
  const typeLabel = formatInspectionType(inspection.type);
  const generatedDate = formatDate(new Date());

  const companyHeader = `
    <div class="report-header-right">
      ${company.logo ? `<img src="${escapeHtml(company.logo)}" alt="" style="max-height: 40px; margin-bottom: 4px;" />` : ''}
      <div class="company-name">${escapeHtml(company.name)}</div>
      ${company.email || company.phone ? `<p style="font-size: 11px; color: #666;">${[company.email, company.phone].filter(Boolean).join(' &bull; ')}</p>` : ''}
      ${company.website ? `<p style="font-size: 10px; color: #999;">${escapeHtml(company.website)}</p>` : ''}
    </div>`;

  const roomCards = (inspection.rooms || [])
    .map((room) => buildRoomCard(room, isMoveOut, includePhotos))
    .join('\n');

  const overallNotesHtml = inspection.overallNotes?.text
    ? `<div class="overall-box"><h3>Overall Notes</h3><p>${escapeHtml(inspection.overallNotes.text)}</p></div>`
    : '';

  const refundHtml = isMoveOut ? buildRefundSection(data.refund) : '';

  const tenantAckDate = inspection.tenantAcknowledgedAt
    ? formatDate(inspection.tenantAcknowledgedAt)
    : null;
  const signaturesHtml = `
  <div class="signatures">
    <div class="sig-block">
      <div class="sig-line"></div>
      <p>Inspector &mdash; ${escapeHtml(data.inspectorName)}</p>
      <p class="sig-status">Completed: ${formatDate(inspection.completedDate)}</p>
    </div>
    <div class="sig-block">
      <div class="sig-line"></div>
      <p>Tenant &mdash; ${escapeHtml(data.tenantName)}</p>
      <p class="sig-status ${tenantAckDate ? 'acknowledged' : 'pending'}">${tenantAckDate ? `Acknowledged: ${tenantAckDate}` : 'Pending acknowledgement'}</p>
    </div>
  </div>`;

  const photoAppendixHtml = includePhotos ? buildPhotoAppendix(inspection, iuid) : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${typeLabel} Inspection Report</title>
  <style>
    @page { size: Letter; margin: 0.75in; }
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Helvetica Neue', Arial, sans-serif;
      color: #333;
      line-height: 1.6;
      max-width: 8.5in;
      margin: 0 auto;
      padding: 0.75in;
      background: #fff;
    }

    .report-header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 16px; border-bottom: 3px solid #124e66; margin-bottom: 24px; }
    .report-header-left h1 { color: #124e66; font-size: 22px; margin-bottom: 4px; letter-spacing: -0.5px; }
    .report-header-left p { color: #666; font-size: 13px; }
    .report-header-right { text-align: right; }
    .company-name { color: #124e66; font-size: 14px; font-weight: 600; }

    .meta-grid { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 16px; margin-bottom: 28px; padding: 16px; background: #f8fafb; border-radius: 8px; border: 1px solid #e8eef1; }
    .meta-item .meta-label { color: #8a9ba8; text-transform: uppercase; font-size: 10px; font-weight: 700; letter-spacing: 0.8px; margin-bottom: 2px; }
    .meta-item .meta-value { color: #1a2b3c; font-size: 13px; font-weight: 500; }

    .section-title { color: #124e66; font-size: 16px; font-weight: 700; padding-bottom: 8px; border-bottom: 2px solid #e0e7ec; margin-bottom: 16px; margin-top: 28px; }

    .badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-weight: 600; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; }
    .badge-excellent { background: #e6f9e8; color: #00832d; }
    .badge-good { background: #e8f5e9; color: #2e7d32; }
    .badge-fair { background: #fff3e0; color: #e65100; }
    .badge-poor { background: #fce4ec; color: #c62828; }
    .badge-na { background: #f5f5f5; color: #9e9e9e; }

    .room-card { margin-bottom: 20px; page-break-inside: avoid; border: 1px solid #e8eef1; border-radius: 8px; overflow: hidden; }
    .room-header { display: flex; justify-content: space-between; align-items: center; padding: 10px 16px; background: #f0f5f8; border-bottom: 1px solid #e0e7ec; }
    .room-header h3 { color: #1a2b3c; font-size: 14px; font-weight: 700; }
    .room-body { padding: 12px 16px; }

    .items-table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    .items-table th { text-align: left; font-size: 11px; color: #8a9ba8; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; padding: 6px 0; border-bottom: 1px solid #e8eef1; }
    .items-table th:nth-child(2) { text-align: center; }
    .items-table td { padding: 8px 0; font-size: 12px; border-bottom: 1px solid #f0f3f5; }
    .items-table td:nth-child(2) { text-align: center; }
    .items-table td:nth-child(3) { color: #666; font-style: italic; font-size: 11px; }

    .room-notes { margin-top: 8px; padding: 8px 12px; background: #fafbfc; border-left: 3px solid #124e66; border-radius: 0 4px 4px 0; font-size: 12px; color: #555; }
    .room-notes strong { color: #333; font-size: 11px; text-transform: uppercase; letter-spacing: 0.3px; }

    .photo-count { display: inline-block; font-size: 10px; color: #8a9ba8; margin-top: 6px; }

    .damage-highlight { background: #fff5f5; }
    .damage-highlight td:first-child::before { content: "!"; display: inline-block; width: 14px; height: 14px; line-height: 14px; text-align: center; background: #c62828; color: white; border-radius: 50%; font-size: 9px; font-weight: 700; margin-right: 6px; }

    .overall-box { padding: 16px; background: #f0f8ff; border-radius: 8px; margin: 24px 0; border: 1px solid #d0e4f0; }
    .overall-box h3 { color: #124e66; font-size: 13px; font-weight: 700; margin-bottom: 6px; }
    .overall-box p { font-size: 13px; color: #444; }

    .refund-box { margin: 24px 0; padding: 16px; border-radius: 8px; border: 1px solid #ffc107; background: #fffdf0; }
    .refund-box h3 { color: #856404; font-size: 14px; font-weight: 700; margin-bottom: 10px; }
    .refund-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
    .refund-item .refund-label { color: #a08c3a; font-size: 10px; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px; }
    .refund-item .refund-value { font-size: 16px; font-weight: 700; color: #333; }
    .refund-item .refund-value.refunded { color: #2e7d32; }
    .refund-item .refund-value.deducted { color: #c62828; }
    .refund-breakdown { margin-top: 12px; padding-top: 10px; border-top: 1px solid #f0e6a0; font-size: 12px; color: #666; }
    .refund-breakdown table { width: 100%; border-collapse: collapse; }
    .refund-breakdown td { padding: 4px 0; font-size: 12px; }
    .refund-breakdown td:last-child { text-align: right; font-weight: 500; }

    .signatures { margin-top: 48px; padding-top: 16px; border-top: 1px solid #ddd; display: flex; justify-content: space-between; }
    .sig-block { width: 45%; }
    .sig-line { border-bottom: 1px solid #333; height: 40px; margin-bottom: 4px; }
    .sig-block p { font-size: 11px; color: #999; }
    .sig-status { font-size: 10px; margin-top: 4px; }
    .sig-status.acknowledged { color: #2e7d32; }
    .sig-status.pending { color: #e65100; }

    .report-footer { margin-top: 40px; padding-top: 12px; border-top: 1px solid #e0e7ec; text-align: center; font-size: 10px; color: #aaa; }

    .page-break { page-break-before: always; margin-top: 80px; padding-top: 40px; border-top: 3px double #ccc; }
    .appendix-header { color: #124e66; font-size: 18px; font-weight: 700; padding-bottom: 8px; border-bottom: 3px solid #124e66; margin-bottom: 24px; }
    .appendix-header span { font-size: 12px; font-weight: 400; color: #999; margin-left: 8px; }
    .appendix-room-title { color: #1a2b3c; font-size: 14px; font-weight: 700; margin: 20px 0 12px; padding-bottom: 6px; border-bottom: 1px solid #e0e7ec; }
    .appendix-photos { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
    .appendix-photo-item { page-break-inside: avoid; }
    .appendix-photo { width: 100%; height: 180px; object-fit: cover; border-radius: 6px; border: 1px solid #ddd; }
    .appendix-photo-caption { margin-top: 4px; font-size: 11px; color: #666; }
    .appendix-photo-caption strong { color: #333; }
    .appendix-photo-date { font-size: 10px; color: #aaa; }
  </style>
</head>
<body>

  <div class="report-header">
    <div class="report-header-left">
      <h1>${typeLabel} Inspection Report</h1>
      <p>${escapeHtml(data.propertyName)}, Unit ${escapeHtml(data.unitNumber)} &mdash; ${generatedDate}</p>
    </div>
    ${companyHeader}
  </div>

  <div class="meta-grid">
    <div class="meta-item"><div class="meta-label">Inspection ID</div><div class="meta-value">#INS-${escapeHtml(iuid)}</div></div>
    <div class="meta-item"><div class="meta-label">Type</div><div class="meta-value">${typeLabel}</div></div>
    <div class="meta-item"><div class="meta-label">Inspector</div><div class="meta-value">${escapeHtml(data.inspectorName)}</div></div>
    <div class="meta-item"><div class="meta-label">Tenant</div><div class="meta-value">${escapeHtml(data.tenantName)}</div></div>
    <div class="meta-item"><div class="meta-label">Scheduled</div><div class="meta-value">${formatDate(inspection.scheduledDate)}</div></div>
    <div class="meta-item"><div class="meta-label">Completed</div><div class="meta-value">${formatDate(inspection.completedDate)}</div></div>
    <div class="meta-item"><div class="meta-label">Overall Condition</div><div class="meta-value">${inspection.overallCondition ? `<span class="badge ${badgeClass(inspection.overallCondition)}">${inspection.overallCondition.toUpperCase()}</span>` : '&mdash;'}</div></div>
    <div class="meta-item"><div class="meta-label">Status</div><div class="meta-value" style="color: ${statusColor(inspection.status)}; font-weight: 600;">${inspection.status.toUpperCase()}</div></div>
  </div>

  <h2 class="section-title">Room-by-Room Assessment</h2>

  ${roomCards}

  ${overallNotesHtml}

  ${refundHtml}

  ${signaturesHtml}

  <div class="report-footer">
    This document is a record of the property condition at the time of inspection.
    <br>Report ID: #INS-${escapeHtml(iuid)} &bull; ${escapeHtml(company.name)} &bull; Generated: ${generatedDate}
  </div>

  ${photoAppendixHtml}

</body>
</html>`;
}

function buildPhotoAppendix(inspection: IInspectionDocument, iuid: string): string {
  const roomsWithPhotos = (inspection.rooms || []).filter((room) =>
    (room.media || []).some((m) => m.status === 'active')
  );
  const topLevelMedia = (inspection.media || []).filter((m) => m.status === 'active');

  const totalPhotos =
    roomsWithPhotos.reduce(
      (sum, r) => sum + r.media.filter((m) => m.status === 'active').length,
      0
    ) + topLevelMedia.length;

  if (totalPhotos === 0) return '';

  let html = `
  <div class="page-break"></div>
  <div class="appendix-header">
    Photo Appendix
    <span>#INS-${escapeHtml(iuid)} &bull; ${totalPhotos} photo${totalPhotos > 1 ? 's' : ''} total</span>
  </div>`;

  for (const room of roomsWithPhotos) {
    const activeMedia = room.media.filter((m) => m.status === 'active');
    html += `<div class="appendix-room-title">${escapeHtml(room.name)}</div>`;
    html += '<div class="appendix-photos">';
    for (const photo of activeMedia) {
      html += buildPhotoItem(photo);
    }
    html += '</div>';
  }

  if (topLevelMedia.length > 0) {
    html += '<div class="appendix-room-title">General</div>';
    html += '<div class="appendix-photos">';
    for (const photo of topLevelMedia) {
      html += buildPhotoItem(photo);
    }
    html += '</div>';
  }

  html += `
  <div class="report-footer" style="margin-top: 24px;">
    Photo Appendix &bull; Report #INS-${escapeHtml(iuid)}
  </div>`;

  return html;
}

function buildRefundSection(refund: InspectionReportData['refund']): string {
  if (!refund) return '';

  const { currency } = refund;
  const deductionRows = refund.items
    .map(
      (item) =>
        `<tr><td>${escapeHtml(item.description)}</td><td>${formatCurrency(item.amount, currency)}</td></tr>`
    )
    .join('\n');

  return `
  <div class="refund-box">
    <h3>Security Deposit Refund</h3>
    <div class="refund-grid">
      <div class="refund-item"><div class="refund-label">Original Deposit</div><div class="refund-value">${formatCurrency(refund.originalDeposit, currency)}</div></div>
      <div class="refund-item"><div class="refund-label">Deductions</div><div class="refund-value deducted">-${formatCurrency(refund.deductions, currency)}</div></div>
      <div class="refund-item"><div class="refund-label">Refund Amount</div><div class="refund-value refunded">${formatCurrency(refund.refundAmount, currency)}</div></div>
    </div>
    <div class="refund-breakdown">
      <table>
        ${deductionRows}
        <tr style="border-top: 1px solid #e0d68a; font-weight: 600;"><td>Total Deductions</td><td>${formatCurrency(refund.deductions, currency)}</td></tr>
      </table>
    </div>
  </div>`;
}

function buildRoomCard(room: IInspectionRoom, isMoveOut: boolean, includePhotos: boolean): string {
  const badge = `<span class="badge ${badgeClass(room.condition)}">${room.condition.toUpperCase()}</span>`;
  const items = (room.items || []).map((item) => buildItemRow(item, isMoveOut)).join('\n');

  const notesHtml = room.notes?.text
    ? `<div class="room-notes"><strong>Notes:</strong> ${escapeHtml(room.notes.text)}</div>`
    : '';

  const activeMedia = (room.media || []).filter((m) => m.status === 'active');
  const photoCount =
    includePhotos && activeMedia.length > 0
      ? `<div class="photo-count">${activeMedia.length} photo${activeMedia.length > 1 ? 's' : ''} &mdash; see appendix</div>`
      : '';

  return `
  <div class="room-card">
    <div class="room-header">
      <h3>${escapeHtml(room.name)}</h3>
      ${badge}
    </div>
    <div class="room-body">
      <table class="items-table">
        <thead><tr><th>Item</th><th>Condition</th><th>Notes</th></tr></thead>
        <tbody>${items}</tbody>
      </table>
      ${notesHtml}
      ${photoCount}
    </div>
  </div>`;
}

function buildPhotoItem(photo: IInspectionMedia): string {
  const caption = photo.description || photo.filename || 'Photo';
  const dateStr = formatDate(photo.uploadedAt);

  return `
    <div class="appendix-photo-item">
      <img class="appendix-photo" src="${escapeHtml(photo.url)}" alt="${escapeHtml(caption)}" />
      <div class="appendix-photo-caption"><strong>${escapeHtml(caption)}</strong></div>
      <div class="appendix-photo-date">Uploaded ${dateStr}</div>
    </div>`;
}

function buildItemRow(item: IInspectionItem, isMoveOut: boolean): string {
  const isPoor = item.condition === ConditionRating.POOR;
  const rowClass = isMoveOut && isPoor ? ' class="damage-highlight"' : '';
  const notes = item.notes ? escapeHtml(item.notes) : '&mdash;';
  const badge = `<span class="badge ${badgeClass(item.condition)}">${item.condition.toUpperCase()}</span>`;

  return `<tr${rowClass}><td>${escapeHtml(item.name)}</td><td>${badge}</td><td>${notes}</td></tr>`;
}

function badgeClass(condition: ConditionRating | string): string {
  switch (condition) {
    case ConditionRating.EXCELLENT:
      return 'badge-excellent';
    case ConditionRating.GOOD:
      return 'badge-good';
    case ConditionRating.FAIR:
      return 'badge-fair';
    case ConditionRating.POOR:
      return 'badge-poor';
    default:
      return 'badge-na';
  }
}

function formatInspectionType(type: InspectionType): string {
  switch (type) {
    case InspectionType.MOVE_OUT:
      return 'Move-Out';
    case InspectionType.MOVE_IN:
      return 'Move-In';
    case InspectionType.ROUTINE:
      return 'Routine';
    default:
      return String(type);
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'submitted':
      return '#1565c0';
    case 'approved':
      return '#2e7d32';
    case 'rejected':
      return '#c62828';
    case 'disputed':
      return '#e65100';
    default:
      return '#333';
  }
}

function formatDate(date: Date | string | undefined): string {
  if (!date) return '—';
  const d = new Date(date);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatCurrency(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount / 100);
}
