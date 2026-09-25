import { Component, computed, effect, input, signal } from '@angular/core';

@Component({
  selector: 'mfx-progress-ring',
  imports: [],
  templateUrl: './progress-ring.html',
  styleUrl: './progress-ring.scss',
})
export class ProgressRing {
  // 0-100
  readonly percentage = input.required<number>();
  readonly size = input(96);
  readonly strokeWidth = input(10);
  readonly color = input('var(--primary)');

  private readonly displayPercentage = signal(0);

  readonly radius = computed(() => (this.size() - this.strokeWidth()) / 2);
  readonly circumference = computed(() => 2 * Math.PI * this.radius());
  readonly dashOffset = computed(() => {
    const clamped = Math.max(0, Math.min(100, this.displayPercentage()));
    return this.circumference() * (1 - clamped / 100);
  });
  readonly roundedPercentage = computed(() => Math.round(this.percentage()));

  constructor() {
    effect(() => {
      const target = this.percentage();
      // Se espera un frame para que la transición CSS anime desde el
      // valor anterior en vez de "saltar" directo al destino.
      requestAnimationFrame(() => this.displayPercentage.set(target));
    });
  }
}
