import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { ModalStack } from '../../core/modal-stack/modal-stack';
import { ImageViewer } from './image-viewer';

describe('ImageViewer', () => {
  let component: ImageViewer;
  let fixture: ComponentFixture<ImageViewer>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ImageViewer],
      providers: [provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(ImageViewer);
    fixture.componentRef.setInput('imageUrl', 'https://example.com/recibo.jpg');
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders the given image URL inside the zoom container', () => {
    const img: HTMLImageElement = fixture.nativeElement.querySelector('.swiper-zoom-container img');
    expect(img.src).toBe('https://example.com/recibo.jpg');
  });

  it('emits closed when the backdrop is clicked', () => {
    const emitted: void[] = [];
    component.closed.subscribe(() => emitted.push(undefined));

    fixture.nativeElement.querySelector('.mfx-image-viewer__backdrop').click();

    expect(emitted.length).toBe(1);
  });

  it('emits closed when the close button is clicked', () => {
    const emitted: void[] = [];
    component.closed.subscribe(() => emitted.push(undefined));

    fixture.nativeElement.querySelector('.mfx-image-viewer__close').click();

    expect(emitted.length).toBe(1);
  });

  // El botón de cerrar vive FUERA de .frame (no es su hijo) — .frame tiene
  // pointer-events:none (ver scss) para dejar pasar el tap al backdrop
  // alrededor de la imagen sin interpretar gestos de Swiper; si el botón
  // quedara adentro heredaría ese pointer-events:none y dejaría de
  // responder al tap salvo que se le reactivara explícitamente.
  it('the close button is a sibling of .frame, not nested inside it (would inherit pointer-events:none)', () => {
    const closeButton = fixture.nativeElement.querySelector('.mfx-image-viewer__close');
    const frame = fixture.nativeElement.querySelector('.mfx-image-viewer__frame');

    expect(frame.contains(closeButton)).toBe(false);
  });

  // El "escenario" (del tamaño de la imagen) es lo único dentro de .frame
  // que vuelve a aceptar toques — tocar fuera de él (pero dentro de .frame)
  // debe caer hasta el backdrop, nunca quedarse atrapado en .frame mismo.
  it('.frame has no click handler of its own — only .backdrop and .swiper do', () => {
    const frame = fixture.nativeElement.querySelector('.mfx-image-viewer__frame');
    const emitted: void[] = [];
    component.closed.subscribe(() => emitted.push(undefined));

    frame.click();

    expect(emitted.length).toBe(0);
  });

  describe('ModalStack registration (botón atrás de Android)', () => {
    it('registers itself when created', () => {
      const modalStack = TestBed.inject(ModalStack);
      expect(modalStack.hasOpen).toBe(true);
    });

    it('closing it from the ModalStack (as the back button would) emits closed', () => {
      const modalStack = TestBed.inject(ModalStack);
      const emitted: void[] = [];
      component.closed.subscribe(() => emitted.push(undefined));

      const handled = modalStack.closeTop();

      expect(handled).toBe(true);
      expect(emitted.length).toBe(1);
    });

    it('unregisters itself when destroyed', () => {
      const modalStack = TestBed.inject(ModalStack);
      fixture.destroy();

      expect(modalStack.hasOpen).toBe(false);
    });
  });
});
