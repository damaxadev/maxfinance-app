import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { App as CapacitorApp } from '@capacitor/app';
import { vi } from 'vitest';

import { signal } from '@angular/core';

import { App } from './app';
import { GroupDetailState } from './core/group-detail-state/group-detail-state';
import { ModalStack } from './core/modal-stack/modal-stack';
import { NotificationBannerState } from './core/notification-banner-state/notification-banner-state';
import { Notifications } from './core/notifications/notifications';
import { ThemeService } from './core/theme/theme';

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
    exitApp: vi.fn().mockResolvedValue(undefined),
  },
}));

function configure(
  listenForForegroundMessages: ReturnType<typeof vi.fn>,
  listenForNotificationTaps: ReturnType<typeof vi.fn> = vi.fn()
) {
  return TestBed.configureTestingModule({
    imports: [App],
    providers: [
      provideRouter([]),
      provideNoopAnimations(),
      {
        provide: Notifications,
        useValue: {
          ensureNotificationChannel: vi.fn().mockResolvedValue(undefined),
          listenForForegroundMessages,
          listenForNotificationTaps,
        },
      },
      // ThemeService se inyecta al arrancar la app — se stubea acá para no
      // depender de @capacitor/preferences real; su comportamiento se
      // prueba en theme.spec.ts.
      { provide: ThemeService, useValue: { theme: signal('dark').asReadonly(), toggle: vi.fn().mockResolvedValue(undefined) } },
    ],
  }).compileComponents();
}

describe('App', () => {
  let listenForForegroundMessages: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    listenForForegroundMessages = vi.fn();
    await configure(listenForForegroundMessages);
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('renders the router outlet', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('router-outlet')).toBeTruthy();
  });

  it('sets up the notification channel and the foreground listener on startup', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    expect(listenForForegroundMessages).toHaveBeenCalledWith(expect.any(Function));
  });

  it('registers a tap listener that opens the tapped group in GroupDetailState', async () => {
    const listenForNotificationTaps = vi.fn();
    TestBed.resetTestingModule();
    await configure(vi.fn(), listenForNotificationTaps);

    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();

    expect(listenForNotificationTaps).toHaveBeenCalledWith(expect.any(Function));
    const onGroupDetailTap = listenForNotificationTaps.mock.calls[0][0] as (groupId: string) => void;

    onGroupDetailTap('group1');

    expect(TestBed.inject(GroupDetailState).groupId()).toBe('group1');
  });

  it('shows a toast when a foreground notification arrives, and dismisses it', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const onMessage = listenForForegroundMessages.mock.calls[0][0] as (n: { title: string; body: string }) => void;

    onMessage({ title: 'Pago recurrente procesado', body: 'Netflix: $70.000' });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('mfx-toast')).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('Netflix: $70.000');

    const bannerState = TestBed.inject(NotificationBannerState);
    bannerState.dismiss();
    fixture.detectChanges();
    // La transición :leave (aunque sea "noop", duración 0) todavía completa
    // de forma async — hay que dejar que el ciclo de animación termine
    // antes de que el elemento salga realmente del DOM.
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('mfx-toast')).toBeFalsy();
  });

  // Fase 10: sin esto, el botón atrás de Android (default de Capacitor)
  // navega el Router o cierra la app directo, sin importar si hay un
  // mfx-modal abierto encima — ver app.ts y ModalStack.
  describe('botón atrás de Android', () => {
    function getBackButtonHandler(): (event: { canGoBack: boolean }) => void {
      const call = vi.mocked(CapacitorApp.addListener).mock.calls.find(([name]) => name === 'backButton');
      if (!call) {
        throw new Error('backButton listener was not registered');
      }
      return call[1] as (event: { canGoBack: boolean }) => void;
    }

    beforeEach(() => {
      vi.mocked(CapacitorApp.addListener).mockClear();
      vi.mocked(CapacitorApp.exitApp).mockClear();
    });

    it('registers a backButton listener on startup', () => {
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();

      expect(CapacitorApp.addListener).toHaveBeenCalledWith('backButton', expect.any(Function));
    });

    it('closes the topmost modal instead of navigating back, when one is open', () => {
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
      const onBack = vi.fn();
      TestBed.inject(ModalStack).push(onBack);

      getBackButtonHandler()({ canGoBack: true });

      expect(onBack).toHaveBeenCalled();
      expect(historyBack).not.toHaveBeenCalled();
      expect(CapacitorApp.exitApp).not.toHaveBeenCalled();
      historyBack.mockRestore();
    });

    it('falls back to history.back() when no modal is open and there is history', () => {
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      const historyBack = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);

      getBackButtonHandler()({ canGoBack: true });

      expect(historyBack).toHaveBeenCalled();
      expect(CapacitorApp.exitApp).not.toHaveBeenCalled();
      historyBack.mockRestore();
    });

    it('exits the app when no modal is open and there is no history', () => {
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();

      getBackButtonHandler()({ canGoBack: false });

      expect(CapacitorApp.exitApp).toHaveBeenCalled();
    });
  });
});
