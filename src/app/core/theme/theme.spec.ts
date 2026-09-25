import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Preferences } from '@capacitor/preferences';
import { vi } from 'vitest';

import { ThemeService } from './theme';

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn(),
    set: vi.fn().mockResolvedValue(undefined),
  },
}));

type Listener = (event: { matches: boolean }) => void;

function mockMatchMedia(matches: boolean) {
  const listeners = new Set<Listener>();
  const mql = {
    matches,
    addEventListener: vi.fn((_event: string, cb: Listener) => listeners.add(cb)),
    removeEventListener: vi.fn((_event: string, cb: Listener) => listeners.delete(cb)),
  };
  window.matchMedia = vi.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia;
  return {
    emit: (next: boolean) => {
      mql.matches = next;
      listeners.forEach((cb) => cb({ matches: next }));
    },
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
  }
}

describe('ThemeService', () => {
  beforeEach(() => {
    // vi.mock(...) crea Preferences.get/set UNA vez para todo el archivo —
    // restoreAllMocks() no limpia su historial de llamadas (eso solo
    // aplica a spies creados con vi.spyOn), así que hay que resetearlo acá
    // explícitamente en cada test.
    vi.mocked(Preferences.get).mockReset();
    vi.mocked(Preferences.set).mockClear();
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
    vi.restoreAllMocks();
  });

  it('should be created', async () => {
    mockMatchMedia(true);
    vi.mocked(Preferences.get).mockResolvedValue({ value: null });
    TestBed.configureTestingModule({});

    const service = TestBed.inject(ThemeService);
    expect(service).toBeTruthy();
  });

  it('detects prefers-color-scheme: dark by default with no saved preference', async () => {
    mockMatchMedia(true);
    vi.mocked(Preferences.get).mockResolvedValue({ value: null });
    TestBed.configureTestingModule({});

    const service = TestBed.inject(ThemeService);

    expect(service.theme()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
  });

  it('detects prefers-color-scheme: light by default with no saved preference', async () => {
    mockMatchMedia(false);
    vi.mocked(Preferences.get).mockResolvedValue({ value: null });
    TestBed.configureTestingModule({});

    const service = TestBed.inject(ThemeService);
    await flushMicrotasks();

    expect(service.theme()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('restores a manually saved preference over the current system default', async () => {
    mockMatchMedia(true); // el sistema dice oscuro...
    vi.mocked(Preferences.get).mockResolvedValue({ value: 'light' }); // ...pero el usuario ya había elegido claro

    TestBed.configureTestingModule({});
    const service = TestBed.inject(ThemeService);
    await flushMicrotasks();

    expect(service.theme()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('setTheme(): aplica el tema, lo persiste, y marca la preferencia como manual', async () => {
    mockMatchMedia(true);
    vi.mocked(Preferences.get).mockResolvedValue({ value: null });
    TestBed.configureTestingModule({});
    const service = TestBed.inject(ThemeService);
    await flushMicrotasks();

    await service.setTheme('light');

    expect(service.theme()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(Preferences.set).toHaveBeenCalledWith({ key: 'mfx-theme', value: 'light' });
  });

  it('toggle(): alterna entre dark y light', async () => {
    mockMatchMedia(true);
    vi.mocked(Preferences.get).mockResolvedValue({ value: null });
    TestBed.configureTestingModule({});
    const service = TestBed.inject(ThemeService);
    await flushMicrotasks();

    await service.toggle();
    expect(service.theme()).toBe('light');

    await service.toggle();
    expect(service.theme()).toBe('dark');
  });

  it('sigue un cambio en vivo del sistema mientras el usuario nunca haya elegido manualmente', async () => {
    const { emit } = mockMatchMedia(true);
    vi.mocked(Preferences.get).mockResolvedValue({ value: null });
    TestBed.configureTestingModule({});
    const service = TestBed.inject(ThemeService);
    await flushMicrotasks();

    emit(false);

    expect(service.theme()).toBe('light');
  });

  it('deja de seguir al sistema una vez el usuario elige manualmente (no se "pega" por accidente)', async () => {
    const { emit } = mockMatchMedia(true);
    vi.mocked(Preferences.get).mockResolvedValue({ value: null });
    TestBed.configureTestingModule({});
    const service = TestBed.inject(ThemeService);
    await flushMicrotasks();

    await service.setTheme('dark'); // elección manual explícita, aunque coincida con el sistema
    emit(false); // el sistema cambia a claro

    expect(service.theme()).toBe('dark');
  });

  it('nunca escribe en Preferences solo por seguir al sistema — solo en una elección manual', async () => {
    const { emit } = mockMatchMedia(true);
    vi.mocked(Preferences.get).mockResolvedValue({ value: null });
    TestBed.configureTestingModule({});
    TestBed.inject(ThemeService);
    await flushMicrotasks();

    emit(false);
    emit(true);

    expect(Preferences.set).not.toHaveBeenCalled();
  });

  // Regresión Fase 8 (auditoría posterior al bug del checkbox de
  // notificaciones): restoreSavedPreference() y el listener de matchMedia
  // resuelven/disparan fuera de cualquier evento que Angular trackee — sin
  // un tick manual, mfx-theme-toggle (el único que lee theme() en su
  // plantilla) puede quedarse mostrando el ícono viejo aunque el signal y
  // el <html data-theme> ya hayan cambiado. Ver el mismo patrón en
  // recurring.spec.ts (markForCheck() ahí, ApplicationRef.tick() acá
  // porque este es un servicio, no un componente).
  it('dispara un ApplicationRef.tick() al restaurar una preferencia guardada (arranque de la app)', async () => {
    mockMatchMedia(true);
    vi.mocked(Preferences.get).mockResolvedValue({ value: 'light' });
    TestBed.configureTestingModule({});
    const appRef = TestBed.inject(ApplicationRef);
    const tickSpy = vi.spyOn(appRef, 'tick').mockImplementation(() => {});

    TestBed.inject(ThemeService);
    await flushMicrotasks();

    expect(tickSpy).toHaveBeenCalled();
  });

  it('dispara un ApplicationRef.tick() cuando el sistema cambia de tema en vivo', async () => {
    const { emit } = mockMatchMedia(true);
    vi.mocked(Preferences.get).mockResolvedValue({ value: null });
    TestBed.configureTestingModule({});
    const appRef = TestBed.inject(ApplicationRef);
    TestBed.inject(ThemeService);
    await flushMicrotasks();

    const tickSpy = vi.spyOn(appRef, 'tick').mockImplementation(() => {});
    emit(false);

    expect(tickSpy).toHaveBeenCalled();
  });
});
