import { Component, computed, effect, input, signal } from '@angular/core';

@Component({
  selector: 'mfx-avatar',
  imports: [],
  templateUrl: './avatar.html',
  styleUrl: './avatar.scss',
})
export class Avatar {
  readonly photoUrl = input<string | null | undefined>(null);
  readonly displayName = input.required<string>();
  readonly size = input(40);

  // Si no hay foto, o si falla al cargar, se cae al círculo con la inicial.
  readonly photoLoadError = signal(false);
  readonly initial = computed(() => (this.displayName().trim()[0] ?? '?').toUpperCase());

  constructor() {
    // Nueva foto (p. ej. reutilizando el mismo mfx-avatar para otra persona
    // en un @for) merece su propia oportunidad de cargar.
    effect(() => {
      this.photoUrl();
      this.photoLoadError.set(false);
    });
  }

  onError(): void {
    this.photoLoadError.set(true);
  }
}
