import type { SharedMovement } from '../../models/movement.model';
import type { Settlement } from '../../models/settlement.model';
import { calculateGroupBalance, isSharedMovementLocked } from './group-balance';

const FAKE_DATE = {} as never;

function ts(date: string) {
  return { toDate: () => new Date(date), toMillis: () => new Date(date).getTime() } as never;
}

function movement(paidBy: string, amount: number, splits: [string, number][], date = FAKE_DATE): SharedMovement {
  return {
    uid: paidBy,
    categoryId: 'cat1',
    type: 'expense',
    amount,
    date,
    note: '',
    groupId: 'group1',
    paidBy,
    splitType: 'equal',
    splits: splits.map(([uid, splitAmount]) => ({ uid, amount: splitAmount, settled: false })),
  };
}

function settlement(fromUid: string, toUid: string, amount: number, date = FAKE_DATE): Settlement {
  return { groupId: 'group1', fromUid, toUid, amount, date, note: '', linkedMovementId: null };
}

describe('calculateGroupBalance', () => {
  it('returns no edges when there are no movements or settlements', () => {
    expect(calculateGroupBalance([], [])).toEqual([]);
  });

  it('returns a single edge for a simple two-way equal split', () => {
    // A paga 100, dividido igual entre A y B -> B le debe 50 a A.
    const movements = [movement('A', 100, [['A', 50], ['B', 50]])];

    expect(calculateGroupBalance(movements, [])).toEqual([{ fromUid: 'B', toUid: 'A', amount: 50 }]);
  });

  it('nets multiple movements between the same pair into a single edge', () => {
    // A paga 100 (B le debe 50) y luego B paga 30 dividido igual (A le debe 15) -> neto: B le debe 35 a A.
    const movements = [
      movement('A', 100, [['A', 50], ['B', 50]]),
      movement('B', 30, [['A', 15], ['B', 15]]),
    ];

    expect(calculateGroupBalance(movements, [])).toEqual([{ fromUid: 'B', toUid: 'A', amount: 35 }]);
  });

  it('a settlement fully cancels the debt it covers', () => {
    const movements = [movement('A', 100, [['A', 50], ['B', 50]])];
    const settlements = [settlement('B', 'A', 50)];

    expect(calculateGroupBalance(movements, settlements)).toEqual([]);
  });

  it('a partial settlement reduces the remaining edge amount', () => {
    const movements = [movement('A', 100, [['A', 50], ['B', 50]])];
    const settlements = [settlement('B', 'A', 20)];

    expect(calculateGroupBalance(movements, settlements)).toEqual([{ fromUid: 'B', toUid: 'A', amount: 30 }]);
  });

  it('simplifies a three-person chain down to a single transfer when it fully nets out', () => {
    // Movimiento 1: A paga 90, dividido entre A, B y C (30 c/u) -> B y C deben 30 c/u a A.
    // Movimiento 2: B paga 60, dividido entre A y B (30 c/u) -> A le debe 30 a B.
    // Neto: A = +60 -30 = +30; B = -30 +60 -30 = 0; C = -30.
    // Resultado esperado: un solo giro, C le debe 30 a A (B queda saldado).
    const movements = [
      movement('A', 90, [['A', 30], ['B', 30], ['C', 30]]),
      movement('B', 60, [['A', 30], ['B', 30]]),
    ];

    expect(calculateGroupBalance(movements, [])).toEqual([{ fromUid: 'C', toUid: 'A', amount: 30 }]);
  });

  it('matches multiple debtors against multiple creditors with the minimum number of transfers', () => {
    // Se construye a propósito para que los netos finales sean exactamente
    // A=-100, B=-50, C=+120, D=+30 (suma = 0):
    //   Mov 1: C paga 150, dividido [A:100, C:50] -> A=-100, C=+100.
    //   Mov 2: C paga 50, dividido [B:50]          -> B=-50,  C=+150.
    //   Mov 3: D paga 30, dividido [C:30]          -> C=+120, D=+30.
    const movements = [
      movement('C', 150, [['A', 100], ['C', 50]]),
      movement('C', 50, [['B', 50]]),
      movement('D', 30, [['C', 30]]),
    ];

    const edges = calculateGroupBalance(movements, []);
    const totalOut = new Map<string, number>();
    const totalIn = new Map<string, number>();
    for (const edge of edges) {
      totalOut.set(edge.fromUid, (totalOut.get(edge.fromUid) ?? 0) + edge.amount);
      totalIn.set(edge.toUid, (totalIn.get(edge.toUid) ?? 0) + edge.amount);
    }

    // A y B solo pagan (nunca reciben); en total pagan exactamente lo que debían.
    expect(totalOut.get('A')).toBe(100);
    expect(totalOut.get('B')).toBe(50);
    expect(totalIn.has('A')).toBe(false);
    expect(totalIn.has('B')).toBe(false);
    // C y D solo reciben, nunca pagan.
    expect(totalOut.has('C')).toBe(false);
    expect(totalOut.has('D')).toBe(false);
    // Nunca más transferencias que deudores + acreedores - 1 (2 deudores, 2 acreedores).
    expect(edges.length).toBeLessThanOrEqual(3);
  });

  it('rounds away floating-point noise from uneven percentage splits', () => {
    // 100 dividido en 3 partes "iguales" con redondeo: 33.33 + 33.33 + 33.34.
    const movements = [movement('A', 100, [['A', 33.33], ['B', 33.33], ['C', 33.34]])];

    const edges = calculateGroupBalance(movements, []);

    expect(edges).toEqual(
      expect.arrayContaining([
        { fromUid: 'B', toUid: 'A', amount: 33.33 },
        { fromUid: 'C', toUid: 'A', amount: 33.34 },
      ])
    );
    expect(edges.length).toBe(2);
  });

  it('never returns a self-edge (the payer owing themselves)', () => {
    const movements = [movement('A', 60, [['A', 60]])]; // A paga y se lo queda todo para sí mismo

    expect(calculateGroupBalance(movements, [])).toEqual([]);
  });
});

