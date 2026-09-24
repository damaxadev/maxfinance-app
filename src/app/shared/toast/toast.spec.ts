import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { Toast } from './toast';

describe('Toast', () => {
  let fixture: ComponentFixture<Toast>;
  let component: Toast;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Toast],
      providers: [provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(Toast);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('title', 'Pago recurrente procesado');
    fixture.componentRef.setInput('body', 'Netflix: $70.000');
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders the title and body', () => {
    expect(fixture.nativeElement.textContent).toContain('Pago recurrente procesado');
    expect(fixture.nativeElement.textContent).toContain('Netflix: $70.000');
  });

  it('emits dismissed when the close button is clicked', () => {
    const emitted: void[] = [];
    component.dismissed.subscribe(() => emitted.push(undefined));

    fixture.nativeElement.querySelector('.mfx-toast__close').click();

    expect(emitted.length).toBe(1);
  });
});
