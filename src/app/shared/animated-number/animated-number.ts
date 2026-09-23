import { Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';

@Component({
  selector: 'mfx-animated-number',
  imports: [],
  template: `{{ formatted() }}`,
  styleUrl: './animated-number.scss',
})
export class AnimatedNumber {
  readonly value = input.required<number>();
  readonly durationMs = input(800);
  readonly decimals = input(0);
  readonly prefix = input('');
  readonly suffix = input('');

  private readonly displayValue = signal(0);
  readonly formatted = computed(
    () => `${this.prefix()}${this.displayValue().toFixed(this.decimals())}${this.suffix()}`
  );

  // Valor "en vivo" de la animación, fuera del sistema de señales para no
  // crear un ciclo (el effect solo debe reaccionar a cambios de `value`).
  private currentValue = 0;
  private frameId: number | null = null;

  constructor() {
    effect(() => {
      this.animateTo(this.value());
    });

    inject(DestroyRef).onDestroy(() => this.cancelAnimation());
  }

  private animateTo(target: number): void {
    this.cancelAnimation();

    const from = this.currentValue;
    const diff = target - from;
    if (diff === 0) {
      return;
    }

    const duration = this.durationMs();
    const start = performance.now();

    const step = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = from + diff * eased;

      this.currentValue = next;
      this.displayValue.set(next);

      if (progress < 1) {
        this.frameId = requestAnimationFrame(step);
      } else {
        this.currentValue = target;
        this.displayValue.set(target);
      }
    };

    this.frameId = requestAnimationFrame(step);
  }

  private cancelAnimation(): void {
    if (this.frameId !== null) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
  }
}
