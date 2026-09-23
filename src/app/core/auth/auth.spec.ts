import { TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { Auth as FirebaseJsAuth } from '@angular/fire/auth';
import { vi } from 'vitest';

import { Auth } from './auth';

// vi.mock(...) se hoistea por encima de los imports; para poder referenciar
// estos mocks desde dentro hay que declararlos con vi.hoisted().
const {
  mockSignInWithGoogle,
  mockCredential,
  mockSignInWithCredential,
  mockNativeSignOut,
  mockJsSignOut,
} = vi.hoisted(() => ({
  mockSignInWithGoogle: vi.fn(),
  mockCredential: vi.fn().mockReturnValue('fake-credential'),
  mockSignInWithCredential: vi.fn().mockResolvedValue({ user: {} }),
  mockNativeSignOut: vi.fn().mockResolvedValue(undefined),
  mockJsSignOut: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@capacitor-firebase/authentication', () => ({
  FirebaseAuthentication: {
    getCurrentUser: vi.fn().mockResolvedValue({ user: null }),
    addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
    signInWithGoogle: mockSignInWithGoogle,
    signOut: mockNativeSignOut,
  },
}));

vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: { credential: mockCredential },
  signInWithCredential: mockSignInWithCredential,
  signOut: mockJsSignOut,
}));

describe('Auth', () => {
  let service: Auth;

  beforeEach(() => {
    mockSignInWithGoogle.mockReset();
    mockCredential.mockClear();
    mockSignInWithCredential.mockClear();
    mockNativeSignOut.mockClear();
    mockJsSignOut.mockClear();

    TestBed.configureTestingModule({
      providers: [
        { provide: Firestore, useValue: {} },
        { provide: FirebaseJsAuth, useValue: {} },
      ],
    });
    service = TestBed.inject(Auth);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('resolves currentUser$ to null once the restored session is known', async () => {
    const user = await new Promise((resolve) => {
      service.currentUser$.subscribe(resolve);
    });
    expect(user).toBeNull();
  });

  it('syncs the Firebase JS SDK with signInWithCredential() when the native result has an idToken', async () => {
    mockSignInWithGoogle.mockResolvedValue({
      user: null,
      credential: { providerId: 'google.com', idToken: 'fake-id-token', accessToken: 'fake-access-token' },
    });

    await service.signInWithGoogle();

    expect(mockCredential).toHaveBeenCalledWith('fake-id-token', 'fake-access-token');
    expect(mockSignInWithCredential).toHaveBeenCalledWith(expect.anything(), 'fake-credential');
  });

  it('throws if the native sign-in result has no idToken to sync', async () => {
    mockSignInWithGoogle.mockResolvedValue({
      user: null,
      credential: { providerId: 'google.com' },
    });

    await expect(service.signInWithGoogle()).rejects.toThrow();
    expect(mockSignInWithCredential).not.toHaveBeenCalled();
  });

  it('signs out of both the native plugin and the Firebase JS SDK', async () => {
    await service.signOut();

    expect(mockNativeSignOut).toHaveBeenCalled();
    expect(mockJsSignOut).toHaveBeenCalledWith(expect.anything());
  });
});
