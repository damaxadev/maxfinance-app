import { TestBed } from '@angular/core/testing';
import { Firestore, collectionData, doc, setDoc } from '@angular/fire/firestore';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { Auth } from '../auth/auth';
import { Budgets } from './budgets';

vi.mock('@angular/fire/firestore', () => ({
  Firestore: class {},
  collection: vi.fn((_fs, path) => ({ path })),
  collectionData: vi.fn(() => of([])),
  doc: vi.fn((_fs, path, id) => ({ path, id })),
  setDoc: vi.fn().mockResolvedValue(undefined),
  query: vi.fn((...args: unknown[]) => args),
  where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
}));

describe('Budgets', () => {
  let service: Budgets;
  const fakeUser = { uid: 'u1' };

  beforeEach(() => {
    vi.mocked(collectionData).mockClear().mockReturnValue(of([]));
    vi.mocked(setDoc).mockClear().mockResolvedValue(undefined);
    vi.mocked(doc).mockClear();

    TestBed.configureTestingModule({
      providers: [
        { provide: Firestore, useValue: {} },
        { provide: Auth, useValue: { currentUser$: of(fakeUser), currentUser: fakeUser } },
      ],
    });
    service = TestBed.inject(Budgets);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('budgetsForMonth$(): queries by uid and month', async () => {
    const fakeBudget = { id: 'b1', uid: 'u1', categoryId: 'cat1', month: '2026-03', limit: 200 };
    vi.mocked(collectionData).mockReturnValueOnce(of([fakeBudget]));

    const result = await new Promise((resolve) => service.budgetsForMonth$('2026-03').subscribe(resolve));

    expect(result).toEqual([fakeBudget]);
  });

  it('setLimit(): writes to a deterministic id (uid_categoryId_month)', async () => {
    await service.setLimit({ categoryId: 'cat1', month: '2026-03', limit: 200 });

    expect(doc).toHaveBeenCalledWith(expect.anything(), 'budgets', 'u1_cat1_2026-03');
    expect(setDoc).toHaveBeenCalledWith(
      { path: 'budgets', id: 'u1_cat1_2026-03' },
      { uid: 'u1', categoryId: 'cat1', month: '2026-03', limit: 200 }
    );
  });
});
