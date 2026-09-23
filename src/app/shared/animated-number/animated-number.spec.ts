import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnimatedNumber } from './animated-number';

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

  it('counts up from 0 to the target value', () => {
    fixture.componentRef.setInput('value', 100);
    fixture.detectChanges();

    vi.advanceTimersByTime(800);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent.trim()).toBe('100');
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

    const midway = Number(fixture.nativeElement.textContent.trim());
    expect(midway).toBeLessThan(100);
    expect(midway).toBeGreaterThan(40);

    vi.advanceTimersByTime(400);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent.trim()).toBe('40');
  });

  it('applies prefix, suffix and decimals', () => {
    fixture.componentRef.setInput('decimals', 2);
    fixture.componentRef.setInput('prefix', '$');
    fixture.componentRef.setInput('suffix', ' COP');
    fixture.componentRef.setInput('value', 50);
    fixture.detectChanges();

    vi.advanceTimersByTime(800);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent.trim()).toBe('$50.00 COP');
  });
});
