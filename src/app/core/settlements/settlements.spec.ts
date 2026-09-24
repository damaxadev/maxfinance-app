import { TestBed } from '@angular/core/testing';
import { Firestore, collectionData, getCountFromServer, getDocs } from '@angular/fire/firestore';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { firstValueFrom, of } from 'rxjs';
import { vi } from 'vitest';

import { Auth } from '../auth/auth';
import { Categories } from '../categories/categories';
import { SettlementsService } from './settlements';

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
  writeBatch: vi.fn(() => mockBatch),
  getDocs: vi.fn(),
  getCountFromServer: vi.fn(),
  Timestamp: { fromDate: vi.fn((d: Date) => ({ __ts: d.getTime() })) },
}));

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
  vi.mocked(getCountFromServer).mockClear();
  vi.mocked(FirebaseAuthentication.getCurrentUser).mockReset().mockResolvedValue({ user: null });
  vi.mocked(FirebaseAuthentication.addListener).mockReset().mockResolvedValue({ remove: vi.fn() });
}

describe('SettlementsService (current user is the payer, u1)', () => {
  let service: SettlementsService;
  const fakeUser = { uid: 'u1' };

  beforeEach(() => {
    resetHaptics();

    TestBed.configureTestingModule({
      providers: [
        { provide: Firestore, useValue: {} },
        { provide: Auth, useValue: { currentUser$: of(fakeUser), currentUser: fakeUser } },
        { provide: Categories, useValue: { categories$: of(fakeCategories) } },
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

  it('create(): registers the settlement without a linked movement by default', async () => {
    await service.create({
      groupId: 'group1',
      fromUid: 'u1',
      toUid: 'u2',
      amount: 50,
      note: '',
      personalMovementAccountId: null,
    });

    expect(mockBatch.set).toHaveBeenCalledTimes(1);
    expect(mockBatch.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ groupId: 'group1', fromUid: 'u1', toUid: 'u2', amount: 50, linkedMovementId: null })
    );
    expect(mockCommit).toHaveBeenCalled();
  });

  it('create(): as the payer (fromUid), links an expense movement under "Pago de deuda"', async () => {
    await service.create({
      groupId: 'group1',
      fromUid: 'u1',
      toUid: 'u2',
      amount: 50,
      note: 'Efectivo',
      personalMovementAccountId: 'acc1',
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

  it('countGroupSettlements(): reads the aggregation count for the group', async () => {
    vi.mocked(getCountFromServer).mockResolvedValueOnce({ data: () => ({ count: 3 }) } as never);

    const count = await service.countGroupSettlements('group1');

    expect(count).toBe(3);
  });
});

describe('SettlementsService (current user is the receiver, u2)', () => {
  let service: SettlementsService;
  const fakeUser = { uid: 'u2' };

  beforeEach(() => {
    resetHaptics();

    TestBed.configureTestingModule({
      providers: [
        { provide: Firestore, useValue: {} },
        { provide: Auth, useValue: { currentUser$: of(fakeUser), currentUser: fakeUser } },
        { provide: Categories, useValue: { categories$: of(fakeCategories) } },
      ],
    });
    service = TestBed.inject(SettlementsService);
  });

  it('create(): as the receiver (toUid), links an income movement under "Otros ingresos"', async () => {
    await service.create({
      groupId: 'group1',
      fromUid: 'u1',
      toUid: 'u2',
      amount: 50,
      note: '',
      personalMovementAccountId: 'acc2',
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
      ],
    });
    service = TestBed.inject(SettlementsService);
  });

  it('create(): throws a clear error if the base category is missing', async () => {
    await expect(
      service.create({
        groupId: 'group1',
        fromUid: 'u1',
        toUid: 'u2',
        amount: 50,
        note: '',
        personalMovementAccountId: 'acc1',
      })
    ).rejects.toThrow(/Pago de deuda/);
  });
});
