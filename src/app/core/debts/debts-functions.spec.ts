// Tests directos de functions/src/debts.ts (no de paridad — cuotaDebtsForPair
// no tiene equivalente del lado del cliente, la usa solo
// syncInstallmentStatus). Ver debts-functions-parity.spec.ts para la
// comparación 1:1 de remainingForDebt() contra computeDebts() del cliente.
import type { Installment } from '../../models/movement.model';
import type { Settlement } from '../../models/settlement.model';
// Ruta relativa a propósito, cruzando a otro proyecto de TypeScript — ver
// el comentario de cabecera de functions/src/debts.ts.
import { cuotaDebtsForPair } from '../../../../functions/src/debts';
import type { MovementWithId } from './debts';

function ts(date: string) {
  return { toDate: () => new Date(date), toMillis: () => new Date(date).getTime() } as never;
}

let movementIdCounter = 0;

function movement(
  paidBy: string,
  splits: [string, number][],
  opts: { date?: string; installments?: Installment[] } = {}
): MovementWithId {
  movementIdCounter += 1;
  return {
    id: `m${movementIdCounter}`,
    uid: paidBy,
    categoryId: 'cat1',
    type: 'expense',
    amount: splits.reduce((sum, [, amount]) => sum + amount, 0),
    date: ts(opts.date ?? '2026-01-01'),
    note: '',
    groupId: 'group1',
    paidBy,
    splitType: 'equal',
    splits: splits.map(([uid, amount]) => ({ uid, amount, settled: false })),
    installments: opts.installments ?? null,
  };
}

function installment(amount: number, dueDate: string): Installment {
  return { amount, dueDate: ts(dueDate), status: 'pending' };
}

function legacySettlement(fromUid: string, toUid: string, amount: number, date: string, status?: Settlement['status']): Settlement {
  return { groupId: 'group1', fromUid, toUid, amount, date: ts(date), note: '', linkedMovementId: null, status };
}

describe('cuotaDebtsForPair', () => {
  it('solo trae deudas DE CUOTA de la dirección fromUid -> toUid, nunca el sentido contrario ni gastos sin cuotas', () => {
    const movSinCuotas = movement('tatiana', [['tatiana', 0], ['diego', 50000]]);
    const movCuotas = movement('tatiana', [['tatiana', 0], ['diego', 100000]], {
      installments: [installment(50000, '2026-02-01'), installment(50000, '2026-03-01')],
    });
    const movReverso = movement('diego', [['diego', 0], ['tatiana', 30000]], {
      installments: [installment(30000, '2026-02-01')],
    });

    const debts = cuotaDebtsForPair([movSinCuotas, movCuotas, movReverso], [], 'diego', 'tatiana');

    expect(debts).toHaveLength(2);
    expect(debts.every((d) => d.movementId === movCuotas.id)).toBe(true);
    expect(debts.map((d) => d.installmentIndex).sort()).toEqual([0, 1]);
  });

  // Caso que motiva el trigger: anular un abono legacy puede cambiarle el
  // estado a una cuota que ESE abono ni siquiera referenciaba — porque el
  // reparto legacy se recalcula contra TODAS las deudas de la pareja, no
  // solo contra las de la allocation que cambió.
  it('anular un abono legacy puede desplazar a qué cuota le "toca" el pago, sin que esa cuota estuviera en su allocation', () => {
    const mov = movement('tatiana', [['tatiana', 0], ['diego', 100000]], {
      installments: [installment(50000, '2026-02-01'), installment(50000, '2026-03-01')],
    });
    // Ly (10 feb) paga primero, cubre la cuota 0. Lx (20 feb) paga después, cubre la cuota 1.
    const ly = legacySettlement('diego', 'tatiana', 50000, '2026-02-10');
    const lx = legacySettlement('diego', 'tatiana', 50000, '2026-02-20');

    const before = cuotaDebtsForPair([mov], [lx, ly], 'diego', 'tatiana');
    expect(before.find((d) => d.installmentIndex === 0)?.remaining).toBe(0);
    expect(before.find((d) => d.installmentIndex === 1)?.remaining).toBe(0);

    // Se anula Ly (la que pagaba la cuota 0) — Lx se corre a cubrir la cuota 0,
    // y la cuota 1 (que Ly nunca tocó) vuelve a quedar pendiente.
    const lyVoided: Settlement = { ...ly, status: 'voided' };
    const after = cuotaDebtsForPair([mov], [lx, lyVoided], 'diego', 'tatiana');

    expect(after.find((d) => d.installmentIndex === 0)?.remaining).toBe(0);
    expect(after.find((d) => d.installmentIndex === 1)?.remaining).toBe(50000);
  });

  it('una allocation explícita anulada hace que su cuota vuelva a remaining completo', () => {
    const mov = movement('tatiana', [['tatiana', 0], ['diego', 50000]], {
      installments: [installment(50000, '2026-02-01')],
    });
    const abono: Settlement = {
      groupId: 'group1',
      fromUid: 'diego',
      toUid: 'tatiana',
      amount: 50000,
      date: ts('2026-02-05'),
      note: '',
      linkedMovementId: null,
      allocations: [{ movementId: mov.id, debtorUid: 'diego', installmentIndex: 0, amount: 50000 }],
      allocationMode: 'manual',
    };

    const paid = cuotaDebtsForPair([mov], [abono], 'diego', 'tatiana');
    expect(paid[0].remaining).toBe(0);

    const abonoVoided: Settlement = { ...abono, status: 'voided' };
    const reverted = cuotaDebtsForPair([mov], [abonoVoided], 'diego', 'tatiana');
    expect(reverted[0].remaining).toBe(50000);
  });

  it('una cuota parcial nunca da remaining 0 (se queda en "pending" para installments[].status, no hay tercer estado)', () => {
    const mov = movement('tatiana', [['tatiana', 0], ['diego', 50000]], {
      installments: [installment(50000, '2026-02-01')],
    });
    const abono: Settlement = {
      groupId: 'group1',
      fromUid: 'diego',
      toUid: 'tatiana',
      amount: 20000,
      date: ts('2026-02-05'),
      note: '',
      linkedMovementId: null,
      allocations: [{ movementId: mov.id, debtorUid: 'diego', installmentIndex: 0, amount: 20000 }],
      allocationMode: 'manual',
    };

    const [debt] = cuotaDebtsForPair([mov], [abono], 'diego', 'tatiana');
    expect(debt.remaining).toBe(30000);
    expect(debt.remaining > 0).toBe(true);
  });
});
