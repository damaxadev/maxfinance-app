import { Component, input, output } from '@angular/core';
import { animate, style, transition, trigger } from '@angular/animations';

@Component({
  selector: 'mfx-toast',
  imports: [],
  templateUrl: './toast.html',
  styleUrl: './toast.scss',
  animations: [
    trigger('toastEnter', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(-16px)' }),
        animate('280ms cubic-bezier(0.16, 1, 0.3, 1)', style({ opacity: 1, transform: 'translateY(0)' })),
      ]),
      transition(':leave', [animate('180ms ease-in', style({ opacity: 0, transform: 'translateY(-16px)' }))]),
    ]),
  ],
  host: {
    class: 'mfx-toast',
    '[@toastEnter]': '',
    role: 'alert',
  },
})
export class Toast {
  readonly title = input.required<string>();
  readonly body = input.required<string>();
  readonly dismissed = output<void>();
}
