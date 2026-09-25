import { Component, input, signal } from '@angular/core';
import { animate, style, transition, trigger } from '@angular/animations';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

const STAGGER_STEP_MS = 60;

@Component({
  selector: 'mfx-card',
  imports: [],
  templateUrl: './card.html',
  styleUrl: './card.scss',
  animations: [
    trigger('cardEnter', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(16px)' }),
        animate(
          '420ms {{delay}}ms cubic-bezier(0.16, 1, 0.3, 1)',
          style({ opacity: 1, transform: 'translateY(0)' })
        ),
      ], { params: { delay: 0 } }),
    ]),
  ],
  host: {
    class: 'mfx-card',
    '[@cardEnter]': 'animationParams',
    '[class.mfx-card--pressed]': 'pressed()',
    '(mousedown)': 'onPressStart()',
    '(touchstart)': 'onPressStart()',
    '(mouseup)': 'onPressEnd()',
    '(touchend)': 'onPressEnd()',
    '(mouseleave)': 'onPressEnd()',
  },
})
export class Card {
  // Índice del elemento cuando la tarjeta se usa dentro de un *ngFor,
  // para escalonar (stagger) la animación de entrada.
  readonly index = input(0);

  readonly pressed = signal(false);

  get animationParams() {
    return { value: true, params: { delay: this.index() * STAGGER_STEP_MS } };
  }

  async onPressStart(): Promise<void> {
    this.pressed.set(true);
    try {
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch {
      // Sin soporte háptico (navegador de escritorio) — no bloquea la UI.
    }
  }

  onPressEnd(): void {
    this.pressed.set(false);
  }
}
