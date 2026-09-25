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
  // authStateChange no dispara solo por mockear addListener (es un stub que
  // solo resuelve una promesa, no un event bus real) — se captura el
  // callback para poder simularlo manualmente en los tests que lo necesitan.
  let authStateChangeCallback: ((event: { user: unknown }) => void) | undefined;
  // Objeto mutable: el stub de FirebaseJsAuth inyectado guarda esta misma
  // referencia, así que mutar currentUser() después de configurar el
  // TestBed sigue siendo visible para el servicio (evita reconfigurar/
  // reinyectar TestBed, que ya está instanciado tras el beforeEach).
  let firebaseJsAuthStub: {
    currentUser: { getIdToken: () => Promise<string> } | null;
    authStateReady: () => Promise<void>;
  };

  beforeEach(() => {
    authStateChangeCallback = undefined;
    firebaseJsAuthStub = { currentUser: null, authStateReady: vi.fn().mockResolvedValue(undefined) };
    vi.mocked(FirebaseAuthentication.getCurrentUser).mockReset().mockResolvedValue({ user: null });
    vi.mocked(FirebaseAuthentication.addListener)
      .mockReset()
      .mockImplementation(((eventName: string, callback: (event: { user: unknown }) => void) => {
        if (eventName === 'authStateChange') {
          authStateChangeCallback = callback;
        }
        return Promise.resolve({ remove: vi.fn() });
      }) as unknown as typeof FirebaseAuthentication.addListener);
    vi.mocked(FirebaseAuthentication.signInWithGoogle).mockReset();
    vi.mocked(FirebaseAuthentication.signOut).mockReset().mockResolvedValue(undefined);
    mockCredential.mockClear();
    mockSignInWithCredential.mockClear();
    mockJsSignOut.mockClear();

    TestBed.configureTestingModule({
      providers: [
        { provide: Firestore, useValue: {} },
        { provide: FirebaseJsAuth, useValue: firebaseJsAuthStub },
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

  it('is not admin with no user signed in', () => {
    expect(service.isAdmin).toBe(false);
  });

  it('is not admin for a regular (non-admin) user', () => {
    authStateChangeCallback?.({ user: { uid: 'some-regular-uid' } });

    expect(service.isAdmin).toBe(false);
  });

  it('is admin when the signed-in uid matches the hardcoded admin uid (same one as isAdmin() in firestore.rules)', () => {
    authStateChangeCallback?.({ user: { uid: 'jigrWtmRAraKgs6aJSS4OMq9gaX2' } });

    expect(service.isAdmin).toBe(true);
  });

  describe('getIdToken()', () => {
    it('returns null when there is no signed-in user in the Firebase JS SDK', async () => {
      await expect(service.getIdToken()).resolves.toBeNull();
    });

    it("returns the signed-in user's ID token", async () => {
      const mockGetIdToken = vi.fn().mockResolvedValue('fake-id-token');
      firebaseJsAuthStub.currentUser = { getIdToken: mockGetIdToken };

      await expect(service.getIdToken()).resolves.toBe('fake-id-token');
      expect(mockGetIdToken).toHaveBeenCalled();
    });

    // Regresión: el bug reportado era "No hay una sesión activa" en
    // Ajustes ("Uso de IA") con el usuario ya logueado — currentUser se
    // leía ANTES de que el SDK web terminara de restaurar su sesión. Este
    // test simula esa carrera exacta: currentUser sigue null cuando se
    // llama a getIdToken(), y solo se puebla justo antes de que
    // authStateReady() resuelva (como pasaría con la restauración real del
    // SDK al arrancar la app). Sin el await a authStateReady() en el fix,
    // este test fallaría (devolvería null en vez del token).
    it('waits for the Firebase JS SDK to finish restoring its session before reading currentUser', async () => {
      let resolveAuthStateReady!: () => void;
      firebaseJsAuthStub.authStateReady = vi.fn(
        () => new Promise<void>((resolve) => (resolveAuthStateReady = resolve))
      );
      const mockGetIdToken = vi.fn().mockResolvedValue('fake-id-token');

      const promise = service.getIdToken();
      // currentUser sigue null en este punto — si getIdToken() lo leyera
      // sin esperar, ya habría decidido devolver null.
      firebaseJsAuthStub.currentUser = { getIdToken: mockGetIdToken };
      resolveAuthStateReady();

      await expect(promise).resolves.toBe('fake-id-token');
    });
  });
});
