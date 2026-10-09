import { TestBed } from '@angular/core/testing';
import { Firestore, collectionData, getDocs } from '@angular/fire/firestore';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { firstValueFrom, of } from 'rxjs';
import { vi } from 'vitest';

import { Auth } from '../auth/auth';
import { AttachmentsService } from '../attachments/attachments';
import { Categories } from '../categories/categories';
import { MovementsService } from '../movements/movements';
import type { Installment } from '../../models/movement.model';
import { SettlementsService, StaleDebtError } from './settlements';

const { mockBatch, mockCommit } = vi.hoisted(() => {
  const commit = vi.fn().mockResolvedValue(undefined);
  return {
    mockCommit: commit,
    mockBatch: {
      set: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      commit,
    },
  };
});

let autoDocId = 0;

vi.mock('@angular/fire/firestore', () => ({
  Firestore: class {},
  collection: vi.fn((_fs, path) => ({ path })),
  collectionData: vi.fn(() => of([])),
  // doc(firestore, path, id) referencia un id explícito; doc(collectionRef)
  // (un solo argumento) autogenera uno — como lo hace SettlementsService al
  // crear el settlement y, opcionalmente, el movement enlazado.
  doc: vi.fn((...args: unknown[]) => {
    if (args.length === 1) {
      const collectionRef = args[0] as { path: string };
      return { path: collectionRef.path, id: `auto-id-${++autoDocId}` };
    }
    const [, path, id] = args as [unknown, string, string];
    return { path, id };
  }),
  query: vi.fn((...args: unknown[]) => args),
  where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
  increment: vi.fn((n: number) => ({ __op: 'increment', value: n })),
  serverTimestamp: vi.fn(() => ({ __op: 'serverTimestamp' })),
  writeBatch: vi.fn(() => mockBatch),
  getDocs: vi.fn(),
  Timestamp: { fromDate: vi.fn((d: Date) => ({ __ts: d.getTime() })) },
}));

// SettlementsService ahora inyecta AttachmentsService (attachFile()/
// removeAttachment(), ver prompt 3 del sistema de abonos) — se mockea en
// TODOS los TestBed de este spec para no depender de la instancia real,
// que a su vez necesitaría Storage. Ningún test de este archivo llama
// attachFile()/removeAttachment() todavía, así que un stub vacío basta.
const fakeAttachmentsService = { upload: vi.fn(), remove: vi.fn(), getDownloadUrl: vi.fn() };

const fakeCategories = [
  { id: 'cat-debt', uid: null, name: 'Pago de deuda', icon: '💳', type: 'expense' as const },
  { id: 'cat-income', uid: null, name: 'Otros ingresos', icon: '💰', type: 'income' as const },
];

function resetHaptics(): void {
  mockBatch.set.mockClear();
  mockBatch.update.mockClear();
  mockCommit.mockClear();
  vi.mocked(collectionData).mockClear().mockReturnValue(of([]));
  vi.mocked(getDocs).mockClear();
  vi.mocked(FirebaseAuthentication.getCurrentUser).mockReset().mockResolvedValue({ user: null });
  vi.mocked(FirebaseAuthentication.addListener).mockReset().mockResolvedValue({ remove: vi.fn() });
}

