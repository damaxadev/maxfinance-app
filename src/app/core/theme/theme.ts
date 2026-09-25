import { ApplicationRef, Injectable, inject, signal } from '@angular/core';
import { Preferences } from '@capacitor/preferences';

export type Theme = 'dark' | 'light';

const THEME_PREFERENCE_KEY = 'mfx-theme';

function prefersDarkFromSystem(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : true;
}

/**
 * Modo claro/oscuro (ver DESIGN.md, "Modo claro"). Arranca respetando
 * prefers-color-scheme del sistema; si el usuario nunca toca el toggle
 * manualmente, sigue siguiendo al sistema en vivo (no se "pega" en un modo
 * por haberlo visto una vez). Una vez el usuario elige manualmente, esa
 * preferencia se guarda en el dispositivo (@capacitor/preferences, no
 * Firestore — es de pantalla, no de cuenta) y deja de seguir al sistema.
 */
@Injectable({
  providedIn: 'root',
})
export class ThemeService {
  private readonly _theme = signal<Theme>(prefersDarkFromSystem() ? 'dark' : 'light');
  readonly theme = this._theme.asReadonly();

  // No hay un componente "actual" del que colgarse acá (es un servicio,
  // no un componente) — ApplicationRef.tick() es el equivalente a nivel de
  // app del markForCheck() que se usó para el mismo bug en Recurring. Sin
  // esto, mfx-theme-toggle (el único que lee theme() en su plantilla) puede
  // quedarse mostrando el ícono/posición vieja aunque el signal y el
  // <html data-theme> ya hayan cambiado — ver la auditoría de Fase 8.
  private readonly appRef = inject(ApplicationRef);

  private userOverride = false;

  constructor() {
    this.applyToDocument(this._theme());
    void this.restoreSavedPreference();
    this.watchSystemChanges();
  }

  async setTheme(theme: Theme): Promise<void> {
    this.userOverride = true;
    this._theme.set(theme);
    this.applyToDocument(theme);

    try {
      await Preferences.set({ key: THEME_PREFERENCE_KEY, value: theme });
    } catch (error) {
      console.error('Error al guardar la preferencia de tema', error);
    }
  }

  async toggle(): Promise<void> {
    await this.setTheme(this._theme() === 'dark' ? 'light' : 'dark');
  }

  private async restoreSavedPreference(): Promise<void> {
    try {
      const { value } = await Preferences.get({ key: THEME_PREFERENCE_KEY });
      if (value === 'dark' || value === 'light') {
        this.userOverride = true;
        this._theme.set(value);
        this.applyToDocument(value);
      }
    } catch (error) {
      console.error('Error al leer la preferencia de tema guardada', error);
    } finally {
      // Esta promesa resuelve en el arranque de la app, fuera de cualquier
      // evento que Angular trackee — sin esto, el signal cambia pero nada
      // le avisa a mfx-theme-toggle que debe repintarse.
      this.appRef.tick();
    }
  }

  private watchSystemChanges(): void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (event) => {
      if (this.userOverride) {
        return;
      }
      const theme: Theme = event.matches ? 'dark' : 'light';
      this._theme.set(theme);
      this.applyToDocument(theme);
      // Mismo motivo que en restoreSavedPreference(): un listener de
      // matchMedia tampoco es un evento trackeado por Angular.
      this.appRef.tick();
    });
  }

  private applyToDocument(theme: Theme): void {
    if (typeof document === 'undefined') {
      return;
    }
    if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }
}
