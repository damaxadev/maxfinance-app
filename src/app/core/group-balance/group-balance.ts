import type { Settlement } from '../../models/settlement.model';
import { computeDebts, type MovementWithId } from '../debts/debts';

export interface GroupDebtEdge {
  /** Quién debe. */
  fromUid: string;
  /** Quién recibe. */
  toUid: string;
  amount: number;
}

/**
 * Función pura: a partir de los movements compartidos de un grupo y sus
 * settlements (abonos), suma cuánto debe cada DIRECCIÓN (de quién, a
 * quién) — una línea por dirección, nunca una por pareja. Ver DATABASE.md,
 * "Balance de grupo y abonos".
 *
 * Decisión de producto: las deudas NUNCA se cruzan, ni siquiera dentro de
 * la misma pareja. Si X le debe 30 a Y y Y le debe 30 a X, salen DOS
 * líneas de 30 — nunca se simplifican a cero. Cada línea es, sencillamente,
 * la suma del `remaining` de todas las deudas de esa dirección (ver
 * core/debts/debts.ts, computeDebts) — sin restar nunca la dirección
 * contraria.
 */
export function calculateGroupBalance(movements: MovementWithId[], settlements: Settlement[]): GroupDebtEdge[] {
  // owed.get(deudor).get(acreedor) = centavos que esa dirección debe en total.
  const owed = new Map<string, Map<string, number>>();
  const addOwed = (debtor: string, creditor: string, cents: number): void => {
    if (debtor === creditor) {
      return;
    }
    let row = owed.get(debtor);
    if (!row) {
      row = new Map<string, number>();
      owed.set(debtor, row);
    }
    row.set(creditor, (row.get(creditor) ?? 0) + cents);
  };

  for (const debt of computeDebts(movements, settlements)) {
    if (debt.remaining > 0) {
      addOwed(debt.debtorUid, debt.creditorUid, Math.round(debt.remaining * 100));
    }
  }

  const edges: GroupDebtEdge[] = [];
  for (const [debtor, row] of owed) {
    for (const [creditor, cents] of row) {
      edges.push({ fromUid: debtor, toUid: creditor, amount: cents / 100 });
    }
  }

  return edges;
}
