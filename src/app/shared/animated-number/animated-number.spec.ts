import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnimatedNumber } from './animated-number';

function digitsOnly(text: string): number {
  return Number(text.replace(/[^0-9]/g, ''));
}

describe('AnimatedNumber', () => {
  let component: AnimatedNumber;
  let fixture: ComponentFixture<AnimatedNumber>;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });

    await TestBed.configureTestingModule({
      imports: [AnimatedNumber],
    }).compileComponents();

    fixture = TestBed.createComponent(AnimatedNumber);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('value', 0);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('counts up from 0 to the target value, formatted as Colombian pesos', () => {
    fixture.componentRef.setInput('value', 100);
    fixture.detectChanges();

    vi.advanceTimersByTime(800);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent.trim()).toBe('$ 100');
  });

  it('animates from the previous value, not from 0 again, on a second change', () => {
    fixture.componentRef.setInput('value', 100);
    fixture.detectChanges();
    vi.advanceTimersByTime(800);
    fixture.detectChanges();

    fixture.componentRef.setInput('value', 40);
    fixture.detectChanges();
    vi.advanceTimersByTime(400);
    fixture.detectChanges();

    const midway = digitsOnly(fixture.nativeElement.textContent.trim());
    expect(midway).toBeLessThan(100);
    expect(midway).toBeGreaterThan(40);

    vi.advanceTimersByTime(400);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent.trim()).toBe('$ 40');
  });

  it('never shows the "COP" code, only the "$" symbol', () => {
    fixture.componentRef.setInput('value', 150000);
    fixture.detectChanges();
    vi.advanceTimersByTime(800);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('$');
    expect(fixture.nativeElement.textContent).not.toContain('COP');
  });

  it('shows a "+" sign when showSign is true and the value is positive (e.g. income)', () => {
    fixture.componentRef.setInput('showSign', true);
    fixture.componentRef.setInput('value', 50000);
    fixture.detectChanges();

    vi.advanceTimersByTime(800);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent.trim()).toBe('+$ 50.000');
  });

  it('shows a "-" sign when showSign is true and the value is negative (e.g. expense)', () => {
    fixture.componentRef.setInput('showSign', true);
    fixture.componentRef.setInput('value', -50000);
    fixture.detectChanges();

    vi.advanceTimersByTime(800);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent.trim()).toBe('-$ 50.000');
  });

  it('shows no sign at all by default, even for a positive value', () => {
    fixture.componentRef.setInput('value', 50000);
    fixture.detectChanges();

    vi.advanceTimersByTime(800);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent.trim()).toBe('$ 50.000');
  });
});
