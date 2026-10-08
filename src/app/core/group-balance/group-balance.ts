import type { SharedMovement } from '../../models/movement.model';
import type { Settlement } from '../../models/settlement.model';

export interface GroupDebtEdge {
  /** Quién debe. */
  fromUid: string;
  /** Quién recibe. */
  toUid: string;
  amount: number;
}

// Todo se calcula en centavos enteros: sumar y restar montos en coma
// flotante deja residuos (0.1 + 0.2 !== 0.3) que aparecerían como deudas
// fantasma. El redondeo a centavos ocurre una sola vez, al convertir.
function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * Función pura: a partir de los movements compartidos de un grupo y sus
 * settlements, calcula cuánto debe cada pareja de personas — una línea por
 * pareja, sin simplificar contra terceros. Ver DATABASE.md, "Balance de
 * grupo (calculado, no almacenado)".
 *
 * Cada split que no es de quien pagó es una deuda de esa persona hacia
 * quien pagó (cada gasto solo genera deuda entre sus propios participantes).
 * Cada settlement reduce SOLO la deuda de su pareja (fromUid → toUid). Dentro
 * de una pareja sí se netean las deudas en ambos sentidos; entre parejas
 * distintas nunca.
 *
 * No lee ni escribe splits[].settled: ese campo no participa del cálculo,
 * el balance sale enteramente de movements (splits) menos settlements.
 */
export function calculateGroupBalance(movements: SharedMovement[], settlements: Settlement[]): GroupDebtEdge[] {
  // owed.get(deudor).get(acreedor) = centavos que el deudor le debe al
  // acreedor, SIN restar todavía lo que el acreedor le debe a él.
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
  const owedBy = (debtor: string, creditor: string): number => owed.get(debtor)?.get(creditor) ?? 0;

  for (const movement of movements) {
    for (const split of movement.splits) {
      addOwed(split.uid, movement.paidBy, toCents(split.amount));
    }
  }

  // Un settlement de X a Y reduce lo que X le debe a Y. Si no había deuda,
  // queda en negativo: Y pasa a deberle a X (mismo comportamiento de siempre).
  for (const settlement of settlements) {
    addOwed(settlement.fromUid, settlement.toUid, -toCents(settlement.amount));
  }

  const edges: GroupDebtEdge[] = [];
  const visitedPairs = new Set<string>();

  for (const [debtor, row] of owed) {
    for (const creditor of row.keys()) {
      const pairKey = [debtor, creditor].sort().join('|');
      if (visitedPairs.has(pairKey)) {
        continue;
      }
      visitedPairs.add(pairKey);

      const net = owedBy(debtor, creditor) - owedBy(creditor, debtor);
      if (net > 0) {
        edges.push({ fromUid: debtor, toUid: creditor, amount: net / 100 });
      } else if (net < 0) {
        edges.push({ fromUid: creditor, toUid: debtor, amount: -net / 100 });
      }
    }
  }

  return edges;
}

/**
 * ¿Se puede editar/eliminar este gasto compartido? No, si ya existe un
 * settlement del mismo grupo, con fecha igual o posterior a la del gasto,
 * entre cualquier par de personas involucradas en él (paidBy o algún split)
 * — o si ya se pagó al menos una cuota de su plan (ver más abajo).
 *
 * El modelo no guarda un vínculo directo entre un settlement "de saldar
 * todo" y los movements que cubrió (ver calculateGroupBalance: el balance
 * es puramente aditivo, sin ese rastro) — ese heurístico de fecha es el
 * chequeo más fiel posible para ESE caso: un settlement anterior al gasto
 * no pudo haber "asumido" su monto; uno posterior, sí.
 *
 * Pagar una cuota es distinto: sí se sabe con certeza a qué movimiento
 * pertenece (payInstallment() marca installments[i].status='paid' en la
 * MISMA transacción que crea el settlement — ver functions/src/index.ts),
 * así que para cuotas no hace falta adivinar por fecha. Importante, porque
 * el heurístico de fecha puede fallar en este caso puntual: si el gasto se
 * crea con una fecha elegida a mano posterior al momento real en que se
 * paga la primera cuota, "settlement.date >= movement.date" da falso
 * aunque la cuota sí se haya pagado de verdad.
 */
export function isSharedMovementLocked(movement: SharedMovement, settlements: Settlement[]): boolean {
  if (movement.installments?.some((installment) => installment.status === 'paid')) {
    return true;
  }

  const involvedUids = new Set([movement.paidBy, ...movement.splits.map((split) => split.uid)]);
  return settlements.some(
    (settlement) =>
      settlement.date.toMillis() >= movement.date.toMillis() &&
      (involvedUids.has(settlement.fromUid) || involvedUids.has(settlement.toUid))
  );
}