describe('SettlementsService (current user is the payer, u1)', () => {
  let service: SettlementsService;
  let groupMovements$: ReturnType<typeof vi.fn>;
  const fakeUser = { uid: 'u1' };

  beforeEach(() => {
    resetHaptics();
    groupMovements$ = vi.fn(() => of([]));

    TestBed.configureTestingModule({
      providers: [
        { provide: Firestore, useValue: {} },
        { provide: Auth, useValue: { currentUser$: of(fakeUser), currentUser: fakeUser } },
        { provide: Categories, useValue: { categories$: of(fakeCategories) } },
        { provide: MovementsService, useValue: { groupMovements$ } },
        { provide: AttachmentsService, useValue: fakeAttachmentsService },
      ],
    });
    service = TestBed.inject(SettlementsService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('settlements$(): queries by groupId and returns the group settlements', async () => {
    const fakeSettlement = { id: 's1', groupId: 'group1', fromUid: 'u1', toUid: 'u2', amount: 50 };
    vi.mocked(collectionData).mockReturnValueOnce(of([fakeSettlement]));

    const result = await firstValueFrom(service.settlements$('group1'));

    expect(result).toEqual([fakeSettlement]);
  });

  it('settlementsForGroups$(): runs one query per group and flattens the results', async () => {
    const inGroup1 = { id: 's1', groupId: 'group1', fromUid: 'u1', toUid: 'u2', amount: 50 };
    const inGroup2 = { id: 's2', groupId: 'group2', fromUid: 'u2', toUid: 'u1', amount: 30 };
    vi.mocked(collectionData).mockReturnValueOnce(of([inGroup1])).mockReturnValueOnce(of([inGroup2]));

    const result = await firstValueFrom(service.settlementsForGroups$(['group1', 'group2']));

    expect(result).toEqual([inGroup1, inGroup2]);
  });

  it('settlementsForGroups$(): returns an empty array without querying when there are no groups', async () => {
    const result = await firstValueFrom(service.settlementsForGroups$([]));

    expect(result).toEqual([]);
    expect(collectionData).not.toHaveBeenCalled();
  });

  it('createSettlement(): registers the settlement without a linked movement by default', async () => {
    groupMovements$.mockReturnValue(of([fakeMovement('u2', [['u2', 0], ['u1', 50]])]));

    await service.createSettlement({
      groupId: 'group1',
      fromUid: 'u1',
      toUid: 'u2',
      note: '',
      personalMovementAccountId: null,
      allocationMode: 'auto',
      amount: 50,
    });

    expect(mockBatch.set).toHaveBeenCalledTimes(1);
    expect(mockBatch.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ groupId: 'group1', fromUid: 'u1', toUid: 'u2', amount: 50, linkedMovementId: null })
    );
    expect(mockCommit).toHaveBeenCalled();
  });

  it('createSettlement(): as the payer (fromUid), links an expense movement under "Pago de deuda"', async () => {
    groupMovements$.mockReturnValue(of([fakeMovement('u2', [['u2', 0], ['u1', 50]])]));

    await service.createSettlement({
      groupId: 'group1',
      fromUid: 'u1',
      toUid: 'u2',
      note: 'Efectivo',
      personalMovementAccountId: 'acc1',
      allocationMode: 'auto',
      amount: 50,
    });

    expect(mockBatch.set).toHaveBeenCalledTimes(2);
    expect(mockBatch.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ groupId: 'group1', linkedMovementId: expect.any(String) })
    );
    expect(mockBatch.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        uid: 'u1',
        type: 'expense',
        amount: 50,
        accountId: 'acc1',
        categoryId: 'cat-debt',
        groupId: null,
        settlementId: expect.any(String),
      })
    );
    expect(mockBatch.update).toHaveBeenCalledWith(expect.objectContaining({ path: 'accounts', id: 'acc1' }), {
      balance: { __op: 'increment', value: -50 },
    });
  });

  it('linkPersonalMovement(): converts an existing settlement independently of how it was created', async () => {
    const settlement = { id: 's1', groupId: 'group1', fromUid: 'u1', toUid: 'u2', amount: 50, note: 'Cena', linkedMovementId: null } as never;
    // linkPersonalMovement() relee el settlement fresco (¿sigue activo?) y
    // chequea "¿ya lo registré?" en paralelo (ver DATABASE.md) — acá ambos
    // deben resolver "sí existe, activo" y "no, todavía no hay nada".
    vi.mocked(collectionData).mockReturnValueOnce(of([settlement]));
    vi.mocked(getDocs).mockResolvedValueOnce({ docs: [] } as never);

    await service.linkPersonalMovement(settlement, 'acc1');

    expect(mockBatch.set).toHaveBeenCalledTimes(1);
    expect(mockBatch.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        uid: 'u1',
        type: 'expense',
        amount: 50,
        accountId: 'acc1',
        categoryId: 'cat-debt',
        groupId: null,
        settlementId: 's1',
      })
    );
    expect(mockBatch.update).toHaveBeenCalledWith(expect.objectContaining({ path: 'accounts', id: 'acc1' }), {
      balance: { __op: 'increment', value: -50 },
    });
  });

  it('findLinkedMovementSettlementIds(): returns the ids that already have a movement for this user', async () => {
    vi.mocked(getDocs).mockResolvedValueOnce({
      docs: [{ data: () => ({ settlementId: 's1' }) }],
    } as never);

    const result = await service.findLinkedMovementSettlementIds(['s1', 's2'], 'u1');

    expect(result).toEqual(new Set(['s1']));
  });

  it('findLinkedMovementSettlementIds(): returns an empty set without querying when there are no ids', async () => {
    const result = await service.findLinkedMovementSettlementIds([], 'u1');

    expect(result).toEqual(new Set());
    expect(getDocs).not.toHaveBeenCalled();
  });

});

