import { TestBed } from '@angular/core/testing';
import { Firestore, addDoc, collectionData, deleteDoc, doc, updateDoc } from '@angular/fire/firestore';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { Auth } from '../auth/auth';
import { RecurringPayments } from './recurring-payments';

vi.mock('@angular/fire/firestore', () => ({
  Firestore: class {},
  collection: vi.fn((_fs, path) => ({ path })),
  collectionData: vi.fn(() => of([])),
  addDoc: vi.fn().mockResolvedValue({ id: 'auto-id' }),
  updateDoc: vi.fn().mockResolvedValue(undefined),
  deleteDoc: vi.fn().mockResolvedValue(undefined),
  doc: vi.fn((_fs, path, id) => ({ path, id })),
  query: vi.fn((...args: unknown[]) => args),
  where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
  Timestamp: { fromDate: vi.fn((d: Date) => ({ __ts: d.getTime() })) },
}));

describe('RecurringPayments', () => {
  let service: RecurringPayments;
  const fakeUser = { uid: 'u1' };

  beforeEach(() => {
    vi.mocked(collectionData).mockClear().mockReturnValue(of([]));
    vi.mocked(addDoc).mockClear().mockResolvedValue({ id: 'auto-id' } as never);
    vi.mocked(updateDoc).mockClear().mockResolvedValue(undefined);
    vi.mocked(deleteDoc).mockClear().mockResolvedValue(undefined);

    TestBed.configureTestingModule({
      providers: [
        { provide: Firestore, useValue: {} },
        { provide: Auth, useValue: { currentUser$: of(fakeUser), currentUser: fakeUser } },
      ],
    });
    service = TestBed.inject(RecurringPayments);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('personalRecurringPayments$: queries by uid and groupId==null', async () => {
    const fakePayment = { id: 'r1', uid: 'u1', groupId: null, name: 'Netflix', amount: 30000 };
    vi.mocked(collectionData).mockReturnValueOnce(of([fakePayment]));

    const result = await new Promise((resolve) => service.personalRecurringPayments$.subscribe(resolve));

    expect(result).toEqual([fakePayment]);
  });

  it('create(): adds a personal recurring payment (uid set, groupId null)', async () => {
    await service.create({
      name: 'Netflix',
      amount: 30000,
      categoryId: 'cat1',
      accountId: 'acc1',
      frequency: 'monthly',
      nextDate: new Date('2026-04-01'),
      active: true,
    });

    expect(addDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ uid: 'u1', groupId: null, name: 'Netflix', amount: 30000, active: true })
    );
  });

  it('update(): updates the fields without touching uid/groupId', async () => {
    await service.update('r1', {
      name: 'Netflix Premium',
      amount: 45000,
      categoryId: 'cat1',
      accountId: 'acc1',
      frequency: 'monthly',
      nextDate: new Date('2026-04-01'),
      active: false,
    });

    expect(updateDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'recurringPayments', id: 'r1' }),
      expect.objectContaining({ name: 'Netflix Premium', amount: 45000, active: false })
    );
  });

  it('remove(): deletes the document', async () => {
    await service.remove('r1');

    expect(deleteDoc).toHaveBeenCalledWith(expect.objectContaining({ path: 'recurringPayments', id: 'r1' }));
  });
});
