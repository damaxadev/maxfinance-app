import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';

import { signal } from '@angular/core';

import { App } from './app';
import { NotificationBannerState } from './core/notification-banner-state/notification-banner-state';
import { Notifications } from './core/notifications/notifications';
import { ThemeService } from './core/theme/theme';

function configure(listenForForegroundMessages: ReturnType<typeof vi.fn>) {
  return TestBed.configureTestingModule({
    imports: [App],
    providers: [
      provideRouter([]),
      provideNoopAnimations(),
      {
        provide: Notifications,
        useValue: { ensureNotificationChannel: vi.fn().mockResolvedValue(undefined), listenForForegroundMessages },
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
});
