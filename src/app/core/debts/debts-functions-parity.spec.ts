// Prueba de paridad entre el cálculo de deuda del cliente (computeDebts(),
// este archivo) y su réplica server-side (remainingForDebt(), portada a
// mano en functions/src/debts.ts — ver el comentario ahí sobre por qué no
// se puede compartir código entre los dos proyectos de TypeScript).
//
// Corre los mismos fixtures por las dos implementaciones y exige que el
// `remaining` de CADA deuda coincida exacto. Cubre los escenarios de
// computeDebts()/calculateGroupBalance() (deudas simples, cuotas, abonos
// con allocations, legacy, legacy múltiple con desempate por fecha,
// voided, sobrepago/anomaly, el escenario Tatiana/Diego/Laura, redondeo).
// No cubre autoAllocateOldestFirst() ni los rechazos de createSettlement():
// esos son orquestación del lado del cliente (SettlementsService) sin
// contraparte en Cloud Functions, porque "Marcar como saldada" nunca corre
// server-side — no hay nada que comparar ahí.
import type { Installment } from '../../models/movement.model';
import type { Settlement } from '../../models/settlement.model';
// Ruta relativa a propósito, cruzando a otro proyecto de TypeScript (ver
// el comentario de cabecera de functions/src/debts.ts): no es un paquete
// de npm, es la réplica server-side de este mismo archivo.
import { remainingForDebt } from '../../../../functions/src/debts';
import { type MovementWithId, computeDebts } from './debts';

function ts(date: string) {
  return { toDate: () => new Date(date), toMillis: () => new Date(date).getTime() } as never;
}

let movementIdCounter = 0;

function movement(
  paidBy: string,
  amount: number,
  splits: [string, number][],
  opts: { date?: string; installments?: Installment[] } = {}
): MovementWithId {
  movementIdCounter += 1;
  return {
    id: `m${movementIdCounter}`,
    uid: paidBy,
    categoryId: 'cat1',
    type: 'expense',
    amount,
    date: ts(opts.date ?? '2026-01-01'),
    note: '',
    groupId: 'group1',
    paidBy,
    splitType: 'equal',
    splits: splits.map(([uid, splitAmount]) => ({ uid, amount: splitAmount, settled: false })),
    installments: opts.installments ?? null,
  };
}

function installment(amount: number, dueDate: string, status: 'pending' | 'paid' = 'pending'): Installment {
  return { amount, dueDate: ts(dueDate), status };
}

function manualSettlement(
  fromUid: string,
  toUid: string,
  allocations: Settlement['allocations'],
  opts: { date?: string; status?: Settlement['status'] } = {}
): Settlement {
  const amount = (allocations ?? []).reduce((sum, a) => sum + a.amount, 0);
  return {
    groupId: 'group1',
    fromUid,
    toUid,
    amount,
    date: ts(opts.date ?? '2026-02-01'),
    note: '',
    linkedMovementId: null,
    allocations,
    allocationMode: 'manual',
    status: opts.status,
  };
}

function legacySettlement(fromUid: string, toUid: string, amount: number, date: string): Settlement {
  return { groupId: 'group1', fromUid, toUid, amount, date: ts(date), note: '', linkedMovementId: null };
}

// Corre las dos implementaciones sobre los MISMOS fixtures y exige que
// coincidan exacto, deuda por deuda.
function expectParity(movements: MovementWithId[], settlements: Settlement[]): void {
  const debts = computeDebts(movements, settlements);
  expect(debts.length).toBeGreaterThan(0);

  for (const debt of debts) {
    const serverRemaining = remainingForDebt(movements, settlements, debt.movementId, debt.debtorUid, debt.installmentIndex);
    expect(serverRemaining).toBe(debt.remaining);
  }
}

