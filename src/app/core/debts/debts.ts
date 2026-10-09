import type { Installment, SharedMovement } from '../../models/movement.model';
import type { Settlement } from '../../models/settlement.model';

// Todo se calcula en centavos enteros — ver group-balance.ts, mismo motivo
// (sumar/restar en coma flotante deja residuos que se verían como deudas
// fantasma de un centavo).
function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export type MovementWithId = SharedMovement & { id: string };

export type DebtStatus = 'pendiente' | 'parcial' | 'pagada';

/**
 * Una deuda derivada — nunca se guarda, se calcula desde movements +
 * settlements (ver DATABASE.md, "Balance de grupo y abonos"). Su
 * identidad es movementId + debtorUid + installmentIndex (null si el
 * gasto no es a cuotas): un gasto sin cuotas genera UNA deuda por cada
 * split distinto de quien pagó; un gasto a cuotas genera una deuda POR
 * CUOTA de su única deudora/deudor (las cuotas solo existen en grupos de
 * 2 miembros, ver DATABASE.md).
 */
export interface Debt {
  movementId: string;
  debtorUid: string;
  creditorUid: string;
  installmentIndex: number | null;
  total: number;
  paid: number;
  remaining: number;
  status: DebtStatus;
  // Sobrepago detectado en los datos (abonos que suman más que `total`) —
  // se clampea (remaining nunca negativo) y se deja la marca acá para que
  // la UI pueda señalarlo, sin romper la pantalla.
  anomaly: boolean;
}

interface RawDebt {
  movementId: string;
  debtorUid: string;
  creditorUid: string;
  installmentIndex: number | null;
  totalCents: number;
  paidCents: number;
  // Orden cronológico para "deuda más antigua primero": dueDate de la
  // cuota si aplica, si no la fecha del gasto. Nunca se expone en el
  // resultado público — Debt[] ya sale ordenado de más vieja a más nueva.
  orderKey: number;
}

function debtKey(movementId: string, debtorUid: string, installmentIndex: number | null): string {
  return `${movementId}::${debtorUid}::${installmentIndex ?? '-'}`;
}

function buildRawDebts(movements: MovementWithId[]): RawDebt[] {
  const debts: RawDebt[] = [];

  for (const movement of movements) {
    if (movement.installments?.length) {
      // El único split distinto de paidBy es la deudora/deudor — válido
      // porque las cuotas solo existen en grupos de 2 miembros (mismo
      // supuesto que GroupActivity.debtorUid()).
      const debtorUid = movement.splits.find((split) => split.uid !== movement.paidBy)?.uid;
      if (!debtorUid) {
        continue;
      }
      movement.installments.forEach((installment: Installment, index: number) => {
        debts.push({
          movementId: movement.id,
          debtorUid,
          creditorUid: movement.paidBy,
          installmentIndex: index,
          totalCents: toCents(installment.amount),
          paidCents: 0,
          orderKey: installment.dueDate.toMillis(),
        });
      });
      continue;
    }

    for (const split of movement.splits) {
      if (split.uid === movement.paidBy) {
        continue; // quien pagó no se debe nada a sí mismo.
      }
      debts.push({
        movementId: movement.id,
        debtorUid: split.uid,
        creditorUid: movement.paidBy,
        installmentIndex: null,
        totalCents: toCents(split.amount),
        paidCents: 0,
        orderKey: movement.date.toMillis(),
      });
    }
  }

  return debts.sort((a, b) => a.orderKey - b.orderKey);
}

/**
 * Función pura: deudas derivadas de los gastos compartidos de un grupo,
 * con su estado ya calculado a partir de los abonos (settlements) — ver
 * DATABASE.md, "Balance de grupo y abonos".
 *
 * Un abono con `allocations` reduce EXACTAMENTE las deudas que apunta,
 * sin importar el orden. Un abono sin `allocations` (legacy, de antes de
 * este campo) se auto-asigna a las deudas más antiguas de su misma
 * dirección (fromUid -> toUid) al momento de leer — nunca se migra ni se
 * reescribe en Firestore; si hay varios abonos legacy para la misma
 * pareja, se procesan del más viejo al más nuevo, para que un pago
 * anterior siempre consuma primero lo más antiguo.
 *
 * Ignora los abonos con status 'voided'. No lee installments[].status —
 * ese campo sigue existiendo para la UI/los avisos (ver DATABASE.md), pero
 * ya no es la fuente de verdad de si una cuota está pagada.
 */
