import type { Timestamp } from 'firebase/firestore';

import type { Uid } from './shared.model';

export type AllocationMode = 'manual' | 'auto';
export type SettlementStatus = 'active' | 'voided';

// A qué deuda puntual aplica una porción del abono — ver DATABASE.md,
// "Balance de grupo y abonos". Identidad de la deuda: movementId +
// debtorUid + installmentIndex (null si el gasto no es a cuotas).
export interface SettlementAllocation {
  movementId: string;
  debtorUid: Uid;
  installmentIndex: number | null;
  amount: number;
}

export interface Settlement {
  groupId: string;
  fromUid: Uid;
  toUid: Uid;
  amount: number;
  date: Timestamp;
  note: string;
  // Presente solo si, al registrar el settlement, también se creó un
  // movement personal equivalente (checkbox opcional en el formulario).
  linkedMovementId: string | null;
  // A qué deuda(s) puntuales aplica este abono, y cuánto a cada una — la
  // suma siempre es igual a `amount`. Ausente == abono "legacy" (de antes
  // de este campo): se auto-asigna a las deudas más antiguas de su misma
  // dirección (fromUid -> toUid) al momento de leer (ver
  // core/debts/debts.ts, computeDebts) — nunca se migra ni se reescribe.
  allocations?: SettlementAllocation[];
  // 'manual': quien pagó/registró eligió a mano qué deuda(s) cubre (p. ej.
  // "marcar esta cuota como pagada"). 'auto': se repartió solo a las
  // deudas más antiguas de la pareja (p. ej. "marcar como saldada").
  // Ausente == legacy, igual que `allocations`.
  allocationMode?: AllocationMode;
  // Quien registró el abono (fromUid o toUid — cualquiera de los dos
  // puede hacerlo). Ausente solo en abonos de antes de este campo.
  createdBy?: Uid;
  createdAt?: Timestamp;
  // 'active' (default, ausente) o 'voided' — un abono nunca se edita ni se
  // borra, se anula. El cálculo (computeDebts) ignora los voided. La UI
  // para anular llega en una fase posterior; este campo ya queda listo.
  status?: SettlementStatus;
  voidedBy?: Uid | null;
  voidedAt?: Timestamp | null;
  voidReason?: string | null;
  // Un solo comprobante por abono (foto o PDF) — misma convención que
  // movements/goalEntries. Path fijo "settlements/{id}/attachment", sin
  // extensión (el tipo real vive en attachmentContentType). Ambos campos
  // van de la mano: o los dos están presentes, o ninguno. Mientras el
  // abono esté activo, solo fromUid/toUid pueden subir/reemplazar/
  // eliminarlo; anulado, queda de solo lectura (ver firestore.rules).
  attachmentPath?: string | null;
  attachmentContentType?: string | null;
}
