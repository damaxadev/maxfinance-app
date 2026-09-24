import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { vi } from 'vitest';

import { Checkbox } from './checkbox';

const { mockImpact } = vi.hoisted(() => ({
  mockImpact: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@capacitor/haptics', () => ({
  Haptics: { impact: mockImpact },
  ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' },
}));

describe('Checkbox', () => {
  let component: Checkbox;
  let fixture: ComponentFixture<Checkbox>;

  beforeEach(async () => {
    mockImpact.mockClear();

    await TestBed.configureTestingModule({
      imports: [Checkbox],
    }).compileComponents();

    fixture = TestBed.createComponent(Checkbox);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('starts unchecked', () => {
    expect(component.checked()).toBe(false);
  });

  it('writeValue() sets the checked state', () => {
    component.writeValue(true);
    expect(component.checked()).toBe(true);

    component.writeValue(false);
    expect(component.checked()).toBe(false);
  });

  it('toggle() flips checked and notifies the registered onChange callback', () => {
    const onChange = vi.fn();
    component.registerOnChange(onChange);

    component.toggle();

    expect(component.checked()).toBe(true);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('toggle() calls the registered onTouched callback', () => {
    const onTouched = vi.fn();
    component.registerOnTouched(onTouched);

    component.toggle();

    expect(onTouched).toHaveBeenCalled();
  });

  it('buzzes lightly when checking, but not when unchecking', () => {
    component.toggle(); // false -> true
    expect(mockImpact).toHaveBeenCalledWith({ style: 'LIGHT' });

    mockImpact.mockClear();
    component.toggle(); // true -> false
    expect(mockImpact).not.toHaveBeenCalled();
  });

  it('setDisabledState() blocks toggling', () => {
    const onChange = vi.fn();
    component.registerOnChange(onChange);
    component.setDisabledState(true);

    component.toggle();

    expect(component.checked()).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders the checked class and aria-checked once checked() is true', () => {
    component.writeValue(true);
    fixture.detectChanges();

    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    expect(button.classList.contains('mfx-checkbox--checked')).toBe(true);
    expect(button.getAttribute('aria-checked')).toBe('true');
  });

  it('clicking the rendered button toggles it', () => {
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    button.click();
    fixture.detectChanges();

    expect(component.checked()).toBe(true);
  });
});

@Component({
  imports: [ReactiveFormsModule, Checkbox],
  template: `<mfx-checkbox [formControl]="control">Acepto</mfx-checkbox>`,
})
class HostWithFormControl {
  readonly control = new FormControl(false, { nonNullable: true });
}

describe('Checkbox (integrated with a real FormControl)', () => {
  let fixture: ComponentFixture<HostWithFormControl>;
  let host: HostWithFormControl;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostWithFormControl],
    }).compileComponents();

    fixture = TestBed.createComponent(HostWithFormControl);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('clicking the checkbox updates the bound FormControl', () => {
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    button.click();
    fixture.detectChanges();

    expect(host.control.value).toBe(true);
  });

  it('setting the FormControl value updates the rendered checked state', () => {
    host.control.setValue(true);
    fixture.detectChanges();

    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button');
    expect(button.classList.contains('mfx-checkbox--checked')).toBe(true);
  });

  it('projects the label content', () => {
    expect(fixture.nativeElement.textContent).toContain('Acepto');
  });
});