describe('SettlementsService (current user is the receiver, u2)', () => {
  let service: SettlementsService;
  let groupMovements$: ReturnType<typeof vi.fn>;
  const fakeUser = { uid: 'u2' };

  beforeEach(() => {
    resetHaptics();
    groupMovements$ = vi.fn(() => of([]));

    TestBed.configureTestingModule({
      providers: [
        { provide: Firestore, useValue: {} },
        { provide: Auth, useValue: { currentUser$: of(fakeUser), currentUser: fakeUser } },
        { provide: Categories, useValue: { categories$: of(fakeCategories) } },
        { provide: MovementsService, useValue: { groupMovements$ } },
        { provide: AttachmentsService, useValue: fakeAttachmentsService },
      ],
    });
    service = TestBed.inject(SettlementsService);
  });

  it('createSettlement(): as the receiver (toUid), links an income movement under "Otros ingresos"', async () => {
    groupMovements$.mockReturnValue(of([fakeMovement('u2', [['u2', 0], ['u1', 50]])]));

    await service.createSettlement({
      groupId: 'group1',
      fromUid: 'u1',
      toUid: 'u2',
      note: '',
      personalMovementAccountId: 'acc2',
      allocationMode: 'auto',
      amount: 50,
    });

    expect(mockBatch.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ uid: 'u2', type: 'income', categoryId: 'cat-income' })
    );
    expect(mockBatch.update).toHaveBeenCalledWith(expect.objectContaining({ path: 'accounts', id: 'acc2' }), {
      balance: { __op: 'increment', value: 50 },
    });
  });
});

describe('SettlementsService (seed not run — base category missing)', () => {
  let service: SettlementsService;
  const fakeUser = { uid: 'u1' };

  beforeEach(() => {
    resetHaptics();

    TestBed.configureTestingModule({
      providers: [
        { provide: Firestore, useValue: {} },
        { provide: Auth, useValue: { currentUser$: of(fakeUser), currentUser: fakeUser } },
        { provide: Categories, useValue: { categories$: of([]) } },
        {
          provide: MovementsService,
          useValue: { groupMovements$: vi.fn(() => of([fakeMovement('u2', [['u2', 0], ['u1', 50]])])) },
        },
        { provide: AttachmentsService, useValue: fakeAttachmentsService },
      ],
    });
    service = TestBed.inject(SettlementsService);
  });

  it('createSettlement(): throws a clear error if the base category is missing', async () => {
    await expect(
      service.createSettlement({
        groupId: 'group1',
        fromUid: 'u1',
        toUid: 'u2',
        note: '',
        personalMovementAccountId: 'acc1',
        allocationMode: 'auto',
        amount: 50,
      })
    ).rejects.toThrow(/Pago de deuda/);
  });
});

// Ver DATABASE.md, "Balance de grupo y abonos" — createSettlement() releer
// movements+settlements FRESCOS del grupo (vía MovementsService.
// groupMovements$ + this.settlements$, ambos mockeados abajo) antes de
// validar y escribir.
function ts(date: string) {
  return { toDate: () => new Date(date), toMillis: () => new Date(date).getTime() } as never;
}

let movementIdCounter = 0;
function fakeMovement(
  paidBy: string,
  splits: [string, number][],
  opts: { date?: string; installments?: Installment[] } = {}
) {
  movementIdCounter += 1;
  return {
    id: `m${movementIdCounter}`,
    uid: paidBy,
    categoryId: 'cat1',
    type: 'expense' as const,
    amount: splits.reduce((sum, [, amount]) => sum + amount, 0),
    date: ts(opts.date ?? '2026-01-01'),
    note: '',
    groupId: 'group1',
    paidBy,
    splitType: 'equal' as const,
    splits: splits.map(([uid, amount]) => ({ uid, amount, settled: false })),
    installments: opts.installments ?? null,
  };
}

function fakeInstallment(amount: number, dueDate: string): Installment {
  return { amount, dueDate: ts(dueDate), status: 'pending' };
}

