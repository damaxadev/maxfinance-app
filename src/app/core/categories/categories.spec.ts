import { TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { Auth } from '../auth/auth';
import { Categories } from './categories';

const { mockAddDoc, mockUpdateDoc, mockDeleteDoc } = vi.hoisted(() => ({
  mockAddDoc: vi.fn().mockResolvedValue({ id: 'new-category-id' }),
  mockUpdateDoc: vi.fn().mockResolvedValue(undefined),
  mockDeleteDoc: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@angular/fire/firestore', () => ({
  Firestore: class {},
  collection: vi.fn((_fs, path) => ({ path })),
  collectionData: vi.fn(() => of([])),
  doc: vi.fn((_fs, path, id) => ({ path, id })),
  addDoc: (...args: unknown[]) => mockAddDoc(...args),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  deleteDoc: (...args: unknown[]) => mockDeleteDoc(...args),
  query: vi.fn((...args: unknown[]) => args),
  where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
  or: vi.fn((...args: unknown[]) => ({ or: args })),
}));

describe('Categories', () => {
  let service: Categories;
  const fakeUser = { uid: 'u1' };

  beforeEach(() => {
    mockAddDoc.mockClear();
    mockUpdateDoc.mockClear();
    mockDeleteDoc.mockClear();
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
    service = TestBed.inject(Categories);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('creates a custom category owned by the current user', async () => {
    await service.create({ name: 'Mascotas', icon: '🐶', type: 'expense' });

    expect(mockAddDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ uid: 'u1', name: 'Mascotas', icon: '🐶', type: 'expense' })
    );
  });

  it('updates a category', async () => {
    await service.update('cat1', { name: 'Mascotas y vet', icon: '🐶', type: 'expense' });

    expect(mockUpdateDoc).toHaveBeenCalledWith(expect.anything(), {
      name: 'Mascotas y vet',
      icon: '🐶',
      type: 'expense',
    });
  });

  it('removes a category', async () => {
    await service.remove('cat1');

    expect(mockDeleteDoc).toHaveBeenCalled();
  });
});
