import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { Celebration } from './celebration';

const { mockConfetti, mockNotification } = vi.hoisted(() => ({
  mockConfetti: vi.fn(),
  mockNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('canvas-confetti', () => ({ default: mockConfetti }));

vi.mock('@capacitor/haptics', () => ({
  Haptics: { notification: mockNotification },
  NotificationType: { Success: 'SUCCESS' },
}));

describe('Celebration', () => {
  let service: Celebration;

  beforeEach(() => {
    mockConfetti.mockClear();
    mockNotification.mockClear();

    TestBed.configureTestingModule({});
    service = TestBed.inject(Celebration);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('fires confetti and a success haptic notification', async () => {
    await service.celebrate();

    expect(mockConfetti).toHaveBeenCalledTimes(1);
    expect(mockNotification).toHaveBeenCalledWith({ type: 'SUCCESS' });
  });

  it('does not throw if haptics are unavailable', async () => {
    mockNotification.mockRejectedValueOnce(new Error('unavailable'));

    await expect(service.celebrate()).resolves.toBeUndefined();
  });
});
