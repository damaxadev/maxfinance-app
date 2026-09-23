import { Component, input, output } from '@angular/core';
import { animate, style, transition, trigger } from '@angular/animations';

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

  close(): void {
    this.closed.emit();
  }
}