export function computeDebts(movements: MovementWithId[], settlements: Settlement[]): Debt[] {
  const raw = buildRawDebts(movements);
  const byKey = new Map(raw.map((debt) => [debtKey(debt.movementId, debt.debtorUid, debt.installmentIndex), debt]));

  const active = settlements.filter((settlement) => settlement.status !== 'voided');

  // 1) Abonos con allocations explícitas — no importa el orden, cada uno
  // apunta a una deuda puntual.
  for (const settlement of active) {
    if (!settlement.allocations?.length) {
      continue;
    }
    for (const allocation of settlement.allocations) {
      const debt = byKey.get(debtKey(allocation.movementId, allocation.debtorUid, allocation.installmentIndex));
      if (!debt) {
        continue; // deuda de otro gasto/grupo ya borrado — se ignora, no rompe el cálculo.
      }
      debt.paidCents += toCents(allocation.amount);
    }
  }

  // 2) Abonos legacy (sin allocations), del más viejo al más nuevo.
  const legacy = active
    .filter((settlement) => !settlement.allocations?.length)
    .sort((a, b) => a.date.toMillis() - b.date.toMillis());

  for (const settlement of legacy) {
    let remainingCents = toCents(settlement.amount);
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
    // Si sobra remainingCents acá, el abono legacy es más grande que toda
    // la deuda conocida de esa pareja (dato inconsistente) — se pierde en
    // el reparto, no hay dónde más ponerlo; no afecta a remaining (nunca
    // queda negativo).
  }

  return raw.map((debt) => {
    const paidCents = Math.min(debt.paidCents, debt.totalCents);
    const remainingCents = debt.totalCents - paidCents;
    return {
      movementId: debt.movementId,
      debtorUid: debt.debtorUid,
      creditorUid: debt.creditorUid,
      installmentIndex: debt.installmentIndex,
      total: debt.totalCents / 100,
      paid: paidCents / 100,
      remaining: remainingCents / 100,
      status: remainingCents <= 0 ? 'pagada' : paidCents > 0 ? 'parcial' : 'pendiente',
      anomaly: debt.paidCents > debt.totalCents,
    };
  });
}

/**
 * Agrupa las deudas por gasto — "estado resumen por gasto (por deudor)",
 * para que la UI (prompt 2) pueda mostrar el estado de cada cuota/split de
 * un movimiento sin recorrer todo el resultado de computeDebts() a mano.
 */
export function debtsByMovement(movements: MovementWithId[], settlements: Settlement[]): Map<string, Debt[]> {
  const byMovement = new Map<string, Debt[]>();
  for (const debt of computeDebts(movements, settlements)) {
    const list = byMovement.get(debt.movementId) ?? [];
    list.push(debt);
    byMovement.set(debt.movementId, list);
  }
  return byMovement;
}

/**
 * ¿Alguna deuda de este gasto ya tiene algo abonado (paid > 0)? — con esto
 * se bloquea editar/borrar el gasto (ver DATABASE.md, "Balance de grupo y
 * abonos"). Reemplaza a isSharedMovementLocked() (heurístico por fecha) e
 * installments[].status como fuente: paid sale de computeDebts(), que ya
 * considera abonos activos, incluidos los legacy auto-asignados — así
 * desaparece la ventana en la que una cuota recién pagada por un camino
 * que no fuera payInstallment no bloqueaba el gasto.
 */
export function movementHasPayments(movementId: string, movements: MovementWithId[], settlements: Settlement[]): boolean {
  return computeDebts(movements, settlements).some((debt) => debt.movementId === movementId && debt.paid > 0);
}

/** Agrupa una lista de deudas (ya filtrada) por gasto, en el mismo orden
 * en que vinieron (computeDebts ya las entrega de más vieja a más nueva)
 * — para pintar un encabezado de gasto con sus cuotas agrupadas debajo
 * (ver GroupBalance, AbonoForm). */
export function groupDebtsByMovement(debts: Debt[]): { movementId: string; debts: Debt[] }[] {
  const order: string[] = [];
  const byMovement = new Map<string, Debt[]>();
  for (const debt of debts) {
    if (!byMovement.has(debt.movementId)) {
      order.push(debt.movementId);
      byMovement.set(debt.movementId, []);
    }
    byMovement.get(debt.movementId)!.push(debt);
  }
  return order.map((movementId) => ({ movementId, debts: byMovement.get(movementId)! }));
}

export interface AllocationPlan {
  movementId: string;
  debtorUid: string;
  installmentIndex: number | null;
  amount: number;
}

/**
 * Reparte `amount` entre las deudas de fromUid -> toUid, empezando por la
 * más antigua — usado por "Marcar como saldada" (ver SettlementsService.
 * createSettlement(), allocationMode 'auto'). Espera `debts` ya en el
 * orden que devuelve computeDebts() (de más vieja a más nueva); no lo
 * reordena.
 *
 * Nunca sobrepaga: si `amount` supera lo que fromUid le debe a toUid en
 * total, devuelve null — el caller decide cómo rechazarlo.
 */
export function autoAllocateOldestFirst(
  debts: Debt[],
  fromUid: string,
  toUid: string,
  amount: number
): AllocationPlan[] | null {
  let remainingCents = toCents(amount);
  if (remainingCents <= 0) {
    return [];
  }

  const candidates = debts.filter(
    (debt) => debt.debtorUid === fromUid && debt.creditorUid === toUid && debt.remaining > 0
  );
  const totalAvailableCents = candidates.reduce((sum, debt) => sum + toCents(debt.remaining), 0);
  if (remainingCents > totalAvailableCents) {
    return null;
  }

  const plan: AllocationPlan[] = [];
  for (const debt of candidates) {
    if (remainingCents <= 0) {
      break;
    }
    const debtRemainingCents = toCents(debt.remaining);
    const appliedCents = Math.min(debtRemainingCents, remainingCents);
    plan.push({
      movementId: debt.movementId,
      debtorUid: debt.debtorUid,
      installmentIndex: debt.installmentIndex,
      amount: appliedCents / 100,
    });
    remainingCents -= appliedCents;
  }

  return plan;
}
