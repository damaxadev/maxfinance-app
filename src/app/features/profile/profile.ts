import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';

import { ActiveTabState } from '../../core/active-tab-state/active-tab-state';
import { Auth } from '../../core/auth/auth';
import { Card } from '../../shared/card/card';
import { Avatar } from '../../shared/avatar/avatar';

// Índice del tab de Ajustes en el swiper de Shell (Inicio, Movimientos,
// Grupos, Recurrentes, Ajustes) — ver ActiveTabState/shell.html.
const SETTINGS_TAB_INDEX = 4;

@Component({
  selector: 'mfx-profile',
  imports: [Card, Avatar],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
})
export class Profile {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly activeTabState = inject(ActiveTabState);

  readonly currentUser = toSignal(this.auth.currentUser$, { initialValue: this.auth.currentUser });
  readonly displayNameDraft = signal(this.auth.currentUser?.displayName ?? '');

  // A diferencia de displayNameDraft (disponible de una vez, viene del SDK
  // nativo ya restaurado), el teléfono vive en el documento de Firestore
  // (userDocument$, ver Auth) — llega async, así que se inicializa una sola
  // vez, la primera vez que el doc resuelve (no en cada emisión: no queremos
  // pisar lo que el usuario ya tecleó si el doc se vuelve a emitir después
  // de guardar).
  readonly userDocument = toSignal(this.auth.userDocument$, { initialValue: null });
  readonly phoneDraft = signal('');
  private phoneInitialized = false;

  readonly memberSinceLabel = computed(() => {
    const createdAt = this.userDocument()?.createdAt;
    if (!createdAt) {
      return null;
    }
    return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }).format(createdAt.toDate());
  });

  readonly saving = signal(false);
  readonly saved = signal(false);
  readonly errorMessage = signal<string | null>(null);

  constructor() {
    effect(() => {
      const doc = this.userDocument();
      if (doc && !this.phoneInitialized) {
        this.phoneInitialized = true;
        this.phoneDraft.set(doc.phone ?? '');
      }
    });
  }

  onDisplayNameInput(value: string): void {
    this.displayNameDraft.set(value);
    this.saved.set(false);
  }

  onPhoneInput(value: string): void {
    this.phoneDraft.set(value);
    this.saved.set(false);
  }

  async save(): Promise<void> {
    this.saving.set(true);
    this.errorMessage.set(null);
    this.saved.set(false);

    try {
      await Promise.all([
        this.auth.updateDisplayName(this.displayNameDraft().trim()),
        this.auth.updatePhone(this.phoneDraft()),
      ]);
      this.saved.set(true);
    } catch (error) {
      console.error('Error al guardar el perfil', error);
      this.errorMessage.set('No pudimos guardar los cambios. Intenta de nuevo.');
    } finally {
      this.saving.set(false);
    }
  }

  async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigate(['/login']);
  }

  goBack(): void {
    this.activeTabState.requestTab(SETTINGS_TAB_INDEX);
    void this.router.navigate(['/inicio']);
  }
}
