import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, filter } from 'rxjs';
import { FirebaseAuthentication, type User as AuthUser } from '@capacitor-firebase/authentication';
import { Firestore, doc, getDoc, setDoc, updateDoc, serverTimestamp } from '@angular/fire/firestore';

import type { User } from '../../models/user.model';

@Injectable({
  providedIn: 'root',
})
export class Auth {
  private readonly firestore = inject(Firestore);

  // undefined = todavía no se conoce el estado (sesión restaurándose).
  private readonly authState = new BehaviorSubject<AuthUser | null | undefined>(undefined);

  readonly currentUser$: Observable<AuthUser | null> = this.authState.pipe(
    filter((user): user is AuthUser | null => user !== undefined)
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

  async signInWithGoogle(): Promise<AuthUser | null> {
    const { user } = await FirebaseAuthentication.signInWithGoogle();
    if (user) {
      await this.ensureUserDocument(user);
    }
    return user;
  }

  async signOut(): Promise<void> {
    await FirebaseAuthentication.signOut();
  }

  async updateDisplayName(displayName: string): Promise<void> {
    const user = this.currentUser;
    if (!user) {
      throw new Error('No hay un usuario autenticado.');
    }

    await updateDoc(doc(this.firestore, 'users', user.uid), { displayName });
  }

  private async ensureUserDocument(user: AuthUser): Promise<void> {
    const ref = doc(this.firestore, 'users', user.uid);
    const snapshot = await getDoc(ref);
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
    await setDoc(ref, newUser);
  }
}
