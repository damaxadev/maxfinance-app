import { Injectable, Injector, inject, runInInjectionContext } from '@angular/core';
import { BehaviorSubject, Observable, catchError, filter, map, of, switchMap } from 'rxjs';
import { FirebaseAuthentication, type User as AuthUser } from '@capacitor-firebase/authentication';
import { Firestore, doc, docData, getDoc, setDoc, updateDoc, serverTimestamp } from '@angular/fire/firestore';
import { Auth as FirebaseJsAuth } from '@angular/fire/auth';
import { GoogleAuthProvider, signInWithCredential, signOut as signOutFromFirebaseJsAuth } from 'firebase/auth';

import type { User } from '../../models/user.model';

// Mismo uid y mismo criterio que isAdmin() en firestore.rules — no hay
// nada secreto que proteger acá (el uid ya está committeado en las reglas),
// solo se replica del lado del cliente para poder mostrar/ocultar UI.
const ADMIN_UID = 'jigrWtmRAraKgs6aJSS4OMq9gaX2';

@Injectable({
  providedIn: 'root',
})
export class Auth {
  private readonly firestore = inject(Firestore);
  private readonly firebaseJsAuth = inject(FirebaseJsAuth);
  private readonly injector = inject(Injector);

  // undefined = todavía no se conoce el estado (sesión restaurándose).
  private readonly authState = new BehaviorSubject<AuthUser | null | undefined>(undefined);

  readonly currentUser$: Observable<AuthUser | null> = this.authState.pipe(
    filter((user): user is AuthUser | null => user !== undefined)
  );

  // Documento users/{uid} en vivo — a diferencia de AuthUser (que solo trae
  // lo que expone el SDK nativo de Google), esto tiene los campos propios de
  // MaxFinance (createdAt, phone) que Perfil necesita mostrar/editar.
  readonly userDocument$: Observable<User | null> = this.currentUser$.pipe(
    switchMap((user) => (user ? (docData(doc(this.firestore, 'users', user.uid)) as Observable<User | undefined>) : of(null))),
    map((data) => data ?? null),
    catchError((error) => {
      console.error('Error al leer el documento de usuario', error);
      return of(null);
    })
  );

  constructor() {
    void FirebaseAuthentication.getCurrentUser().then(({ user }) => {
      this.authState.next(user);
    });

    void FirebaseAuthentication.addListener('authStateChange', ({ user }) => {
      this.authState.next(user);
    });
  }

  get currentUser(): AuthUser | null {
    const value = this.authState.value;
    return value === undefined ? null : value;
  }

  get isAdmin(): boolean {
    return this.currentUser?.uid === ADMIN_UID;
  }

  async signInWithGoogle(): Promise<AuthUser | null> {
    const result = await FirebaseAuthentication.signInWithGoogle();

    // El login nativo autentica el SDK nativo, pero @angular/fire/firestore
    // usa el Auth JS SDK, que se queda sin sesión si no lo sincronizamos
    // explícitamente. Sin este paso, Firestore ve request.auth == null y
    // rechaza las escrituras con permission-denied.
    const idToken = result.credential?.idToken;
    if (!idToken) {
      throw new Error('Google Sign-In no devolvió un idToken; no se pudo sincronizar el SDK web de Firebase Auth.');
    }
    const credential = GoogleAuthProvider.credential(idToken, result.credential?.accessToken);
    await signInWithCredential(this.firebaseJsAuth, credential);

    if (result.user) {
      await this.ensureUserDocument(result.user);
    }
    return result.user;
  }

  // Token de Firebase para autenticar llamadas al Worker de IA (ver
  // AiSummary) — usa el SDK web (ya sincronizado en signInWithGoogle()),
  // no el nativo, porque es el mismo que Firestore ya usa para sus reglas.
  //
  // authStateReady() es obligatorio acá: el SDK web restaura su propia
  // sesión (desde su propia persistencia) en paralelo al SDK nativo, con su
  // propia línea de tiempo — leer firebaseJsAuth.currentUser de una vez,
  // sin esperar, puede devolver null aunque el usuario sí esté logueado
  // (mismo tipo de carrera que auth-guard.ts ya resuelve para el SDK
  // nativo esperando currentUser$ en vez de leer currentUser directo). Sin
  // esto, un componente que pide el token muy temprano en el arranque de la
  // app — como Settings, que no usa @defer (ver shell.html) — puede ver
  // "No hay una sesión activa" con el usuario ya autenticado.
  async getIdToken(): Promise<string | null> {
    await this.firebaseJsAuth.authStateReady();
    const user = this.firebaseJsAuth.currentUser;
    return user ? user.getIdToken() : null;
  }

  async signOut(): Promise<void> {
    await FirebaseAuthentication.signOut();
    await signOutFromFirebaseJsAuth(this.firebaseJsAuth);
  }

  async updateDisplayName(displayName: string): Promise<void> {
    const user = this.currentUser;
    if (!user) {
      throw new Error('No hay un usuario autenticado.');
    }

    await updateDoc(doc(this.firestore, 'users', user.uid), { displayName });
  }

  async updatePhone(phone: string): Promise<void> {
    const user = this.currentUser;
    if (!user) {
      throw new Error('No hay un usuario autenticado.');
    }

    await updateDoc(doc(this.firestore, 'users', user.uid), { phone: phone.trim() || null });
  }

  private async ensureUserDocument(user: AuthUser): Promise<void> {
    // Cada llamada se envuelve por separado: signInWithGoogle() ya hizo
    // varios `await` antes de llegar acá, así que el contexto de inyección
    // síncrono de Angular ya se perdió (runInInjectionContext solo cubre
    // la parte síncrona de su callback, no lo que sigue después de un await).
    const ref = runInInjectionContext(this.injector, () => doc(this.firestore, 'users', user.uid));
    const snapshot = await runInInjectionContext(this.injector, () => getDoc(ref));
    if (snapshot.exists()) {
      return;
    }

    const newUser: Omit<User, 'createdAt'> & { createdAt: ReturnType<typeof serverTimestamp> } = {
      uid: user.uid,
      displayName: user.displayName ?? '',
      email: user.email ?? '',
      photoURL: user.photoUrl ?? '',
      createdAt: serverTimestamp(),
    };
    await runInInjectionContext(this.injector, () => setDoc(ref, newUser));
  }
}
