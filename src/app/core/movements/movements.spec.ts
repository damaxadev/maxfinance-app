import { TestBed } from '@angular/core/testing';
import { Firestore, collectionData, getCountFromServer } from '@angular/fire/firestore';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { firstValueFrom, of } from 'rxjs';
import { vi } from 'vitest';

import { Auth } from '../auth/auth';
import { MovementsService } from './movements';
import type { MovementSplit, PersonalMovement } from '../../models/movement.model';

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
  // (un solo argumento) autogenera uno — como lo hace MovementsService al
  // crear un movement nuevo (personal o compartido).
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
  getCountFromServer: vi.fn(),
  Timestamp: { fromDate: vi.fn((d: Date) => ({ __ts: d.getTime() })) },
}));

describe('MovementsService', () => {
  let service: MovementsService;
  const fakeUser = { uid: 'u1' };

  beforeEach(() => {
    mockBatch.set.mockClear();
    mockBatch.update.mockClear();
    mockBatch.delete.mockClear();
    mockCommit.mockClear();
    vi.mocked(collectionData).mockClear().mockReturnValue(of([]));
    vi.mocked(getCountFromServer).mockClear();
    vi.mocked(FirebaseAuthentication.getCurrentUser).mockReset().mockResolvedValue({ user: null });
    vi.mocked(FirebaseAuthentication.addListener).mockReset().mockResolvedValue({ remove: vi.fn() });

    TestBed.configureTestingModule({
      providers: [
        { provide: Firestore, useValue: {} },
        {
          provide: Auth,
          useValue: { currentUser$: of(fakeUser), currentUser: fakeUser },
        },
      ],
    });
    service = TestBed.inject(MovementsService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('create(): adds the movement and increments the account balance for income', async () => {
    await service.create({
      type: 'income',
      amount: 500,
      accountId: 'acc1',
      categoryId: 'cat1',
      date: new Date('2026-01-15'),
      note: 'Salario',
    });

    expect(mockBatch.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ uid: 'u1', type: 'income', amount: 500, groupId: null })
    );
    expect(mockBatch.update).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'accounts', id: 'acc1' }),
      { balance: { __op: 'increment', value: 500 } }
    );
    expect(mockCommit).toHaveBeenCalled();
  });

  it('create(): decrements the account balance for an expense', async () => {
    await service.create({
      type: 'expense',
      amount: 120,
      accountId: 'acc1',
      categoryId: 'cat1',
      date: new Date('2026-01-15'),
      note: 'Comida',
    });

    expect(mockBatch.update).toHaveBeenCalledWith(expect.anything(), {
      balance: { __op: 'increment', value: -120 },
    });
  });

  it('update(): adjusts the same account by the delta when the account is unchanged', async () => {
    const previous: PersonalMovement = {
      uid: 'u1',
      accountId: 'acc1',
      categoryId: 'cat1',
      type: 'expense',
      amount: 100,
      date: { toMillis: () => 0 } as never,
      note: '',
      groupId: null,
    };

    await service.update('mov1', previous, {
      type: 'expense',
      amount: 150,
      accountId: 'acc1',
      categoryId: 'cat1',
      date: new Date('2026-01-15'),
      note: 'ajustado',
    });

    // old signed = -100, new signed = -150 -> delta = -50
    expect(mockBatch.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'acc1' }), {
      balance: { __op: 'increment', value: -50 },
    });
  });

  it('update(): reverses the old account and applies to the new account when the account changes', async () => {
    const previous: PersonalMovement = {
      uid: 'u1',
      accountId: 'acc1',
      categoryId: 'cat1',
      type: 'expense',
      amount: 100,
      date: { toMillis: () => 0 } as never,
      note: '',
      groupId: null,
    };

    await service.update('mov1', previous, {
      type: 'expense',
      amount: 100,
      accountId: 'acc2',
      categoryId: 'cat1',
      date: new Date('2026-01-15'),
      note: '',
    });

    expect(mockBatch.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'acc1' }), {
      balance: { __op: 'increment', value: 100 },
    });
    expect(mockBatch.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'acc2' }), {
      balance: { __op: 'increment', value: -100 },
    });
  });

  it('remove(): reverses the signed amount on the account', async () => {
    const movement: PersonalMovement = {
      uid: 'u1',
      accountId: 'acc1',
      categoryId: 'cat1',
      type: 'income',
      amount: 500,
      date: { toMillis: () => 0 } as never,
      note: '',
      groupId: null,
    };

    await service.remove('mov1', movement);

    expect(mockBatch.delete).toHaveBeenCalled();
    expect(mockBatch.update).toHaveBeenCalledWith(expect.anything(), {
      balance: { __op: 'increment', value: -500 },
    });
  });

  it('groupMovements$(): queries by groupId and returns the group shared movements', async () => {
    const fakeSharedMovement = { id: 'sm1', groupId: 'group1', paidBy: 'u1', amount: 100 };
    vi.mocked(collectionData).mockReturnValueOnce(of([fakeSharedMovement]));

    const result = await firstValueFrom(service.groupMovements$('group1'));

    expect(result).toEqual([fakeSharedMovement]);
  });

  it('createShared(): adds the movement and decrements the payer account when accountId is provided', async () => {
    const splits: MovementSplit[] = [
      { uid: 'u1', amount: 50, settled: false },
      { uid: 'u2', amount: 50, settled: false },
    ];

    await service.createShared({
      groupId: 'group1',
      paidBy: 'u1',
      amount: 100,
      accountId: 'acc1',
      categoryId: 'cat1',
      splitType: 'equal',
      splits,
      date: new Date('2026-01-15'),
      note: 'Cena',
    });

    expect(mockBatch.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        uid: 'u1',
        type: 'expense',
        amount: 100,
        groupId: 'group1',
        paidBy: 'u1',
        splitType: 'equal',
        splits,
        accountId: 'acc1',
      })
    );
    expect(mockBatch.update).toHaveBeenCalledWith(expect.objectContaining({ path: 'accounts', id: 'acc1' }), {
      balance: { __op: 'increment', value: -100 },
    });
    expect(mockCommit).toHaveBeenCalled();
  });

  it('createShared(): does not touch any account when accountId is null (payer is someone else)', async () => {
    const splits: MovementSplit[] = [{ uid: 'u2', amount: 100, settled: false }];

    await service.createShared({
      groupId: 'group1',
      paidBy: 'u2',
      amount: 100,
      accountId: null,
      categoryId: 'cat1',
      splitType: 'equal',
      splits,
      date: new Date('2026-01-15'),
      note: '',
    });

    expect(mockBatch.set).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ accountId: null }));
    expect(mockBatch.update).not.toHaveBeenCalled();
    expect(mockCommit).toHaveBeenCalled();
  });

  it('sharedMovementsForGroups$(): runs one query per group and flattens the results', async () => {
    const inGroup1 = { id: 'sm1', groupId: 'group1', uid: 'u1', amount: 30 };
    const inGroup2 = { id: 'sm2', groupId: 'group2', uid: 'u1', amount: 40 };
    vi.mocked(collectionData).mockReturnValueOnce(of([inGroup1])).mockReturnValueOnce(of([inGroup2]));

    const result = await firstValueFrom(service.sharedMovementsForGroups$(['group1', 'group2']));

    expect(result).toEqual([inGroup1, inGroup2]);
  });

  it('sharedMovementsForGroups$(): returns an empty array without querying when there are no groups', async () => {
    const result = await firstValueFrom(service.sharedMovementsForGroups$([]));

    expect(result).toEqual([]);
    expect(collectionData).not.toHaveBeenCalled();
  });

  it('allSharedMovementsForGroups$(): runs one query per group (any registrar) and flattens the results', async () => {
    const inGroup1 = { id: 'sm1', groupId: 'group1', uid: 'u2', paidBy: 'u2', amount: 30 };
    const inGroup2 = { id: 'sm2', groupId: 'group2', uid: 'u3', paidBy: 'u3', amount: 40 };
    vi.mocked(collectionData).mockReturnValueOnce(of([inGroup1])).mockReturnValueOnce(of([inGroup2]));

    const result = await firstValueFrom(service.allSharedMovementsForGroups$(['group1', 'group2']));

    expect(result).toEqual([inGroup1, inGroup2]);
  });

  it('allSharedMovementsForGroups$(): returns an empty array without querying when there are no groups', async () => {
    const result = await firstValueFrom(service.allSharedMovementsForGroups$([]));

    expect(result).toEqual([]);
    expect(collectionData).not.toHaveBeenCalled();
  });

  it('countGroupMovements(): reads the aggregation count for the group', async () => {
    vi.mocked(getCountFromServer).mockResolvedValueOnce({ data: () => ({ count: 7 }) } as never);

    const count = await service.countGroupMovements('group1');

    expect(count).toBe(7);
  });
});
