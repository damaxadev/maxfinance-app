import { TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { Auth as FirebaseJsAuth } from '@angular/fire/auth';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { vi } from 'vitest';

import { Auth } from './auth';

// @capacitor-firebase/authentication se mockea globalmente en
// src/testing/setup-capacitor-firebase-auth-mock.ts (via `setupFiles`).
// Acá solo se configura/resetea para cada test.

// vi.mock(...) se hoistea por encima de los imports; para poder referenciar
// estos mocks desde dentro hay que declararlos con vi.hoisted().
const { mockCredential, mockSignInWithCredential, mockJsSignOut } = vi.hoisted(() => ({
  mockCredential: vi.fn().mockReturnValue('fake-credential'),
  mockSignInWithCredential: vi.fn().mockResolvedValue({ user: {} }),
  mockJsSignOut: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: { credential: mockCredential },
  signInWithCredential: mockSignInWithCredential,
  signOut: mockJsSignOut,
}));

describe('Auth', () => {
  let service: Auth;

  beforeEach(() => {
    vi.mocked(FirebaseAuthentication.getCurrentUser).mockReset().mockResolvedValue({ user: null });
    vi.mocked(FirebaseAuthentication.addListener).mockReset().mockResolvedValue({ remove: vi.fn() });
    vi.mocked(FirebaseAuthentication.signInWithGoogle).mockReset();
    vi.mocked(FirebaseAuthentication.signOut).mockReset().mockResolvedValue(undefined);
    mockCredential.mockClear();
    mockSignInWithCredential.mockClear();
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
    vi.mocked(FirebaseAuthentication.signInWithGoogle).mockResolvedValue({
      user: null,
      credential: { providerId: 'google.com', idToken: 'fake-id-token', accessToken: 'fake-access-token' },
    } as never);

    await service.signInWithGoogle();

    expect(mockCredential).toHaveBeenCalledWith('fake-id-token', 'fake-access-token');
    expect(mockSignInWithCredential).toHaveBeenCalledWith(expect.anything(), 'fake-credential');
  });

  it('throws if the native sign-in result has no idToken to sync', async () => {
    vi.mocked(FirebaseAuthentication.signInWithGoogle).mockResolvedValue({
      user: null,
      credential: { providerId: 'google.com' },
    } as never);

    await expect(service.signInWithGoogle()).rejects.toThrow();
    expect(mockSignInWithCredential).not.toHaveBeenCalled();
  });

  it('signs out of both the native plugin and the Firebase JS SDK', async () => {
    await service.signOut();

    expect(FirebaseAuthentication.signOut).toHaveBeenCalled();
    expect(mockJsSignOut).toHaveBeenCalledWith(expect.anything());
  });
});
