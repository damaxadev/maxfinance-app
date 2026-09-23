import { Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';

import { Auth } from '../../core/auth/auth';

@Component({
  selector: 'mfx-profile',
  imports: [],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
})
export class Profile {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);

  readonly currentUser = toSignal(this.auth.currentUser$, { initialValue: this.auth.currentUser });
  readonly displayNameDraft = signal(this.auth.currentUser?.displayName ?? '');

  readonly saving = signal(false);
  readonly saved = signal(false);
  readonly errorMessage = signal<string | null>(null);

  onDisplayNameInput(value: string): void {
    this.displayNameDraft.set(value);
    this.saved.set(false);
  }

  async save(): Promise<void> {
    this.saving.set(true);
    this.errorMessage.set(null);
    this.saved.set(false);

    try {
      await this.auth.updateDisplayName(this.displayNameDraft().trim());
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
}
