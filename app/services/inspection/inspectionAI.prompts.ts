import { IInspectionDocument } from '@interfaces/inspection.interface';

const RISK_FLAG_TYPES = [
  'photo_mismatch',
  'rating_inconsistency',
  'missing_documentation',
  'damage_detected',
  'dispute_risk',
].join(', ');

export function buildAnalysisUserPrompt(
  inspection: IInspectionDocument,
  type: 'submission' | 'dispute'
): string {
  const roomDescriptions = inspection.rooms
    .map((room) => {
      const items = room.items
        .map((i) => `  - ${i.name}: ${i.condition}${i.notes ? ` (note: "${i.notes}")` : ''}`)
        .join('\n');
      return `Room: ${room.name}
Overall condition: ${room.condition}
Notes: ${room.notes?.text || 'None'}
Items:
${items}
Photos attached: ${room.media?.length || 0}`;
    })
    .join('\n\n');

  const base = `<inspection_data>
Property inspection #${inspection.iuid}
Type: ${inspection.type.replace('_', '-')}
Overall condition: ${inspection.overallCondition || 'Not rated'}
Overall notes: ${inspection.overallNotes?.text || 'None'}

${roomDescriptions}
</inspection_data>`;

  if (type === 'dispute' && inspection.disputeNotes?.text) {
    return `${base}

<tenant_dispute>
The tenant has disputed this inspection with the following notes:
"${inspection.disputeNotes.text}"
</tenant_dispute>

Analyze both the inspection findings and the tenant's dispute. Flag any legitimate concerns from either side.`;
  }

  return base;
}

export function buildAnalysisSystemPrompt(): string {
  return `You are a property inspection analyst for a property management company.
You analyze inspection reports — room-by-room condition ratings, photos, and notes — to:
1. Validate that photos match the described room
2. Detect visible damage in photos
3. Check if condition ratings are consistent with photos and notes
4. Assess if notes are detailed enough for legal/deposit purposes
5. Flag any risk areas that could lead to disputes

Respond ONLY with valid JSON matching this schema:
{
  "overallSummary": "2-3 sentence assessment of the inspection",
  "riskFlags": [
    {
      "type": "<one of: ${RISK_FLAG_TYPES}>",
      "severity": "<low|medium|high>",
      "roomName": "which room",
      "description": "specific, actionable finding"
    }
  ]
}

Only flag genuine concerns — avoid false positives. If no issues found, return an empty riskFlags array.`;
}

export function buildComparisonPrompt(moveInRooms: string, moveOutRooms: string): string {
  return `Compare these move-in and move-out inspection results for the same unit.
Identify any NEW damage that appeared between move-in and move-out.
Do NOT flag pre-existing conditions documented at move-in.

<move_in_inspection>
${moveInRooms}
</move_in_inspection>

<move_out_inspection>
${moveOutRooms}
</move_out_inspection>

For each new damage found, add a riskFlag with type "damage_detected" and include "new since move-in" in the description.`;
}
