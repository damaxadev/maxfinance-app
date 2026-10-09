import type { Settlement } from '../../models/settlement.model';
import type { MovementWithId } from '../debts/debts';
import { calculateGroupBalance } from './group-balance';

function ts(date: string) {
  return { toDate: () => new Date(date), toMillis: () => new Date(date).getTime() } as never;
}

// Fecha por defecto cuando un test no la necesita — tiene que ser una
// fecha REAL (con toMillis()), nunca un objeto vacío: computeDebts() la usa
// para ordenar "deuda más antigua primero" (ver core/debts/debts.ts), así
// que hasta un test que no le presta atención a las fechas la necesita
// funcional. Cada llamada a movement()/settlement() sin fecha explícita
// recibe un día distinto y creciente, para que el orden entre ellos sea
// determinista sin que el test tenga que elegir fechas a mano.
let fakeDateCounter = 0;
function nextFakeDate() {
  fakeDateCounter += 1;
  return ts(`2026-01-${String(fakeDateCounter).padStart(2, '0')}`);
}

let movementIdCounter = 0;

function movement(
  paidBy: string,
  amount: number,
  splits: [string, number][],
  date = nextFakeDate()
): MovementWithId {
  movementIdCounter += 1;
  return {
    id: `m${movementIdCounter}`,
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
  } as MovementWithId;
}

