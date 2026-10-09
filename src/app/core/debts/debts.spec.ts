import type { Installment } from '../../models/movement.model';
import type { Settlement } from '../../models/settlement.model';
import {
  type AllocationPlan,
  type MovementWithId,
  autoAllocateOldestFirst,
  computeDebts,
  debtsByMovement,
  movementHasPayments,
} from './debts';

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

// Settlement "legacy": tal como los crea hoy SettlementsService.create() o
// el payInstallment() de antes de este cambio — sin allocations.
function legacySettlement(fromUid: string, toUid: string, amount: number, date: string): Settlement {
  return { groupId: 'group1', fromUid, toUid, amount, date: ts(date), note: '', linkedMovementId: null };
}

describe('computeDebts', () => {
  it('a plain shared expense generates one pending debt per non-payer split', () => {
    const mov = movement('tatiana', 100, [['tatiana', 50], ['diego', 50]]);

    const debts = computeDebts([mov], []);

    expect(debts).toEqual([
      {
        movementId: mov.id,
        debtorUid: 'diego',
        creditorUid: 'tatiana',
        installmentIndex: null,
        total: 50,
        paid: 0,
        remaining: 50,
        status: 'pendiente',
        anomaly: false,
      },
    ]);
  });

  it('an installment plan generates one debt PER CUOTA, not one for the total split', () => {
    const mov = movement('tatiana', 180000, [['tatiana', 90000], ['diego', 90000]], {
      installments: [
        installment(30000, '2026-02-01'),
        installment(30000, '2026-03-01'),
        installment(30000, '2026-04-01'),
      ],
    });

    const debts = computeDebts([mov], []);

    expect(debts).toHaveLength(3);
    expect(debts.every((debt) => debt.debtorUid === 'diego' && debt.creditorUid === 'tatiana')).toBe(true);
    expect(debts.map((debt) => debt.installmentIndex)).toEqual([0, 1, 2]);
    expect(debts.map((debt) => debt.total)).toEqual([30000, 30000, 30000]);
  });

  // TEST OBLIGATORIO #2 — abono a una cuota parcial.
  it('a partial allocation to one installment leaves it "parcial" with the right remaining', () => {
    const mov = movement('tatiana', 100000, [['tatiana', 50000], ['diego', 50000]], {
      installments: [installment(50000, '2026-02-01'), installment(50000, '2026-03-01')],
    });
    const abono = manualSettlement('diego', 'tatiana', [
      { movementId: mov.id, debtorUid: 'diego', installmentIndex: 0, amount: 20000 },
    ]);

    const debts = computeDebts([mov], [abono]);

    expect(debts[0]).toMatchObject({ installmentIndex: 0, total: 50000, paid: 20000, remaining: 30000, status: 'parcial' });
    expect(debts[1]).toMatchObject({ installmentIndex: 1, total: 50000, paid: 0, remaining: 50000, status: 'pendiente' });
  });

  // TEST OBLIGATORIO #1 — Diego le debe a Tatiana A=55.400, B=30.000 y C =
  // 3 cuotas de 52.667; abona 80.000: A completo, B parcial (resta 5.400),
  // C intacta. Se arma el plan con autoAllocateOldestFirst (lo mismo que
  // usará "Marcar como saldada") y se verifica con computeDebts.
  it('80.000 repartidos oldest-first entre A, B y una cuota C: A paga, B parcial, C intacta', () => {
    const movA = movement('tatiana', 55400, [['tatiana', 0], ['diego', 55400]], { date: '2026-01-01' });
    const movB = movement('tatiana', 30000, [['tatiana', 0], ['diego', 30000]], { date: '2026-01-02' });
    const movC = movement('tatiana', 158001, [['tatiana', 0], ['diego', 158001]], {
      date: '2026-01-03',
      installments: [
        installment(52667, '2026-02-01'),
        installment(52667, '2026-03-01'),
        installment(52667, '2026-04-01'),
      ],
    });

    const debtsBefore = computeDebts([movA, movB, movC], []);
    const plan = autoAllocateOldestFirst(debtsBefore, 'diego', 'tatiana', 80000);

    expect(plan).toEqual<AllocationPlan[]>([
      { movementId: movA.id, debtorUid: 'diego', installmentIndex: null, amount: 55400 },
      { movementId: movB.id, debtorUid: 'diego', installmentIndex: null, amount: 24600 },
    ]);

    const abono = manualSettlement('diego', 'tatiana', plan!, { date: '2026-02-15' });
    abono.allocationMode = 'auto';
    const debtsAfter = computeDebts([movA, movB, movC], [abono]);

    const byMovement = new Map(debtsAfter.map((debt) => [debt.movementId, debt]));
    expect(byMovement.get(movA.id)).toMatchObject({ paid: 55400, remaining: 0, status: 'pagada' });
    expect(byMovement.get(movB.id)).toMatchObject({ paid: 24600, remaining: 5400, status: 'parcial' });
    expect(debtsAfter.filter((debt) => debt.movementId === movC.id)).toEqual(
      expect.arrayContaining([expect.objectContaining({ paid: 0, remaining: 52667, status: 'pendiente' })])
    );
    expect(debtsAfter.filter((debt) => debt.movementId === movC.id)).toHaveLength(3);
  });

  // TEST OBLIGATORIO #6 — legacy: un settlement sin allocations se auto-
  // asigna a lo más antiguo; una cuota legacy pagada no se cuenta dos veces.
  describe('abonos legacy (sin allocations)', () => {
    it('se auto-asignan a la deuda más antigua de esa dirección', () => {
      const movOld = movement('tatiana', 10000, [['tatiana', 0], ['diego', 10000]], { date: '2026-01-01' });
      const movNew = movement('tatiana', 10000, [['tatiana', 0], ['diego', 10000]], { date: '2026-01-15' });
      // Legacy: tal como lo crea hoy SettlementsService.create(), sin saber a qué gasto aplica.
      const legacy = legacySettlement('diego', 'tatiana', 10000, '2026-02-01');

      const debts = computeDebts([movOld, movNew], [legacy]);
      const byMovement = new Map(debts.map((debt) => [debt.movementId, debt]));

      expect(byMovement.get(movOld.id)).toMatchObject({ remaining: 0, status: 'pagada' });
      expect(byMovement.get(movNew.id)).toMatchObject({ remaining: 10000, status: 'pendiente' });
    });

    it('una cuota legacy ya pagada (mismo patrón que payInstallment de antes de este cambio) cuenta pagada UNA sola vez', () => {
      const mov = movement('tatiana', 92000, [['tatiana', 0], ['diego', 92000]], {
        installments: [installment(46000, '2026-02-01'), installment(46000, '2026-03-01')],
      });
      // payInstallment() de antes de este cambio: un settlement sin allocations,
      // por exactamente el monto de la cuota 0.
      const legacy = legacySettlement('diego', 'tatiana', 46000, '2026-02-01');

      const debts = computeDebts([mov], [legacy]);

      expect(debts[0]).toMatchObject({ installmentIndex: 0, paid: 46000, remaining: 0, status: 'pagada' });
      expect(debts[1]).toMatchObject({ installmentIndex: 1, paid: 0, remaining: 46000, status: 'pendiente' });
      // Nada de sobrepago ni de "pagada" fantasma en otro lado.
      expect(debts.some((debt) => debt.anomaly)).toBe(false);
    });

    it('con varios abonos legacy, se procesan del más viejo al más nuevo (oldest-first entre los abonos también)', () => {
      const mov = movement('tatiana', 158001, [['tatiana', 0], ['diego', 158001]], {
        installments: [
          installment(52667, '2026-02-01'),
          installment(52667, '2026-03-01'),
          installment(52667, '2026-04-01'),
        ],
      });
      const legacy1 = legacySettlement('diego', 'tatiana', 52667, '2026-02-05');
      const legacy2 = legacySettlement('diego', 'tatiana', 52667, '2026-03-05');

      // Se pasan en orden invertido a propósito: el reparto debe depender de
      // settlement.date, no del orden del array.
      const debts = computeDebts([mov], [legacy2, legacy1]);

      expect(debts[0]).toMatchObject({ installmentIndex: 0, remaining: 0, status: 'pagada' });
      expect(debts[1]).toMatchObject({ installmentIndex: 1, remaining: 0, status: 'pagada' });
      expect(debts[2]).toMatchObject({ installmentIndex: 2, remaining: 52667, status: 'pendiente' });
    });
  });

  // TEST OBLIGATORIO #5 — un abono voided no cuenta en ningún estado.
  it('ignora los abonos con status "voided", tengan o no allocations', () => {
    const mov = movement('tatiana', 100000, [['tatiana', 50000], ['diego', 50000]]);
    const voidedManual = manualSettlement(
      'diego',
      'tatiana',
      [{ movementId: mov.id, debtorUid: 'diego', installmentIndex: null, amount: 50000 }],
      { status: 'voided' }
    );
    const voidedLegacy: Settlement = { ...legacySettlement('diego', 'tatiana', 50000, '2026-02-01'), status: 'voided' };

    expect(computeDebts([mov], [voidedManual])[0]).toMatchObject({ remaining: 50000, status: 'pendiente' });
    expect(computeDebts([mov], [voidedLegacy])[0]).toMatchObject({ remaining: 50000, status: 'pendiente' });
  });

  it('clampea un sobrepago (dato inconsistente) y lo marca como anomalía, sin dar remaining negativo', () => {
    const mov = movement('tatiana', 50000, [['tatiana', 0], ['diego', 50000]]);
    const abono = manualSettlement('diego', 'tatiana', [
      { movementId: mov.id, debtorUid: 'diego', installmentIndex: null, amount: 60000 },
    ]);

    const [debt] = computeDebts([mov], [abono]);

    expect(debt.remaining).toBe(0);
    expect(debt.paid).toBe(50000);
    expect(debt.status).toBe('pagada');
    expect(debt.anomaly).toBe(true);
  });

  // TEST OBLIGATORIO #9 — redondeo: 62.000 / 3 y "pagar completo" sin residuos.
  it('62.000 / 3 y "pagar completo" con el remaining exacto no deja residuo de redondeo', () => {
    const mov = movement('diego', 62000, [['diego', 20666.68], ['tatiana', 20666.66], ['laura', 20666.66]]);

    // diego es quien paga: su propio split no genera deuda, así que el
    // resultado trae solo 2 deudas (tatiana y laura), en ese orden.
    const [tatianaDebt] = computeDebts([mov], []);
    expect(tatianaDebt.remaining).toBe(20666.66);

    // "Pagar completo" usa exactamente el remaining fresco, nunca recalcula.
    const abono = manualSettlement('tatiana', 'diego', [
      { movementId: mov.id, debtorUid: 'tatiana', installmentIndex: null, amount: tatianaDebt.remaining },
    ]);

    const [tatianaAfter] = computeDebts([mov], [abono]);
    expect(tatianaAfter.remaining).toBe(0);
    expect(tatianaAfter.status).toBe('pagada');
    expect(tatianaAfter.anomaly).toBe(false);
  });
});

