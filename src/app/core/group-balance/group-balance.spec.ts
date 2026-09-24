import type { SharedMovement } from '../../models/movement.model';
import type { Settlement } from '../../models/settlement.model';
import { calculateGroupBalance } from './group-balance';

const FAKE_DATE = {} as never;

function movement(paidBy: string, amount: number, splits: [string, number][]): SharedMovement {
  return {
    uid: paidBy,
    categoryId: 'cat1',
    type: 'expense',
    amount,
    date: FAKE_DATE,
    note: '',
    groupId: 'group1',
    paidBy,
    splitType: 'equal',
    splits: splits.map(([uid, splitAmount]) => ({ uid, amount: splitAmount, settled: false })),
  };
}

function settlement(fromUid: string, toUid: string, amount: number): Settlement {
  return { groupId: 'group1', fromUid, toUid, amount, date: FAKE_DATE, note: '', linkedMovementId: null };
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
