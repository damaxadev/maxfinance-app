import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Fab } from './fab';

const { mockImpact } = vi.hoisted(() => ({
  mockImpact: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@capacitor/haptics', () => ({
  Haptics: { impact: mockImpact },
  ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' },
}));

describe('Fab', () => {
  let component: Fab;
  let fixture: ComponentFixture<Fab>;

  beforeEach(async () => {
    mockImpact.mockClear();
    vi.useFakeTimers();

    await TestBed.configureTestingModule({
      imports: [Fab],
      providers: [provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(Fab);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('starts closed', () => {
    expect(component.open()).toBe(false);
  });

  it('opens with a medium haptic on toggle', () => {
    component.toggle();

    expect(component.open()).toBe(true);
    expect(mockImpact).toHaveBeenCalledWith({ style: 'MEDIUM' });
  });

  it('closes with a light haptic on a second toggle', () => {
    component.toggle();
    mockImpact.mockClear();

    component.toggle();

    expect(component.open()).toBe(false);
    expect(mockImpact).toHaveBeenCalledWith({ style: 'LIGHT' });
  });

  it('closes when close() is called directly (e.g. tapping the backdrop)', () => {
    component.toggle();

    component.close();

    expect(component.open()).toBe(false);
  });

  it('does nothing if close() is called while already closed', () => {
    component.close();

    expect(mockImpact).not.toHaveBeenCalled();
  });

  it('selecting an option closes the menu and shows a temporary message', () => {
    component.toggle();

    component.selectOption(component.options[0]);

    expect(component.open()).toBe(false);
    expect(component.message()).toBe('Próximamente: Agregar movimiento');

    vi.advanceTimersByTime(2000);
    expect(component.message()).toBeNull();
  });

  it('renders both placeholder options while open', () => {
    component.toggle();
    fixture.detectChanges();

    const labels = Array.from<HTMLButtonElement>(
      fixture.nativeElement.querySelectorAll('.mfx-fab__option')
    ).map((el) => el.textContent?.trim());

    expect(labels).toEqual(['Agregar movimiento', 'Agregar gasto compartido']);
  });

  it('closes when the backdrop is clicked', () => {
    component.toggle();
    fixture.detectChanges();

    const backdrop = fixture.nativeElement.querySelector('.mfx-fab__backdrop');
    backdrop.click();

    expect(component.open()).toBe(false);
  });
});