describe('isSharedMovementLocked', () => {
  it('false with no settlements at all', () => {
    const m = movement('A', 100, [['A', 50], ['B', 50]], ts('2026-02-10'));

    expect(isSharedMovementLocked(m, [])).toBe(false);
  });

  it('false when every settlement predates the movement (could not have assumed its current amount)', () => {
    const m = movement('A', 100, [['A', 50], ['B', 50]], ts('2026-02-10'));
    const s = settlement('B', 'A', 50, ts('2026-02-05'));

    expect(isSharedMovementLocked(m, [s])).toBe(false);
  });

  it('true when a settlement on the same date involves the payer', () => {
    const m = movement('A', 100, [['A', 50], ['B', 50]], ts('2026-02-10'));
    const s = settlement('B', 'A', 50, ts('2026-02-10'));

    expect(isSharedMovementLocked(m, [s])).toBe(true);
  });

  it('true when a later settlement involves someone from the splits, even if not the payer', () => {
    const m = movement('A', 100, [['A', 50], ['B', 50]], ts('2026-02-10'));
    // Settlement entre B y un tercero C, nada que ver con A — pero B sí
    // participaba en el gasto, así que su balance ya pudo haber cambiado.
    const s = settlement('B', 'C', 20, ts('2026-02-15'));

    expect(isSharedMovementLocked(m, [s])).toBe(true);
  });

  it('false when a later settlement involves none of the people in the movement', () => {
    const m = movement('A', 100, [['A', 50], ['B', 50]], ts('2026-02-10'));
    const s = settlement('C', 'D', 20, ts('2026-02-15'));

    expect(isSharedMovementLocked(m, [s])).toBe(false);
  });

  // Regresión: pagar una cuota crea un settlement real, pero ese settlement
  // no referencia al movimiento de origen — el chequeo por fecha de arriba
  // puede fallar si el gasto se creó con una fecha elegida a mano posterior
  // al momento real en que se pagó la primera cuota (p. ej. "Hogar" creado
  // hoy con Fecha = 2 oct, cuota 1 pagada antes de esa fecha). Para cuotas,
  // installments[].status ya lo sabe con certeza — no hace falta la fecha.
  describe('con plan de cuotas (ver DATABASE.md, "Pagos a cuotas")', () => {
    function withInstallments(m: SharedMovement, installments: SharedMovement['installments']): SharedMovement {
      return { ...m, installments };
    }

    it('true as soon as one installment is "paid", with zero settlements at all', () => {
      const m = withInstallments(movement('A', 300, [['A', 150], ['B', 150]], ts('2026-02-10')), [
        { dueDate: ts('2026-02-10'), amount: 150, status: 'paid' },
        { dueDate: ts('2026-03-10'), amount: 150, status: 'pending' },
      ]);

      expect(isSharedMovementLocked(m, [])).toBe(true);
    });

    it('true even when the lone settlement predates the movement — exactly the regression repro', () => {
      // El gasto se "crea" (fecha elegida a mano) DESPUÉS del momento real
      // en que se pagó la cuota — el heurístico de fecha por sí solo diría
      // "no bloqueado", pero installments[].status='paid' no deja dudas.
      const m = withInstallments(movement('A', 1380000, [['A', 690000], ['B', 690000]], ts('2026-10-02')), [
        { dueDate: ts('2026-10-02'), amount: 460000, status: 'paid' },
        { dueDate: ts('2026-11-02'), amount: 460000, status: 'pending' },
        { dueDate: ts('2026-12-02'), amount: 460000, status: 'pending' },
      ]);
      const earlierSettlement = settlement('B', 'A', 460000, ts('2026-09-28'));

      expect(isSharedMovementLocked(m, [earlierSettlement])).toBe(true);
    });

    it('false while every installment is still "pending"', () => {
      const m = withInstallments(movement('A', 300, [['A', 150], ['B', 150]], ts('2026-02-10')), [
        { dueDate: ts('2026-02-10'), amount: 150, status: 'pending' },
        { dueDate: ts('2026-03-10'), amount: 150, status: 'pending' },
      ]);

      expect(isSharedMovementLocked(m, [])).toBe(false);
    });

    it('false for a movement with an empty or absent installments array (falls through to the date heuristic)', () => {
      const withEmpty = withInstallments(movement('A', 100, [['A', 50], ['B', 50]], ts('2026-02-10')), []);
      const withNull = withInstallments(movement('A', 100, [['A', 50], ['B', 50]], ts('2026-02-10')), null);

      expect(isSharedMovementLocked(withEmpty, [])).toBe(false);
      expect(isSharedMovementLocked(withNull, [])).toBe(false);
    });
  });
});
