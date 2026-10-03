import { TestBed } from '@angular/core/testing';
import { Firestore, collectionData, getCountFromServer } from '@angular/fire/firestore';
import { Functions } from '@angular/fire/functions';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { firstValueFrom, of } from 'rxjs';
import { vi } from 'vitest';

import { Auth } from '../auth/auth';
import { AttachmentsService } from '../attachments/attachments';
import { MovementsService } from './movements';
import type { MovementSplit, PersonalMovement, SharedMovement } from '../../models/movement.model';

const { mockBatch, mockCommit, mockCallable, mockHttpsCallable, mockUpdateDoc } = vi.hoisted(() => {
  const commit = vi.fn().mockResolvedValue(undefined);
  return {
    mockCommit: commit,
    mockBatch: {
      set: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      commit,
    },
    mockCallable: vi.fn().mockResolvedValue({ data: { settlementId: 's1' } }),
    mockHttpsCallable: vi.fn(),
    mockUpdateDoc: vi.fn().mockResolvedValue(undefined),
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
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  Timestamp: { fromDate: vi.fn((d: Date) => ({ __ts: d.getTime() })) },
}));

vi.mock('@angular/fire/functions', () => ({
  Functions: class {},
  httpsCallable: (...args: unknown[]) => mockHttpsCallable(...args),
}));

