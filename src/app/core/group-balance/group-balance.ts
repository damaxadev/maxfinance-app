import type { SharedMovement } from '../../models/movement.model';
import type { Settlement } from '../../models/settlement.model';

export interface GroupDebtEdge {
  /** Quién debe. */
  fromUid: string;
  /** Quién recibe. */
  toUid: string;
  amount: number;
}

// Diferencias menores a esto se tratan como cero — evita que residuos de
// coma flotante (splits porcentuales, por ejemplo) generen deudas fantasma
// de un centavo.
const EPSILON = 0.01;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Función pura: a partir de los movements compartidos de un grupo y sus
 * settlements, calcula el balance neto por persona y lo simplifica al
 * menor número de transferencias posible (algoritmo greedy: el mayor
 * deudor le paga al mayor acreedor, se repite hasta saldar a todos) — ver
 * DATABASE.md, "Balance de grupo (calculado, no almacenado)".
 *
 * No lee ni escribe splits[].settled: ese campo no participa del cálculo,
 * el balance sale enteramente de movements (splits) menos settlements.
 */
export function calculateGroupBalance(movements: SharedMovement[], settlements: Settlement[]): GroupDebtEdge[] {
  const net = new Map<string, number>();
  const add = (uid: string, delta: number): void => {
    net.set(uid, (net.get(uid) ?? 0) + delta);
  };

  for (const movement of movements) {
    add(movement.paidBy, movement.amount);
    for (const split of movement.splits) {
      add(split.uid, -split.amount);
    }
  }

  for (const settlement of settlements) {
    add(settlement.fromUid, settlement.amount);
    add(settlement.toUid, -settlement.amount);
  }

  const debtors: { uid: string; amount: number }[] = [];
  const creditors: { uid: string; amount: number }[] = [];

  for (const [uid, balance] of net) {
    if (balance < -EPSILON) {
      debtors.push({ uid, amount: -balance });
    } else if (balance > EPSILON) {
      creditors.push({ uid, amount: balance });
    }
  }

  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const edges: GroupDebtEdge[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    const settledAmount = Math.min(debtor.amount, creditor.amount);

    edges.push({ fromUid: debtor.uid, toUid: creditor.uid, amount: round2(settledAmount) });

    debtor.amount -= settledAmount;
    creditor.amount -= settledAmount;

    if (debtor.amount <= EPSILON) {
      i++;
    }
    if (creditor.amount <= EPSILON) {
      j++;
    }
  }

  return edges;
}
