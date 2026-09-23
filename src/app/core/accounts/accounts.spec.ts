import { TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { Auth } from '../auth/auth';
import { Accounts } from './accounts';

const { mockAddDoc, mockUpdateDoc, mockDeleteDoc, mockGetDocs } = vi.hoisted(() => ({
  mockAddDoc: vi.fn().mockResolvedValue({ id: 'new-account-id' }),
  mockUpdateDoc: vi.fn().mockResolvedValue(undefined),
  mockDeleteDoc: vi.fn().mockResolvedValue(undefined),
  mockGetDocs: vi.fn().mockResolvedValue({ empty: true }),
}));

vi.mock('@angular/fire/firestore', () => ({
  Firestore: class {},
  collection: vi.fn((_fs, path) => ({ path })),
  collectionData: vi.fn(() => of([])),
  doc: vi.fn((_fs, path, id) => ({ path, id })),
  addDoc: (...args: unknown[]) => mockAddDoc(...args),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  deleteDoc: (...args: unknown[]) => mockDeleteDoc(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  query: vi.fn((...args: unknown[]) => args),
  where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
  limit: vi.fn((n: number) => ({ limit: n })),
}));

describe('Accounts', () => {
  let service: Accounts;
  const fakeUser = { uid: 'u1' };

  beforeEach(() => {
    mockAddDoc.mockClear();
    mockUpdateDoc.mockClear();
    mockDeleteDoc.mockClear();
    mockGetDocs.mockClear().mockResolvedValue({ empty: true });
    // Accounts importa Auth, cuyo módulo importa @capacitor-firebase/authentication
    // a nivel de módulo — mockeado globalmente, solo hay que resetearlo acá.
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
    service = TestBed.inject(Accounts);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('creates an account owned by the current user with balance 0 and COP', async () => {
    await service.create({ name: 'Efectivo', type: 'efectivo' });

    expect(mockAddDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ uid: 'u1', name: 'Efectivo', type: 'efectivo', balance: 0, currency: 'COP' })
    );
  });

  it('updates only name and type', async () => {
    await service.update('acc1', { name: 'Ahorros', type: 'banco' });

    expect(mockUpdateDoc).toHaveBeenCalledWith(expect.anything(), { name: 'Ahorros', type: 'banco' });
  });

  it('removes an account with no linked movements', async () => {
    mockGetDocs.mockResolvedValue({ empty: true });

    await service.remove('acc1');

    expect(mockDeleteDoc).toHaveBeenCalled();
  });

  it('refuses to remove an account that still has movements', async () => {
    mockGetDocs.mockResolvedValue({ empty: false });

    await expect(service.remove('acc1')).rejects.toThrow(/movimientos/);
    expect(mockDeleteDoc).not.toHaveBeenCalled();
  });
});