describe('MovementsService', () => {
  let service: MovementsService;
  let attachmentUpload: ReturnType<typeof vi.fn>;
  let attachmentRemove: ReturnType<typeof vi.fn>;
  const fakeUser = { uid: 'u1' };

  beforeEach(() => {
    mockBatch.set.mockClear();
    mockBatch.update.mockClear();
    mockBatch.delete.mockClear();
    mockCommit.mockClear();
    mockHttpsCallable.mockClear().mockReturnValue(mockCallable);
    mockCallable.mockClear().mockResolvedValue({ data: { settlementId: 's1' } });
    mockUpdateDoc.mockClear().mockResolvedValue(undefined);
    vi.mocked(collectionData).mockClear().mockReturnValue(of([]));
    vi.mocked(getCountFromServer).mockClear();
    vi.mocked(FirebaseAuthentication.getCurrentUser).mockReset().mockResolvedValue({ user: null });
    vi.mocked(FirebaseAuthentication.addListener).mockReset().mockResolvedValue({ remove: vi.fn() });
    attachmentUpload = vi.fn().mockResolvedValue(undefined);
    attachmentRemove = vi.fn().mockResolvedValue(undefined);

    TestBed.configureTestingModule({
      providers: [
        { provide: Firestore, useValue: {} },
        { provide: Functions, useValue: {} },
        {
          provide: Auth,
          useValue: { currentUser$: of(fakeUser), currentUser: fakeUser },
        },
        { provide: AttachmentsService, useValue: { upload: attachmentUpload, remove: attachmentRemove } },
      ],
    });
    service = TestBed.inject(MovementsService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('create(): resolves with the new movement id', async () => {
    const id = await service.create({
      type: 'expense',
      amount: 100,
      accountId: 'acc1',
      categoryId: 'cat1',
      date: new Date('2026-01-15'),
      note: '',
    });

    expect(id).toMatch(/^auto-id-/);
  });

  it('createShared(): resolves with the new movement id', async () => {
    const id = await service.createShared({
      groupId: 'group1',
      paidBy: 'u1',
      amount: 100,
      accountId: 'acc1',
      categoryId: 'cat1',
      categoryName: 'Comida',
      categoryIcon: '🍔',
      splitType: 'equal',
      splits: [{ uid: 'u1', amount: 100, settled: false }],
      date: new Date('2026-01-15'),
      note: '',
    });

    expect(id).toMatch(/^auto-id-/);
  });

  describe('attachFile()', () => {
    it('uploads the blob to a fixed path and writes attachmentPath/attachmentContentType on the movement', async () => {
      const blob = new Blob(['x']);
      await service.attachFile('mov1', { blob, contentType: 'image/jpeg' });

      expect(attachmentUpload).toHaveBeenCalledWith('movements/mov1/attachment', blob, 'image/jpeg');
      expect(mockUpdateDoc).toHaveBeenCalledWith(expect.objectContaining({ id: 'mov1' }), {
        attachmentPath: 'movements/mov1/attachment',
        attachmentContentType: 'image/jpeg',
      });
    });
  });

  describe('remove()/removeShared() — Storage cleanup', () => {
    it('remove(): best-effort deletes the attachment when the personal movement had one', async () => {
      const movement: PersonalMovement = {
        uid: 'u1',
        accountId: 'acc1',
        categoryId: 'cat1',
        type: 'expense',
        amount: 100,
        date: { toMillis: () => 0 } as never,
        note: '',
        groupId: null,
        attachmentPath: 'movements/mov1/attachment',
      };

      await service.remove('mov1', movement);

      expect(attachmentRemove).toHaveBeenCalledWith('movements/mov1/attachment');
    });

    it('remove(): does not touch Storage when there was no attachment', async () => {
      const movement: PersonalMovement = {
        uid: 'u1',
        accountId: 'acc1',
        categoryId: 'cat1',
        type: 'expense',
        amount: 100,
        date: { toMillis: () => 0 } as never,
        note: '',
        groupId: null,
      };

      await service.remove('mov1', movement);

      expect(attachmentRemove).not.toHaveBeenCalled();
    });

    it('removeShared(): best-effort deletes the attachment when the shared movement had one', async () => {
      const movement: SharedMovement = {
        uid: 'u1',
        categoryId: 'cat1',
        type: 'expense',
        amount: 100,
        date: { toMillis: () => 0 } as never,
        note: '',
        groupId: 'group1',
        paidBy: 'u1',
        splitType: 'equal',
        splits: [{ uid: 'u1', amount: 100, settled: false }],
        accountId: 'acc1',
        attachmentPath: 'movements/mov1/attachment',
      };

      await service.removeShared('mov1', movement);

      expect(attachmentRemove).toHaveBeenCalledWith('movements/mov1/attachment');
    });
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

  it('create(): tags the movement with groupId when creating an expense inside a personal group (Fase 9)', async () => {
    await service.create(
      {
        type: 'expense',
        amount: 80000,
        accountId: 'acc1',
        categoryId: 'cat1',
        date: new Date('2026-01-15'),
        note: 'Arriendo',
      },
      'personal-group-1'
    );

    expect(mockBatch.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ groupId: 'personal-group-1' })
    );
    // Sigue siendo un movimiento personal en todo lo demás — mismo efecto
    // sobre la cuenta, sin paidBy/splitType/splits.
    expect(mockBatch.update).toHaveBeenCalledWith(expect.anything(), {
      balance: { __op: 'increment', value: -80000 },
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
      categoryName: 'Comida',
      categoryIcon: '🍔',
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
        categoryName: 'Comida',
        categoryIcon: '🍔',
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
      categoryName: 'Comida',
      categoryIcon: '🍔',
      splitType: 'equal',
      splits,
      date: new Date('2026-01-15'),
      note: '',
    });

    expect(mockBatch.set).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ accountId: null }));
    expect(mockBatch.update).not.toHaveBeenCalled();
    expect(mockCommit).toHaveBeenCalled();
  });

  it('createShared(): stores null category fields when no category was selected', async () => {
    const splits: MovementSplit[] = [{ uid: 'u1', amount: 100, settled: false }];

    await service.createShared({
      groupId: 'group1',
      paidBy: 'u1',
      amount: 100,
      accountId: null,
      categoryId: null,
      categoryName: null,
      categoryIcon: null,
      splitType: 'equal',
      splits,
      date: new Date('2026-01-15'),
      note: '',
    });

    expect(mockBatch.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ categoryId: null, categoryName: null, categoryIcon: null })
    );
  });

  it('createShared(): stores the installment plan and sets hasPendingInstallments when present', async () => {
    const splits: MovementSplit[] = [
      { uid: 'u1', amount: 50, settled: false },
      { uid: 'u2', amount: 50, settled: false },
    ];
    const installments = [
      { dueDate: { __ts: 1 } as never, amount: 25, status: 'pending' as const },
      { dueDate: { __ts: 2 } as never, amount: 25, status: 'pending' as const },
    ];

    await service.createShared({
      groupId: 'group1',
      paidBy: 'u1',
      amount: 100,
      accountId: null,
      categoryId: 'cat1',
      categoryName: 'Comida',
      categoryIcon: '🍔',
      splitType: 'equal',
      splits,
      date: new Date('2026-01-15'),
      note: '',
      installments,
    });

    expect(mockBatch.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ installments, hasPendingInstallments: true })
    );
  });

  it('createShared(): stores null installments and hasPendingInstallments: false when there is no plan', async () => {
    const splits: MovementSplit[] = [{ uid: 'u1', amount: 100, settled: false }];

    await service.createShared({
      groupId: 'group1',
      paidBy: 'u1',
      amount: 100,
      accountId: null,
      categoryId: null,
      categoryName: null,
      categoryIcon: null,
      splitType: 'equal',
      splits,
      date: new Date('2026-01-15'),
      note: '',
    });

    expect(mockBatch.set).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ installments: null, hasPendingInstallments: false })
    );
  });

  describe('payInstallment()', () => {
    it('calls the payInstallment Cloud Function with the movement id, installment index, and note', async () => {
      await service.payInstallment('mov1', 2, 'Cuota 3 de 6');

      expect(mockHttpsCallable).toHaveBeenCalledWith(expect.anything(), 'payInstallment');
      expect(mockCallable).toHaveBeenCalledWith({ movementId: 'mov1', installmentIndex: 2, note: 'Cuota 3 de 6' });
    });

    it('translates a thrown error into a plain Error with the server message', async () => {
      mockCallable.mockRejectedValueOnce(new Error('Esa cuota ya está pagada.'));

      await expect(service.payInstallment('mov1', 0, '')).rejects.toThrow('Esa cuota ya está pagada.');
    });
  });

  describe('updateShared()', () => {
    const previous: SharedMovement = {
      uid: 'u1',
      categoryId: 'cat1',
      categoryName: 'Comida',
      categoryIcon: '🍔',
      type: 'expense',
      amount: 100,
      date: { toMillis: () => 0 } as never,
      note: '',
      groupId: 'group1',
      paidBy: 'u1',
      splitType: 'equal',
      splits: [{ uid: 'u1', amount: 50, settled: false }],
      accountId: 'acc1',
    };

    function nextValue(overrides: Partial<Record<string, unknown>> = {}) {
      return {
        groupId: 'group1',
        paidBy: 'u1',
        amount: 150,
        accountId: 'acc1',
        categoryId: 'cat1',
        categoryName: 'Comida',
        categoryIcon: '🍔',
        splitType: 'equal' as const,
        splits: [{ uid: 'u1', amount: 75, settled: false }],
        date: new Date('2026-01-20'),
        note: 'editado',
        ...overrides,
      };
    }

    it('adjusts the same account by the delta when the account is unchanged', async () => {
      await service.updateShared('mov1', previous, nextValue());

      expect(mockBatch.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'acc1' }), {
        balance: { __op: 'increment', value: -50 },
      });
    });

    it('reverses the old account and applies to the new account when the account changes', async () => {
      await service.updateShared('mov1', previous, nextValue({ accountId: 'acc2' }));

      expect(mockBatch.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'acc1' }), {
        balance: { __op: 'increment', value: 100 },
      });
      expect(mockBatch.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'acc2' }), {
        balance: { __op: 'increment', value: -150 },
      });
    });

    it('applies to the new account when there was none before', async () => {
      const previousWithoutAccount: SharedMovement = { ...previous, accountId: null };

      await service.updateShared('mov1', previousWithoutAccount, nextValue({ accountId: 'acc1' }));

      expect(mockBatch.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'acc1' }), {
        balance: { __op: 'increment', value: -150 },
      });
    });

    it('reverses the old account and touches no other account when the account is removed', async () => {
      await service.updateShared('mov1', previous, nextValue({ accountId: null }));

      expect(mockBatch.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'acc1' }), {
        balance: { __op: 'increment', value: 100 },
      });
      // Una sola llamada a accounts (acc1) además de la del propio movement.
      const accountUpdates = mockBatch.update.mock.calls.filter(([ref]) => (ref as { path: string }).path === 'accounts');
      expect(accountUpdates.length).toBe(1);
    });

    it('writes the updated fields onto the movement document', async () => {
      await service.updateShared('mov1', previous, nextValue({ note: 'editado de nuevo' }));

      expect(mockBatch.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'mov1' }),
        expect.objectContaining({ amount: 150, note: 'editado de nuevo' })
      );
    });
  });

  describe('removeShared()', () => {
    it('reverses the account balance when the movement had one', async () => {
      const movement: SharedMovement = {
        uid: 'u1',
        categoryId: 'cat1',
        type: 'expense',
        amount: 100,
        date: { toMillis: () => 0 } as never,
        note: '',
        groupId: 'group1',
        paidBy: 'u1',
        splitType: 'equal',
        splits: [{ uid: 'u1', amount: 100, settled: false }],
        accountId: 'acc1',
      };

      await service.removeShared('mov1', movement);

      expect(mockBatch.delete).toHaveBeenCalled();
      expect(mockBatch.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'acc1' }), {
        balance: { __op: 'increment', value: 100 },
      });
    });

    it('does not touch any account when the movement had none', async () => {
      const movement: SharedMovement = {
        uid: 'u2',
        categoryId: 'cat1',
        type: 'expense',
        amount: 100,
        date: { toMillis: () => 0 } as never,
        note: '',
        groupId: 'group1',
        paidBy: 'u2',
        splitType: 'equal',
        splits: [{ uid: 'u2', amount: 100, settled: false }],
        accountId: null,
      };

      await service.removeShared('mov1', movement);

      expect(mockBatch.delete).toHaveBeenCalled();
      expect(mockBatch.update).not.toHaveBeenCalled();
    });
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