function settlement(fromUid: string, toUid: string, amount: number, date = nextFakeDate()): Settlement {
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

  // Decisión de producto (ver DATABASE.md, "Balance de grupo y abonos"):
  // las deudas NUNCA se cruzan, ni entre direcciones de la misma pareja.
  // Antes esto "neteaba" a una sola línea de 35 — ya no: quedan dos líneas
  // independientes, cada una con lo que le corresponde saldar a cada uno.
  it('keeps BOTH directions of the same pair as independent lines — nunca se cruzan', () => {
    // A paga 100 (B le debe 50 a A) y luego B paga 30 dividido igual (A le debe 15 a B).
    const movements = [
      movement('A', 100, [['A', 50], ['B', 50]]),
      movement('B', 30, [['A', 15], ['B', 15]]),
    ];

    const edges = calculateGroupBalance(movements, []);

    expect(edges).toHaveLength(2);
    expect(edges).toEqual(
      expect.arrayContaining([
        { fromUid: 'B', toUid: 'A', amount: 50 },
        { fromUid: 'A', toUid: 'B', amount: 15 },
      ])
    );
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

  it('three independent directions never cancel out, ni siquiera dentro de la misma pareja A-B', () => {
    // Movimiento 1: A paga 90, dividido entre A, B y C (30 c/u) -> B y C deben 30 c/u a A.
    // Movimiento 2: B paga 60, dividido entre A y B (30 c/u) -> A le debe 30 a B.
    // Antes esto "neteaba" A-B a cero — ya no: quedan 3 líneas independientes.
    const movements = [
      movement('A', 90, [['A', 30], ['B', 30], ['C', 30]]),
      movement('B', 60, [['A', 30], ['B', 30]]),
    ];

    const edges = calculateGroupBalance(movements, []);

    expect(edges).toHaveLength(3);
    expect(edges).toEqual(
      expect.arrayContaining([
        { fromUid: 'B', toUid: 'A', amount: 30 },
        { fromUid: 'C', toUid: 'A', amount: 30 },
        { fromUid: 'A', toUid: 'B', amount: 30 },
      ])
    );
  });

  it('keeps one line per DIRECTION even when a person both receives and owes (distintas parejas)', () => {
    // Mov 1: C paga 150, dividido [A:100, C:50] -> A le debe 100 a C.
    // Mov 2: C paga 50, dividido [B:50]          -> B le debe 50 a C.
    // Mov 3: D paga 30, dividido [C:30]          -> C le debe 30 a D.
    const movements = [
      movement('C', 150, [['A', 100], ['C', 50]]),
      movement('C', 50, [['B', 50]]),
      movement('D', 30, [['C', 30]]),
    ];

    const edges = calculateGroupBalance(movements, []);

    expect(edges).toHaveLength(3);
    expect(edges).toEqual(
      expect.arrayContaining([
        { fromUid: 'A', toUid: 'C', amount: 100 },
        { fromUid: 'B', toUid: 'C', amount: 50 },
        { fromUid: 'C', toUid: 'D', amount: 30 },
      ])
    );
  });

  // TEST OBLIGATORIO — el ejemplo del usuario: 4 direcciones entre 3
  // personas, todas independientes (Laura participa en 3 de las 4, en los
  // dos sentidos con Diego Y con Tatiana, y ninguna se toca con otra).
  it('4 direcciones independientes entre 3 personas, incluida la misma pareja en ambos sentidos', () => {
    const movements = [
      movement('laura', 100000, [['laura', 0], ['diego', 100000]]), // diego -> laura
      movement('tatiana', 80000, [['tatiana', 0], ['laura', 80000]]), // laura -> tatiana
      movement('diego', 80000, [['diego', 0], ['laura', 80000]]), // laura -> diego
      movement('laura', 30000, [['laura', 0], ['tatiana', 30000]]), // tatiana -> laura
    ];

    const edges = calculateGroupBalance(movements, []);

    expect(edges).toHaveLength(4);
    expect(edges).toEqual(
      expect.arrayContaining([
        { fromUid: 'diego', toUid: 'laura', amount: 100000 },
        { fromUid: 'laura', toUid: 'tatiana', amount: 80000 },
        { fromUid: 'laura', toUid: 'diego', amount: 80000 },
        { fromUid: 'tatiana', toUid: 'laura', amount: 30000 },
      ])
    );
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

  // TEST OBLIGATORIO — escenario real que destapó el bug del neto global,
  // ahora con el modelo sin cruce: 4 líneas, una por dirección.
  it('escenario Tatiana/Diego/Laura: 4 líneas (una por dirección), sin cruzar nada', () => {
    // Diego paga 62.000 entre los tres: 62.000 / 3 = 20.666,66 con 0,02 de
    // sobrante. distributeEqually le da el sobrante al primero del grupo; acá
    // se asume que es Diego (quien paga), así que Tatiana y Laura deben
    // 20.666,66 exacto. Si el sobrante cae en Tatiana, su línea sale 10.666,68
    // (igual se muestra como $10.667).
    // Tatiana paga 30.000 entre los tres: 10.000 c/u.
    const movements = [
      movement('diego', 62000, [['diego', 20666.68], ['tatiana', 20666.66], ['laura', 20666.66]]),
      movement('tatiana', 30000, [['tatiana', 10000], ['diego', 10000], ['laura', 10000]]),
    ];

    const edges = calculateGroupBalance(movements, []);

    expect(edges).toHaveLength(4);
    expect(edges).toEqual(
      expect.arrayContaining([
        { fromUid: 'tatiana', toUid: 'diego', amount: 20666.66 },
        { fromUid: 'laura', toUid: 'diego', amount: 20666.66 },
        { fromUid: 'diego', toUid: 'tatiana', amount: 10000 },
        { fromUid: 'laura', toUid: 'tatiana', amount: 10000 },
      ])
    );
  });

  it('un pago entre dos personas solo reduce la deuda de ESA dirección, nunca la contraria', () => {
    const movements = [
      movement('diego', 62000, [['diego', 20666.68], ['tatiana', 20666.66], ['laura', 20666.66]]),
      movement('tatiana', 30000, [['tatiana', 10000], ['diego', 10000], ['laura', 10000]]),
    ];
    // Laura le paga todo a Diego: baja solo laura->diego. diego->tatiana
    // (una dirección completamente distinta, aunque Diego sea el mismo)
    // queda intacta.
    const settlements = [settlement('laura', 'diego', 20666.66)];

    const edges = calculateGroupBalance(movements, settlements);

    expect(edges).toHaveLength(3);
    expect(edges).toEqual(
      expect.arrayContaining([
        { fromUid: 'tatiana', toUid: 'diego', amount: 20666.66 },
        { fromUid: 'diego', toUid: 'tatiana', amount: 10000 },
        { fromUid: 'laura', toUid: 'tatiana', amount: 10000 },
      ])
    );
  });

  // TEST OBLIGATORIO — deudas cruzadas: dos líneas INDEPENDIENTES, un abono
  // a una nunca toca la otra (antes esto se "volteaba" en una sola línea neta).
  it('deudas cruzadas: dos líneas independientes — un abono a una nunca toca la otra', () => {
    // A: Tatiana paga, Diego le debe 27.700. B: Diego paga, Tatiana le debe 15.000.
    const movA = movement('tatiana', 27700, [['tatiana', 0], ['diego', 27700]]);
    const movB = movement('diego', 15000, [['diego', 0], ['tatiana', 15000]]);

    expect(calculateGroupBalance([movA, movB], [])).toEqual(
      expect.arrayContaining([
        { fromUid: 'diego', toUid: 'tatiana', amount: 27700 },
        { fromUid: 'tatiana', toUid: 'diego', amount: 15000 },
      ])
    );

    // Diego abona 20.000, asignados a A (no a B): A queda parcial (resta 7.700).
    const abono: Settlement = {
      groupId: 'group1',
      fromUid: 'diego',
      toUid: 'tatiana',
      amount: 20000,
      date: nextFakeDate(),
      note: '',
      linkedMovementId: null,
      allocations: [{ movementId: movA.id, debtorUid: 'diego', installmentIndex: null, amount: 20000 }],
      allocationMode: 'manual',
    };

    // diego->tatiana baja a 7.700 (lo que falta de A); tatiana->diego sigue
    // en 15.000, intacta — nunca se cruzan.
    expect(calculateGroupBalance([movA, movB], [abono])).toEqual(
      expect.arrayContaining([
        { fromUid: 'diego', toUid: 'tatiana', amount: 7700 },
        { fromUid: 'tatiana', toUid: 'diego', amount: 15000 },
      ])
    );
  });

  it('un abono voided no cuenta en el balance', () => {
    const movements = [movement('A', 100, [['A', 50], ['B', 50]])];
    const voided: Settlement = { ...settlement('B', 'A', 50), status: 'voided' };

    expect(calculateGroupBalance(movements, [voided])).toEqual([{ fromUid: 'B', toUid: 'A', amount: 50 }]);
  });
});
