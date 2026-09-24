import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';

import { MfxCurrencyInputDirective } from './currency-input.directive';

function setInputValueAndDispatch(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

@Component({
  imports: [ReactiveFormsModule, MfxCurrencyInputDirective],
  template: `<input mfxCurrencyInput [formControl]="control" />`,
})
class HostWithFormControl {
  readonly control = new FormControl(0, { nonNullable: true });
}

describe('MfxCurrencyInputDirective', () => {
  let fixture: ComponentFixture<HostWithFormControl>;
  let host: HostWithFormControl;
  let input: HTMLInputElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostWithFormControl],
    }).compileComponents();

    fixture = TestBed.createComponent(HostWithFormControl);
    host = fixture.componentInstance;
    fixture.detectChanges();
    input = fixture.nativeElement.querySelector('input');
  });

  it('forces type="text" and inputmode="decimal" so it can show a formatted (non-numeric) string', () => {
    expect(input.type).toBe('text');
    expect(input.getAttribute('inputmode')).toBe('decimal');
  });

  it('renders the FormControl value already formatted', () => {
    host.control.setValue(150000);
    fixture.detectChanges();

    expect(input.value).toBe('$ 150.000');
  });

  it('typing digits reformats the display and pushes the plain number to the FormControl', () => {
    setInputValueAndDispatch(input, '150000');
    fixture.detectChanges();

    expect(input.value).toBe('$ 150.000');
    expect(host.control.value).toBe(150000);
  });

  it('strips any non-digit characters the user might type or paste', () => {
    setInputValueAndDispatch(input, '$ 1.234abc');
    fixture.detectChanges();

    expect(host.control.value).toBe(1234);
  });

  it('treats an emptied input as 0, not NaN', () => {
    setInputValueAndDispatch(input, '');
    fixture.detectChanges();

    expect(host.control.value).toBe(0);
    expect(input.value).toBe('$ 0');
  });

  it('does not break existing Validators.min — the control still receives the raw plain number', () => {
    host.control.setValidators(Validators.min(1000));

    setInputValueAndDispatch(input, '500');
    fixture.detectChanges();
    expect(host.control.valid).toBe(false);

    setInputValueAndDispatch(input, '5000');
    fixture.detectChanges();
    expect(host.control.valid).toBe(true);
  });

  it('marks the control as touched on blur', () => {
    expect(host.control.touched).toBe(false);

    input.dispatchEvent(new Event('blur'));

    expect(host.control.touched).toBe(true);
  });

  it('disables the input when the FormControl is disabled', () => {
    host.control.disable();
    fixture.detectChanges();

    expect(input.disabled).toBe(true);
  });
});
