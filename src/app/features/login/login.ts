import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import { Auth } from '../../core/auth/auth';

@Component({
  selector: 'mfx-login',
  imports: [],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);

  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);

  async signInWithGoogle(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set(null);

    try {
      const user = await this.auth.signInWithGoogle();
      if (user) {
        await this.router.navigate(['/perfil']);
      }
    } catch (error) {
      console.error('Error al iniciar sesión con Google', error);
      this.errorMessage.set('No pudimos iniciar tu sesión. Intenta de nuevo.');
    } finally {
      this.loading.set(false);
    }
  }
}