describe('debtsByMovement', () => {
  it('agrupa las deudas por gasto', () => {
    const mov1 = movement('tatiana', 100, [['tatiana', 50], ['diego', 50]]);
    const mov2 = movement('diego', 200, [['diego', 100], ['laura', 100]]);

    const byMovement = debtsByMovement([mov1, mov2], []);

    expect(byMovement.size).toBe(2);
    expect(byMovement.get(mov1.id)).toHaveLength(1);
    expect(byMovement.get(mov2.id)).toHaveLength(1);
  });
});

describe('autoAllocateOldestFirst', () => {
  it('returns null (sobrepago) when amount exceeds everything owed in that direction', () => {
    const mov = movement('tatiana', 50000, [['tatiana', 0], ['diego', 50000]]);
    const debts = computeDebts([mov], []);

    expect(autoAllocateOldestFirst(debts, 'diego', 'tatiana', 50001)).toBeNull();
  });

  it('returns an empty plan for a zero or negative amount', () => {
    const mov = movement('tatiana', 50000, [['tatiana', 0], ['diego', 50000]]);
    const debts = computeDebts([mov], []);

    expect(autoAllocateOldestFirst(debts, 'diego', 'tatiana', 0)).toEqual([]);
  });

  it('never touches a debt in the opposite direction', () => {
    const mov = movement('diego', 50000, [['diego', 0], ['tatiana', 50000]]); // tatiana le debe a diego, no al revés

    const debts = computeDebts([mov], []);

    expect(autoAllocateOldestFirst(debts, 'diego', 'tatiana', 1)).toBeNull();
  });
});

