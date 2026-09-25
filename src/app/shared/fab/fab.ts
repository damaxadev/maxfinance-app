import { Component, output, signal } from '@angular/core';
import { animate, style, transition, trigger } from '@angular/animations';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

export interface FabOption {
  id: string;
  label: string;
}

const FAB_OPTIONS: readonly FabOption[] = [
  { id: 'movement', label: 'Agregar movimiento' },
  { id: 'group', label: 'Nuevo grupo' },
  { id: 'shared-expense', label: 'Agregar gasto compartido' },
  { id: 'recurring', label: 'Nuevo recurrente' },
];

const STAGGER_STEP_MS = 50;

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
  readonly movementRequested = output<void>();
  readonly groupRequested = output<void>();
  readonly sharedExpenseRequested = output<void>();
  readonly recurringRequested = output<void>();

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
    this.close();

    if (option.id === 'movement') {
      this.movementRequested.emit();
      return;
    }

    if (option.id === 'group') {
      this.groupRequested.emit();
      return;
    }

    if (option.id === 'shared-expense') {
      this.sharedExpenseRequested.emit();
      return;
    }

    this.recurringRequested.emit();
  }

  private async buzz(style: ImpactStyle): Promise<void> {
    try {
      await Haptics.impact({ style });
    } catch {
      // Sin soporte háptico (navegador de escritorio) — no bloquea la UI.
    }
  }
}
