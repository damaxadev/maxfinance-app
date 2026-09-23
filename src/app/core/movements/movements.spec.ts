import { TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { Auth } from '../auth/auth';
import { MovementsService } from './movements';
import type { PersonalMovement } from '../../models/movement.model';

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

vi.mock('@angular/fire/firestore', () => ({
  Firestore: class {},
  collection: vi.fn((_fs, path) => ({ path })),
  collectionData: vi.fn(() => of([])),
  doc: vi.fn((_fs, path, id) => ({ path, id })),
  query: vi.fn((...args: unknown[]) => args),
  where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
  increment: vi.fn((n: number) => ({ __op: 'increment', value: n })),
  writeBatch: vi.fn(() => mockBatch),
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
});
