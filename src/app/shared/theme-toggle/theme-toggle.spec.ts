import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { vi } from 'vitest';

import { ThemeToggle } from './theme-toggle';
import { ThemeService } from '../../core/theme/theme';

const { mockImpact } = vi.hoisted(() => ({
  mockImpact: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@capacitor/haptics', () => ({
  Haptics: { impact: mockImpact },
  ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' },
}));

vi.mock('@capacitor/preferences', () => ({
  Preferences: { get: vi.fn(), set: vi.fn().mockResolvedValue(undefined) },
}));

describe('ThemeToggle', () => {
  let component: ThemeToggle;
  let fixture: ComponentFixture<ThemeToggle>;
  let themeSignal: ReturnType<typeof signal<'dark' | 'light'>>;
  let toggle: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mockImpact.mockClear();
    themeSignal = signal<'dark' | 'light'>('dark');
    toggle = vi.fn().mockImplementation(async () => {
      themeSignal.set(themeSignal() === 'dark' ? 'light' : 'dark');
    });

    await TestBed.configureTestingModule({
      imports: [ThemeToggle],
      providers: [{ provide: ThemeService, useValue: { theme: themeSignal.asReadonly(), toggle } }],
    }).compileComponents();

    fixture = TestBed.createComponent(ThemeToggle);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows the moon and "Modo oscuro" while dark', () => {
    expect(fixture.nativeElement.textContent).toContain('🌙');
    expect(fixture.nativeElement.textContent).toContain('Modo oscuro');
    expect(fixture.nativeElement.querySelector('.mfx-theme-toggle').getAttribute('aria-checked')).toBe('false');
  });

  it('shows the sun and "Modo claro" once switched to light', () => {
    themeSignal.set('light');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('☀️');
    expect(fixture.nativeElement.textContent).toContain('Modo claro');
    expect(fixture.nativeElement.querySelector('.mfx-theme-toggle').getAttribute('aria-checked')).toBe('true');
  });

  it('clicking calls ThemeService.toggle() and buzzes lightly', async () => {
    fixture.nativeElement.querySelector('.mfx-theme-toggle').click();
    await Promise.resolve();

    expect(toggle).toHaveBeenCalled();
    expect(mockImpact).toHaveBeenCalledWith({ style: 'LIGHT' });
  });

  it('does not throw if haptics are unavailable', async () => {
    mockImpact.mockRejectedValueOnce(new Error('unavailable'));

    fixture.nativeElement.querySelector('.mfx-theme-toggle').click();
    await Promise.resolve();
    await Promise.resolve();

    expect(toggle).toHaveBeenCalled();
  });
});

describe('ThemeToggle with the real ThemeService (Fase 8 regression)', () => {
  // A diferencia del resto del archivo (que stubea ThemeService por
  // completo), esto usa el servicio REAL para probar de punta a punta que
  // el ApplicationRef.tick() agregado en theme.ts sí repinta el switch —
  // sin él, este test fallaría igual que el de recurring.spec.ts antes del
  // fix (el signal cambia, el ícono se queda viejo).
  it('shows the restored preference in the rendered icon without a manual detectChanges() call', async () => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true, // el sistema dice oscuro...
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    vi.mocked(Preferences.get).mockResolvedValue({ value: 'light' }); // ...pero el usuario ya había elegido claro

    await TestBed.configureTestingModule({ imports: [ThemeToggle] }).compileComponents();

    const freshFixture = TestBed.createComponent(ThemeToggle);
    freshFixture.autoDetectChanges(true);
    await freshFixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(freshFixture.nativeElement.textContent).toContain('☀️');
    expect(freshFixture.nativeElement.querySelector('.mfx-theme-toggle').getAttribute('aria-checked')).toBe('true');

    document.documentElement.removeAttribute('data-theme');
  });
});
