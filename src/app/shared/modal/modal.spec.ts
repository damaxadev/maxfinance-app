import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { ModalStack } from '../../core/modal-stack/modal-stack';
import { Modal } from './modal';

describe('Modal', () => {
  let component: Modal;
  let fixture: ComponentFixture<Modal>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Modal],
      providers: [provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(Modal);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('emits closed when the backdrop is clicked', () => {
    const emitted: void[] = [];
    component.closed.subscribe(() => emitted.push(undefined));

    fixture.nativeElement.querySelector('.mfx-modal__backdrop').click();

    expect(emitted.length).toBe(1);
  });

  it('emits closed when the close button is clicked', () => {
    const emitted: void[] = [];
    component.closed.subscribe(() => emitted.push(undefined));

    fixture.nativeElement.querySelector('.mfx-modal__close').click();

    expect(emitted.length).toBe(1);
  });

  // Fase 10 (botón atrás de Android): cada instancia se registra/desregistra
  // sola en ModalStack, para que el listener global (ver App) sepa cuál es
  // el modal más reciente sin que ningún *FormState tenga que participar.
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