describe('SettlementsService.createSettlement()', () => {
  let service: SettlementsService;
  let groupMovements$: ReturnType<typeof vi.fn>;
  const fakeUser = { uid: 'diego' };

  beforeEach(() => {
    resetHaptics();
    movementIdCounter = 0;
    groupMovements$ = vi.fn(() => of([]));

    TestBed.configureTestingModule({
      providers: [
        { provide: Firestore, useValue: {} },
        { provide: Auth, useValue: { currentUser$: of(fakeUser), currentUser: fakeUser } },
        { provide: Categories, useValue: { categories$: of(fakeCategories) } },
        { provide: MovementsService, useValue: { groupMovements$ } },
        { provide: AttachmentsService, useValue: fakeAttachmentsService },
      ],
    });
    service = TestBed.inject(SettlementsService);
  });

  it('rechaza si quien llama no es fromUid ni toUid', async () => {
    await expect(
      service.createSettlement({
        groupId: 'group1',
        fromUid: 'tatiana',
        toUid: 'laura',
        note: '',
        personalMovementAccountId: null,
        allocationMode: 'auto',
        amount: 100,
      })
    ).rejects.toThrow('No eres parte de esta deuda.');
    expect(groupMovements$).not.toHaveBeenCalled();
  });

  it('rechaza si fromUid y toUid son la misma persona', async () => {
    await expect(
      service.createSettlement({
        groupId: 'group1',
        fromUid: 'diego',
        toUid: 'diego',
        note: '',
        personalMovementAccountId: null,
        allocationMode: 'auto',
        amount: 100,
      })
    ).rejects.toThrow('la misma persona');
  });

  // TEST OBLIGATORIO #8 (saldada) — un solo abono auto-asignado deja el
  // neto de la pareja en 0.
  it('auto: "marcar como saldada" reparte el monto a las deudas más antiguas y deja el neto en 0', async () => {
    const movA = fakeMovement('tatiana', [['tatiana', 0], ['diego', 55400]], { date: '2026-01-01' });
    const movB = fakeMovement('tatiana', [['tatiana', 0], ['diego', 30000]], { date: '2026-01-02' });
    groupMovements$.mockReturnValue(of([movA, movB]));

    const id = await service.createSettlement({
      groupId: 'group1',
      fromUid: 'diego',
      toUid: 'tatiana',
      note: '',
      personalMovementAccountId: null,
      allocationMode: 'auto',
      amount: 85400,
    });

    expect(id).toMatch(/^auto-id-\d+$/);
    expect(mockBatch.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        groupId: 'group1',
        fromUid: 'diego',
        toUid: 'tatiana',
        amount: 85400,
        allocationMode: 'auto',
        createdBy: 'diego',
        allocations: [
          { movementId: movA.id, debtorUid: 'diego', installmentIndex: null, amount: 55400 },
          { movementId: movB.id, debtorUid: 'diego', installmentIndex: null, amount: 30000 },
        ],
      })
    );
  });

  it('auto: rechaza con StaleDebtError si el monto supera lo que se debe entre esas dos personas', async () => {
    const movA = fakeMovement('tatiana', [['tatiana', 0], ['diego', 100]]);
    groupMovements$.mockReturnValue(of([movA]));

    await expect(
      service.createSettlement({
        groupId: 'group1',
        fromUid: 'diego',
        toUid: 'tatiana',
        note: '',
        personalMovementAccountId: null,
        allocationMode: 'auto',
        amount: 101,
      })
    ).rejects.toThrow(StaleDebtError);
  });

  it('createSettlement(): usa la fecha pasada en `date` para el abono (y para el movimiento vinculado), no "ahora"', async () => {
    const movA = fakeMovement('tatiana', [['tatiana', 0], ['diego', 50]]);
    groupMovements$.mockReturnValue(of([movA]));
    const chosenDate = new Date('2026-03-15T10:00:00');

    await service.createSettlement({
      groupId: 'group1',
      fromUid: 'diego',
      toUid: 'tatiana',
      note: '',
      personalMovementAccountId: 'acc1',
      allocationMode: 'auto',
      amount: 50,
      date: chosenDate,
    });

    expect(mockBatch.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ date: { __ts: chosenDate.getTime() } })
    );
    expect(mockBatch.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ uid: 'diego', date: { __ts: chosenDate.getTime() } })
    );
  });

  // TEST OBLIGATORIO #8 (pagada) — "pagar completo" (full: true) una cuota
  // puntual la deja pagada y las demás intactas.
  it('manual: "marcar como pagada" (full) en una cuota deja esa cuota pagada y las demás intactas', async () => {
    const mov = fakeMovement('tatiana', [['tatiana', 0], ['diego', 92000]], {
      installments: [fakeInstallment(46000, '2026-02-01'), fakeInstallment(46000, '2026-03-01')],
    });
    groupMovements$.mockReturnValue(of([mov]));

    await service.createSettlement({
      groupId: 'group1',
      fromUid: 'diego',
      toUid: 'tatiana',
      note: 'Cuota 1 de 2',
      personalMovementAccountId: null,
      allocationMode: 'manual',
      allocations: [{ movementId: mov.id, debtorUid: 'diego', installmentIndex: 0, full: true }],
    });

    expect(mockBatch.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        amount: 46000,
        allocationMode: 'manual',
        allocations: [{ movementId: mov.id, debtorUid: 'diego', installmentIndex: 0, amount: 46000 }],
      })
    );
  });

  // TEST OBLIGATORIO #3 — rechazos.
  describe('rechazos', () => {
    it('sobrepago a una deuda puntual (StaleDebtError)', async () => {
      const mov = fakeMovement('tatiana', [['tatiana', 0], ['diego', 100]]);
      groupMovements$.mockReturnValue(of([mov]));

      await expect(
        service.createSettlement({
          groupId: 'group1',
          fromUid: 'diego',
          toUid: 'tatiana',
          note: '',
          personalMovementAccountId: null,
          allocationMode: 'manual',
          allocations: [{ movementId: mov.id, debtorUid: 'diego', installmentIndex: null, amount: 100.01 }],
        })
      ).rejects.toThrow(StaleDebtError);
    });

    it('allocation en el sentido contrario (la deuda es de toUid hacia fromUid, no al revés)', async () => {
      // tatiana paga, diego debe -> la deuda es diego->tatiana, no tatiana->diego.
      const mov = fakeMovement('tatiana', [['tatiana', 0], ['diego', 100]]);
      groupMovements$.mockReturnValue(of([mov]));

      await expect(
        service.createSettlement({
          groupId: 'group1',
          fromUid: 'tatiana',
          toUid: 'diego',
          note: '',
          personalMovementAccountId: null,
          allocationMode: 'manual',
          allocations: [{ movementId: mov.id, debtorUid: 'diego', installmentIndex: null, amount: 50 }],
        })
      ).rejects.toThrow('no es entre estas dos personas');
    });

    it('la suma de las allocations no coincide con el amount declarado', async () => {
      const mov = fakeMovement('tatiana', [['tatiana', 0], ['diego', 100]]);
      groupMovements$.mockReturnValue(of([mov]));

      await expect(
        service.createSettlement({
          groupId: 'group1',
          fromUid: 'diego',
          toUid: 'tatiana',
          note: '',
          personalMovementAccountId: null,
          allocationMode: 'manual',
          allocations: [{ movementId: mov.id, debtorUid: 'diego', installmentIndex: null, amount: 40 }],
          amount: 50,
        })
      ).rejects.toThrow('no coincide');
    });

    it('quien llama no es fromUid ni toUid (variante manual)', async () => {
      await expect(
        service.createSettlement({
          groupId: 'group1',
          fromUid: 'tatiana',
          toUid: 'laura',
          note: '',
          personalMovementAccountId: null,
          allocationMode: 'manual',
          allocations: [{ movementId: 'm1', debtorUid: 'tatiana', installmentIndex: null, amount: 1 }],
        })
      ).rejects.toThrow('No eres parte de esta deuda.');
    });

    it('la deuda referenciada no existe (ya no está vigente, o es de otro grupo) — StaleDebtError', async () => {
      groupMovements$.mockReturnValue(of([]));

      await expect(
        service.createSettlement({
          groupId: 'group1',
          fromUid: 'diego',
          toUid: 'tatiana',
          note: '',
          personalMovementAccountId: null,
          allocationMode: 'manual',
          allocations: [{ movementId: 'no-existe', debtorUid: 'diego', installmentIndex: null, amount: 1 }],
        })
      ).rejects.toThrow(StaleDebtError);
    });
  });
});
