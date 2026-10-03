import { Component, CUSTOM_ELEMENTS_SCHEMA, DestroyRef, inject, input, output } from '@angular/core';
import { animate, style, transition, trigger } from '@angular/animations';
import { Zoom } from 'swiper/modules';

import { ModalStack } from '../../core/modal-stack/modal-stack';

// Visor full-screen con zoom para un adjunto de tipo imagen (ver
// AttachmentPicker, "ver/abrir el adjunto" — antes el tap principal sobre
// un adjunto guardado solo lo reemplazaba, nunca lo mostraba). Un solo
// <swiper-slide> con el módulo Zoom (pellizcar/doble-tap, ya usado en el
// proyecto para el carrusel de pestañas de Shell, register() corre una
// sola vez en main.ts) en vez de armar un visor de imagen propio — mismo
// criterio de "revisa si ya hay algo reusable" que Chart.js para la
// gráfica de aportes.
//
// No reutiliza <mfx-modal> (bottom sheet, con header/título): esto necesita
// ser edge-to-edge e inmersivo, no una hoja que sube desde abajo — pero sí
// se registra en el mismo ModalStack para que el botón atrás de Android lo
// cierre primero, igual que cualquier otro modal (ver Modal).
@Component({
  selector: 'mfx-image-viewer',
  imports: [],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './image-viewer.html',
  styleUrl: './image-viewer.scss',
  animations: [
    trigger('fadeInOut', [
      transition(':enter', [style({ opacity: 0 }), animate('150ms ease-out', style({ opacity: 1 }))]),
      transition(':leave', [animate('150ms ease-in', style({ opacity: 0 }))]),
    ]),
  ],
})
export class ImageViewer {
  readonly imageUrl = input.required<string>();
  readonly altText = input('Adjunto');
  readonly closed = output<void>();

  readonly zoomModules = [Zoom];

  private readonly modalStack = inject(ModalStack);

  constructor() {
    const onBack = () => this.close();
    this.modalStack.push(onBack);
    inject(DestroyRef).onDestroy(() => this.modalStack.pop(onBack));
  }

  close(): void {
    this.closed.emit();
  }
}
