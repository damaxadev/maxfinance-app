import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

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
});
