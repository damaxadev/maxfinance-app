import { ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProgressRing } from './progress-ring';

describe('ProgressRing', () => {
  let component: ProgressRing;
  let fixture: ComponentFixture<ProgressRing>;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });

    await TestBed.configureTestingModule({
      imports: [ProgressRing],
    }).compileComponents();

    fixture = TestBed.createComponent(ProgressRing);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('percentage', 0);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('starts fully unfilled (dashOffset == circumference)', () => {
    expect(component.dashOffset()).toBe(component.circumference());
  });

  it('animates the ring fill to the target percentage after a frame', () => {
    fixture.componentRef.setInput('percentage', 75);
    fixture.detectChanges();

    vi.advanceTimersByTime(16);
    fixture.detectChanges();

    const expectedOffset = component.circumference() * (1 - 75 / 100);
    expect(component.dashOffset()).toBeCloseTo(expectedOffset);
  });

  it('rounds the displayed percentage label', () => {
    fixture.componentRef.setInput('percentage', 42.6);
    fixture.detectChanges();

    expect(component.roundedPercentage()).toBe(43);
  });
});