describe('paridad cliente/servidor: computeDebts() vs remainingForDebt()', () => {
  it('deuda simple sin cuotas, sin abonos', () => {
    const mov = movement('tatiana', 100000, [['tatiana', 50000], ['diego', 50000]]);

    expectParity([mov], []);
  });

  it('80.000 repartidos entre A, B y una cuota C (allocations explícitas, modo "auto")', () => {
    const movA = movement('tatiana', 55400, [['tatiana', 0], ['diego', 55400]], { date: '2026-01-01' });
    const movB = movement('tatiana', 30000, [['tatiana', 0], ['diego', 30000]], { date: '2026-01-02' });
    const movC = movement('tatiana', 158001, [['tatiana', 0], ['diego', 158001]], {
      date: '2026-01-03',
      installments: [installment(52667, '2026-02-01'), installment(52667, '2026-03-01'), installment(52667, '2026-04-01')],
    });
    const abono = manualSettlement(
      'diego',
      'tatiana',
      [
        { movementId: movA.id, debtorUid: 'diego', installmentIndex: null, amount: 55400 },
        { movementId: movB.id, debtorUid: 'diego', installmentIndex: null, amount: 24600 },
      ],
      { date: '2026-02-15' }
    );

    expectParity([movA, movB, movC], [abono]);
  });

  it('abono parcial a una cuota puntual', () => {
    const mov = movement('tatiana', 100000, [['tatiana', 50000], ['diego', 50000]], {
      installments: [installment(50000, '2026-02-01'), installment(50000, '2026-03-01')],
    });
    const abono = manualSettlement('diego', 'tatiana', [
      { movementId: mov.id, debtorUid: 'diego', installmentIndex: 0, amount: 20000 },
    ]);

    expectParity([mov], [abono]);
  });

  it('deudas cruzadas: un abono a una de las dos deudas voltea el neto de la pareja', () => {
    const movA = movement('tatiana', 27700, [['tatiana', 0], ['diego', 27700]]);
    const movB = movement('diego', 15000, [['diego', 0], ['tatiana', 15000]]);
    const abono = manualSettlement('diego', 'tatiana', [
      { movementId: movA.id, debtorUid: 'diego', installmentIndex: null, amount: 20000 },
    ]);

    expectParity([movA, movB], [abono]);
  });

  it('un abono voided no cuenta (con allocations y legacy)', () => {
    const mov = movement('tatiana', 100000, [['tatiana', 50000], ['diego', 50000]]);
    const voidedManual = manualSettlement(
      'diego',
      'tatiana',
      [{ movementId: mov.id, debtorUid: 'diego', installmentIndex: null, amount: 50000 }],
      { status: 'voided' }
    );
    const voidedLegacy: Settlement = { ...legacySettlement('diego', 'tatiana', 50000, '2026-02-01'), status: 'voided' };

    expectParity([mov], [voidedManual]);
    expectParity([mov], [voidedLegacy]);
  });

  it('legacy: se auto-asigna a la deuda más antigua, sin doble conteo en una cuota ya pagada', () => {
    const movOld = movement('tatiana', 10000, [['tatiana', 0], ['diego', 10000]], { date: '2026-01-01' });
    const movNew = movement('tatiana', 10000, [['tatiana', 0], ['diego', 10000]], { date: '2026-01-15' });
    const legacy = legacySettlement('diego', 'tatiana', 10000, '2026-02-01');

    expectParity([movOld, movNew], [legacy]);

    const movCuotas = movement('tatiana', 92000, [['tatiana', 0], ['diego', 92000]], {
      installments: [installment(46000, '2026-02-01'), installment(46000, '2026-03-01')],
    });
    const legacyCuota = legacySettlement('diego', 'tatiana', 46000, '2026-02-01');

    expectParity([movCuotas], [legacyCuota]);
  });

  it('legacy múltiple: el desempate por settlement.date es el mismo en las dos implementaciones', () => {
    const mov = movement('tatiana', 158001, [['tatiana', 0], ['diego', 158001]], {
      installments: [installment(52667, '2026-02-01'), installment(52667, '2026-03-01'), installment(52667, '2026-04-01')],
    });
    const legacy1 = legacySettlement('diego', 'tatiana', 52667, '2026-02-05');
    const legacy2 = legacySettlement('diego', 'tatiana', 52667, '2026-03-05');

    // En orden invertido a propósito: el reparto depende de settlement.date, no del orden del array.
    expectParity([mov], [legacy2, legacy1]);
  });

  it('sobrepago (dato inconsistente): remaining clampeado a 0 en las dos implementaciones', () => {
    const mov = movement('tatiana', 50000, [['tatiana', 0], ['diego', 50000]]);
    const abono = manualSettlement('diego', 'tatiana', [
      { movementId: mov.id, debtorUid: 'diego', installmentIndex: null, amount: 60000 },
    ]);

    expectParity([mov], [abono]);
  });

  it('escenario Tatiana/Diego/Laura (sin abonos)', () => {
    const movements = [
      movement('diego', 62000, [['diego', 20666.68], ['tatiana', 20666.66], ['laura', 20666.66]]),
      movement('tatiana', 30000, [['tatiana', 10000], ['diego', 10000], ['laura', 10000]]),
    ];

    expectParity(movements, []);
  });

  it('redondeo: 62.000 / 3 y "pagar completo" con el remaining exacto', () => {
    const mov = movement('diego', 62000, [['diego', 20666.68], ['tatiana', 20666.66], ['laura', 20666.66]]);
    const [tatianaDebt] = computeDebts([mov], []);
    const abono = manualSettlement('tatiana', 'diego', [
      { movementId: mov.id, debtorUid: 'tatiana', installmentIndex: null, amount: tatianaDebt.remaining },
    ]);

    expectParity([mov], [abono]);
  });
});
