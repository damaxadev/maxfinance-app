import { Component, signal } from '@angular/core';
import { animate, style, transition, trigger } from '@angular/animations';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

export interface FabOption {
  id: string;
  label: string;
}

const FAB_OPTIONS: readonly FabOption[] = [
  { id: 'movement', label: 'Agregar movimiento' },
  { id: 'shared-expense', label: 'Agregar gasto compartido' },
];

const STAGGER_STEP_MS = 50;
const MESSAGE_DURATION_MS = 2000;

@Component({
  selector: 'mfx-fab',
  imports: [],
  templateUrl: './fab.html',
  styleUrl: './fab.scss',
  animations: [
    trigger('fabOptionEnter', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(12px) scale(0.9)' }),
        animate(
          '220ms {{delay}}ms cubic-bezier(0.16, 1, 0.3, 1)',
          style({ opacity: 1, transform: 'translateY(0) scale(1)' })
        ),
      ], { params: { delay: 0 } }),
      transition(':leave', [
        animate('150ms ease-in', style({ opacity: 0, transform: 'translateY(8px) scale(0.9)' })),
      ]),
    ]),
    trigger('fadeInOut', [
      transition(':enter', [style({ opacity: 0 }), animate('150ms ease-out', style({ opacity: 1 }))]),
      transition(':leave', [animate('150ms ease-in', style({ opacity: 0 }))]),
    ]),
  ],
})
export class Fab {
  readonly options = FAB_OPTIONS;
  readonly open = signal(false);
  readonly message = signal<string | null>(null);

  private messageTimeoutId: ReturnType<typeof setTimeout> | null = null;

  staggerDelay(index: number): number {
    return index * STAGGER_STEP_MS;
  }

  toggle(): void {
    if (this.open()) {
      this.close();
    } else {
      this.openMenu();
    }
  }

  close(): void {
    if (!this.open()) {
      return;
    }
    this.open.set(false);
    void this.buzz(ImpactStyle.Light);
  }

  private openMenu(): void {
    this.open.set(true);
    void this.buzz(ImpactStyle.Medium);
  }

  selectOption(option: FabOption): void {
    console.log(`[mfx-fab] "${option.label}" tocada (placeholder, sin acción real todavía)`);
    this.showMessage(`Próximamente: ${option.label}`);
    this.close();
  }

  private showMessage(text: string): void {
    this.message.set(text);
    if (this.messageTimeoutId !== null) {
      clearTimeout(this.messageTimeoutId);
    }
    this.messageTimeoutId = setTimeout(() => this.message.set(null), MESSAGE_DURATION_MS);
  }

  private async buzz(style: ImpactStyle): Promise<void> {
    try {
      await Haptics.impact({ style });
    } catch {
      // Sin soporte háptico (navegador de escritorio) — no bloquea la UI.
    }
  }
}
