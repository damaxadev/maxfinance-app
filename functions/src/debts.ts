// Mismo algoritmo que core/debts/debts.ts (computeDebts) del lado del
// cliente, PORTADO a mano a este archivo — Cloud Functions es un paquete
// de TypeScript separado del de Angular, sin import compartido posible
// (mismo motivo que WORKER_URL/los *_CHANNEL_ID en index.ts: si cambia la
// lógica de uno, hay que replicarla en el otro). Ver DATABASE.md, "Balance
// de grupo y abonos".
//
// Sin ningún import de firebase-admin/firebase-functions a propósito: así
// este archivo es, igual que su contraparte del cliente, una función pura
// sin dependencias de runtime — eso es lo que permite probar los dos lado
// a lado con los mismos fixtures en un solo test (ver
// src/app/core/debts/debts-functions-parity.spec.ts, en el proyecto de
// Angular). `TimestampLike` reemplaza al tipo real `Timestamp` del Admin
// SDK por su único método usado acá — cualquier Timestamp (cliente o
// admin) lo satisface sin necesitar el import.
export interface TimestampLike {
  toMillis(): number;
}

export interface InstallmentData {
  dueDate: TimestampLike;
  amount: number;
  status: string;
}

export interface MovementSplitData {
  uid: string;
  amount: number;
}

export interface MovementDocForDebts {
  id: string;
  date: TimestampLike;
  paidBy: string;
  splits: MovementSplitData[];
  installments?: InstallmentData[] | null;
}

export interface SettlementAllocationData {
  movementId: string;
  debtorUid: string;
  installmentIndex: number | null;
  amount: number;
}

export interface SettlementDocForDebts {
  fromUid: string;
  toUid: string;
  amount: number;
  date: TimestampLike;
  allocations?: SettlementAllocationData[];
  status?: string;
}

export interface DebtResult {
  movementId: string;
  debtorUid: string;
  creditorUid: string;
  installmentIndex: number | null;
  remaining: number;
}

function toDebtCents(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * Núcleo compartido: TODAS las deudas del grupo (de cualquier pareja), con
 * su `remaining` ya resuelto contra los abonos — mismo criterio que
 * computeDebts() del cliente (ignora `status: 'voided'`; aplica primero
 * las allocations explícitas, después las legacy —sin allocations—, del
 * abono más viejo al más nuevo, auto-asignadas a la deuda más antigua de
 * su misma dirección). `remainingForDebt()` y `cuotaDebtsForPair()` son
 * las dos únicas formas en que el resto del código lee este resultado —
 * ninguna otra función debería reimplementar este bucle.
 */
function computeAllDebts(movements: MovementDocForDebts[], settlements: SettlementDocForDebts[]): DebtResult[] {
  interface RawDebt {
    movementId: string;
    debtorUid: string;
    creditorUid: string;
    installmentIndex: number | null;
    totalCents: number;
    paidCents: number;
    orderKey: number;
  }

  const raw: RawDebt[] = [];
  for (const movement of movements) {
    if (movement.installments?.length) {
      const debtorUid = movement.splits.find((split) => split.uid !== movement.paidBy)?.uid;
      if (!debtorUid) {
        continue;
      }
      movement.installments.forEach((installment, index) => {
        raw.push({
          movementId: movement.id,
          debtorUid,
          creditorUid: movement.paidBy,
          installmentIndex: index,
          totalCents: toDebtCents(installment.amount),
          paidCents: 0,
          orderKey: installment.dueDate.toMillis(),
        });
      });
      continue;
    }
    for (const split of movement.splits) {
      if (split.uid === movement.paidBy) {
        continue;
      }
      raw.push({
        movementId: movement.id,
        debtorUid: split.uid,
        creditorUid: movement.paidBy,
        installmentIndex: null,
        totalCents: toDebtCents(split.amount),
        paidCents: 0,
        orderKey: movement.date.toMillis(),
      });
    }
  }
  raw.sort((a, b) => a.orderKey - b.orderKey);

  const byKey = new Map(
    raw.map((debt) => [`${debt.movementId}::${debt.debtorUid}::${debt.installmentIndex ?? '-'}`, debt])
  );
  const active = settlements.filter((settlement) => settlement.status !== 'voided');

  for (const settlement of active) {
    if (!settlement.allocations?.length) {
      continue;
    }
    for (const allocation of settlement.allocations) {
      const debt = byKey.get(`${allocation.movementId}::${allocation.debtorUid}::${allocation.installmentIndex ?? '-'}`);
      if (debt) {
        debt.paidCents += toDebtCents(allocation.amount);
      }
    }
  }

  const legacy = active
    .filter((settlement) => !settlement.allocations?.length)
    .sort((a, b) => a.date.toMillis() - b.date.toMillis());

  for (const settlement of legacy) {
    let remainingCents = toDebtCents(settlement.amount);
    if (remainingCents <= 0) {
      continue;
    }
    for (const debt of raw) {
      if (remainingCents <= 0) {
        break;
      }
      if (debt.debtorUid !== settlement.fromUid || debt.creditorUid !== settlement.toUid) {
        continue;
      }
      const debtRemaining = debt.totalCents - debt.paidCents;
      if (debtRemaining <= 0) {
        continue;
      }
      const applied = Math.min(debtRemaining, remainingCents);
      debt.paidCents += applied;
      remainingCents -= applied;
    }
  }

  return raw.map((debt) => ({
    movementId: debt.movementId,
    debtorUid: debt.debtorUid,
    creditorUid: debt.creditorUid,
    installmentIndex: debt.installmentIndex,
    remaining: (debt.totalCents - Math.min(debt.paidCents, debt.totalCents)) / 100,
  }));
}

/**
 * El `remaining` real de UNA deuda puntual (movementId + debtorUid +
 * installmentIndex). Usada por `payInstallment` para validar que la cuota
 * todavía tiene saldo pendiente antes de pagarla. `installmentIndex: null`
 * identifica la deuda de un gasto SIN cuotas (payInstallment nunca pasa
 * null — siempre paga una cuota puntual — pero la función soporta el caso
 * general para poder compararse 1:1 contra computeDebts() del cliente,
 * ver debts-functions-parity.spec.ts).
 */
export function remainingForDebt(
  movements: MovementDocForDebts[],
  settlements: SettlementDocForDebts[],
  targetMovementId: string,
  targetDebtorUid: string,
  targetInstallmentIndex: number | null
): number {
  const target = computeAllDebts(movements, settlements).find(
    (debt) =>
      debt.movementId === targetMovementId &&
      debt.debtorUid === targetDebtorUid &&
      debt.installmentIndex === targetInstallmentIndex
  );
  return target?.remaining ?? 0;
}

/**
 * Todas las deudas DE CUOTA (installmentIndex != null) en la dirección
 * fromUid -> toUid. Usada por `syncInstallmentStatus` para saber qué
 * cuotas de ESA pareja hay que revisar tras crear, anular o re-activar un
 * abono — no solo las que el abono referenció directo: un abono legacy
 * (sin allocations) se auto-asigna a la deuda más antigua de la pareja, así
 * que anular/crear uno puede desplazar a cuál cuota le "tocó" el pago, sin
 * que esa cuota aparezca en ninguna allocation.
 */
export function cuotaDebtsForPair(
  movements: MovementDocForDebts[],
  settlements: SettlementDocForDebts[],
  fromUid: string,
  toUid: string
): DebtResult[] {
  return computeAllDebts(movements, settlements).filter(
    (debt) => debt.installmentIndex !== null && debt.debtorUid === fromUid && debt.creditorUid === toUid
  );
}
