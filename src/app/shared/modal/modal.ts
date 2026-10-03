import { Component, DestroyRef, inject, input, output } from '@angular/core';
import { animate, style, transition, trigger } from '@angular/animations';

import { ModalStack } from '../../core/modal-stack/modal-stack';

@Component({
  selector: 'mfx-modal',
  imports: [],
  templateUrl: './modal.html',
  styleUrl: './modal.scss',
  animations: [
    trigger('backdropFade', [
      transition(':enter', [style({ opacity: 0 }), animate('150ms ease-out', style({ opacity: 1 }))]),
      transition(':leave', [animate('150ms ease-in', style({ opacity: 0 }))]),
    ]),
    trigger('sheetSlide', [
      transition(':enter', [
        style({ transform: 'translateY(100%)' }),
        animate('240ms cubic-bezier(0.16, 1, 0.3, 1)', style({ transform: 'translateY(0)' })),
      ]),
      transition(':leave', [animate('180ms ease-in', style({ transform: 'translateY(100%)' }))]),
    ]),
  ],
})
export class Modal {
  readonly title = input('');
  readonly closed = output<void>();

  private readonly modalStack = inject(ModalStack);

  constructor() {
    // Cada instancia se registra al crearse (justo cuando el *FormState la
    // abre) y se da de baja al destruirse (cuando el *if que la renderiza
    // se vuelve falso) — así el botón atrás de Android (ver App) siempre
    // sabe cuál es el modal más reciente, sin que ningún *FormState tenga
    // que participar. Cubre también un modal anidado dentro de otro (ver
    // GroupDetail, menú "⋮").
    const onBack = () => this.close();
    this.modalStack.push(onBack);
    inject(DestroyRef).onDestroy(() => this.modalStack.pop(onBack));
  }

  close(): void {
    this.closed.emit();
  }
}