// Reemplaza a isSharedMovementLocked() (heurístico por fecha) e
// installments[].status como fuente de bloqueo de edición/borrado — ver
// DATABASE.md, "Balance de grupo y abonos" y SharedExpenseForm.
describe('movementHasPayments', () => {
  it('false when nothing has been paid at all', () => {
    const mov = movement('tatiana', 100, [['tatiana', 50], ['diego', 50]]);

    expect(movementHasPayments(mov.id, [mov], [])).toBe(false);
  });

  it('true when an explicit allocation already paid part of the debt', () => {
    const mov = movement('tatiana', 100, [['tatiana', 50], ['diego', 50]]);
    const abono = manualSettlement('diego', 'tatiana', [
      { movementId: mov.id, debtorUid: 'diego', installmentIndex: null, amount: 20 },
    ]);

    expect(movementHasPayments(mov.id, [mov], [abono])).toBe(true);
  });

  it('true via a legacy auto-assigned abono (no allocations) — hasPayments reads computeDebts, never installments[].status', () => {
    const mov = movement('tatiana', 100, [['tatiana', 50], ['diego', 50]]);
    const legacy = legacySettlement('diego', 'tatiana', 10, '2026-02-01');

    expect(movementHasPayments(mov.id, [mov], [legacy])).toBe(true);
  });

  it('false when the only abono touching this pair is voided', () => {
    const mov = movement('tatiana', 100, [['tatiana', 50], ['diego', 50]]);
    const voided = manualSettlement(
      'diego',
      'tatiana',
      [{ movementId: mov.id, debtorUid: 'diego', installmentIndex: null, amount: 50 }],
      { status: 'voided' }
    );

    expect(movementHasPayments(mov.id, [mov], [voided])).toBe(false);
  });

  it('false for a different movement of the same pair — paid is per-debt, not per-pair', () => {
    const paidMov = movement('tatiana', 100, [['tatiana', 50], ['diego', 50]]);
    const untouchedMov = movement('tatiana', 200, [['tatiana', 100], ['diego', 100]]);
    const abono = manualSettlement('diego', 'tatiana', [
      { movementId: paidMov.id, debtorUid: 'diego', installmentIndex: null, amount: 50 },
    ]);

    expect(movementHasPayments(untouchedMov.id, [paidMov, untouchedMov], [abono])).toBe(false);
  });

  it('true when one cuota of an installment plan has a payment applied, even while others stay pending', () => {
    const mov = movement('tatiana', 100, [['tatiana', 0], ['diego', 100]], {
      installments: [installment(50, '2026-02-01'), installment(50, '2026-03-01')],
    });
    const abono = manualSettlement('diego', 'tatiana', [
      { movementId: mov.id, debtorUid: 'diego', installmentIndex: 0, amount: 50 },
    ]);

    expect(movementHasPayments(mov.id, [mov], [abono])).toBe(true);
  });
});
