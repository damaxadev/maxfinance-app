import type { Timestamp } from 'firebase/firestore';

import type { Uid } from './shared.model';

// Ledger de una meta de ahorro (groups con type: 'savings') — totalmente
// aparte de movements/settlements: ningún aporte/retiro toca una cuenta
// personal ni genera un movement ahí (ver DATABASE.md, "Metas de ahorro").
export type GoalEntryType = 'contribution' | 'withdrawal';

export interface GoalEntry {
  groupId: string;
  uid: Uid;
  type: GoalEntryType;
  amount: number;
  date: Timestamp;
  note: string;
  // Un solo adjunto por entrada (comprobante de la transferencia, etc.) —
  // mismo criterio que BaseMovement en movement.model.ts: path fijo
  // "goalEntries/{id}/attachment", reemplazado al subir uno nuevo.
  attachmentPath?: string | null;
  attachmentContentType?: string | null;
}
