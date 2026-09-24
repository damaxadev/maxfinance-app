import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { NotificationBannerState } from './notification-banner-state';

describe('NotificationBannerState', () => {
  let service: NotificationBannerState;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({});
    service = TestBed.inject(NotificationBannerState);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('starts with no banner', () => {
    expect(service.banner()).toBeNull();
  });

  it('show() sets the banner', () => {
    service.show({ title: 'Pago recurrente procesado', body: 'Netflix: $70.000' });

    expect(service.banner()).toEqual({ title: 'Pago recurrente procesado', body: 'Netflix: $70.000' });
  });

  it('dismiss() clears it manually', () => {
    service.show({ title: 't', body: 'b' });
    service.dismiss();

    expect(service.banner()).toBeNull();
  });

  it('auto-dismisses after 5s', () => {
    service.show({ title: 't', body: 'b' });
    vi.advanceTimersByTime(5000);

    expect(service.banner()).toBeNull();
  });

  it('does not let a stale timeout clear a newer banner', () => {
    service.show({ title: 'first', body: 'b' });
    vi.advanceTimersByTime(4000);
    service.show({ title: 'second', body: 'b' });
    vi.advanceTimersByTime(1000); // el timeout del primero vence acá

    expect(service.banner()).toEqual({ title: 'second', body: 'b' });
  });
});
