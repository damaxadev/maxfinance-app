import { TestBed } from '@angular/core/testing';
import { Firestore, updateDoc } from '@angular/fire/firestore';
import { FirebaseMessaging, Importance } from '@capacitor-firebase/messaging';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { Auth } from '../auth/auth';
import { Notifications, RECURRING_PAYMENTS_CHANNEL_ID } from './notifications';

vi.mock('@angular/fire/firestore', () => ({
  Firestore: class {},
  doc: vi.fn((_fs, path, id) => ({ path, id })),
  updateDoc: vi.fn().mockResolvedValue(undefined),
  arrayUnion: vi.fn((value: unknown) => ({ __op: 'arrayUnion', value })),
}));

vi.mock('@capacitor-firebase/messaging', () => ({
  FirebaseMessaging: {
    isSupported: vi.fn(),
    checkPermissions: vi.fn(),
    requestPermissions: vi.fn(),
    getToken: vi.fn(),
    createChannel: vi.fn().mockResolvedValue(undefined),
    addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
  },
  Importance: { Min: 1, Low: 2, Default: 3, High: 4, Max: 5 },
}));

describe('Notifications', () => {
  let service: Notifications;
  const fakeUser = { uid: 'u1' };

  beforeEach(() => {
    localStorage.clear();
    vi.mocked(updateDoc).mockClear();
    vi.mocked(FirebaseMessaging.isSupported).mockReset().mockResolvedValue({ isSupported: true });
    vi.mocked(FirebaseMessaging.checkPermissions).mockReset().mockResolvedValue({ receive: 'prompt' });
    vi.mocked(FirebaseMessaging.requestPermissions).mockReset().mockResolvedValue({ receive: 'prompt' });
    vi.mocked(FirebaseMessaging.getToken).mockReset().mockResolvedValue({ token: 'fake-token' });
    vi.mocked(FirebaseMessaging.createChannel).mockReset().mockResolvedValue(undefined);
    vi.mocked(FirebaseMessaging.addListener).mockReset().mockResolvedValue({ remove: vi.fn() });

    TestBed.configureTestingModule({
      providers: [
        { provide: Firestore, useValue: {} },
        { provide: Auth, useValue: { currentUser$: of(fakeUser), currentUser: fakeUser } },
      ],
    });
    service = TestBed.inject(Notifications);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('checkStatus()', () => {
    it('reports "granted" when the permission is already granted', async () => {
      vi.mocked(FirebaseMessaging.checkPermissions).mockResolvedValue({ receive: 'granted' });
      expect(await service.checkStatus()).toBe('granted');
    });

    it('reports "prompt" when never asked', async () => {
      vi.mocked(FirebaseMessaging.checkPermissions).mockResolvedValue({ receive: 'prompt' });
      expect(await service.checkStatus()).toBe('prompt');
    });

    it('reports "denied" (not permanently) the first time it comes back denied', async () => {
      vi.mocked(FirebaseMessaging.checkPermissions).mockResolvedValue({ receive: 'denied' });
      expect(await service.checkStatus()).toBe('denied');
    });

    it('reports "denied-permanently" if we already asked once before in this device', async () => {
      localStorage.setItem('mfx-notifications-asked', 'true');
      vi.mocked(FirebaseMessaging.checkPermissions).mockResolvedValue({ receive: 'denied' });

      expect(await service.checkStatus()).toBe('denied-permanently');
    });
  });

  describe('enable()', () => {
    it('does nothing and reports "denied" when the platform does not support messaging', async () => {
      vi.mocked(FirebaseMessaging.isSupported).mockResolvedValue({ isSupported: false });

      const result = await service.enable();

      expect(result).toBe('denied');
      expect(FirebaseMessaging.checkPermissions).not.toHaveBeenCalled();
    });

    it('requests permission and registers the token when granted', async () => {
      vi.mocked(FirebaseMessaging.checkPermissions).mockResolvedValue({ receive: 'prompt' });
      vi.mocked(FirebaseMessaging.requestPermissions).mockResolvedValue({ receive: 'granted' });

      const result = await service.enable();

      expect(result).toBe('granted');
      expect(FirebaseMessaging.getToken).toHaveBeenCalled();
      expect(updateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'users', id: 'u1' }),
        { fcmTokens: { __op: 'arrayUnion', value: 'fake-token' } }
      );
    });

    it('re-registers the token without re-requesting when already granted', async () => {
      vi.mocked(FirebaseMessaging.checkPermissions).mockResolvedValue({ receive: 'granted' });

      const result = await service.enable();

      expect(result).toBe('granted');
      expect(FirebaseMessaging.requestPermissions).not.toHaveBeenCalled();
      expect(FirebaseMessaging.getToken).toHaveBeenCalled();
    });

    it('marks that we asked, and reports "denied" (not yet permanent) on a fresh denial', async () => {
      vi.mocked(FirebaseMessaging.checkPermissions).mockResolvedValue({ receive: 'prompt' });
      vi.mocked(FirebaseMessaging.requestPermissions).mockResolvedValue({ receive: 'denied' });

      const result = await service.enable();

      expect(result).toBe('denied');
      expect(localStorage.getItem('mfx-notifications-asked')).toBe('true');
      expect(updateDoc).not.toHaveBeenCalled();
    });

    it('reports "denied-permanently" and never re-prompts when the user already said no once', async () => {
      localStorage.setItem('mfx-notifications-asked', 'true');
      vi.mocked(FirebaseMessaging.checkPermissions).mockResolvedValue({ receive: 'denied' });

      const result = await service.enable();

      expect(result).toBe('denied-permanently');
      expect(FirebaseMessaging.requestPermissions).not.toHaveBeenCalled();
    });

    it('still reports "granted" even if fetching/saving the token fails (best effort)', async () => {
      vi.mocked(FirebaseMessaging.checkPermissions).mockResolvedValue({ receive: 'granted' });
      vi.mocked(FirebaseMessaging.getToken).mockRejectedValue(new Error('no vapid key configured'));

      const result = await service.enable();

      expect(result).toBe('granted');
    });
  });

  describe('ensureNotificationChannel()', () => {
    it('creates the fixed recurring-payments channel', async () => {
      await service.ensureNotificationChannel();

      expect(FirebaseMessaging.createChannel).toHaveBeenCalledWith(
        expect.objectContaining({ id: RECURRING_PAYMENTS_CHANNEL_ID, importance: Importance.Default })
      );
    });

    it('never throws even if the platform does not support channels (e.g. web)', async () => {
      vi.mocked(FirebaseMessaging.createChannel).mockRejectedValue(new Error('not supported on web'));

      await expect(service.ensureNotificationChannel()).resolves.toBeUndefined();
    });
  });

  describe('listenForForegroundMessages()', () => {
    it('registers a notificationReceived listener', () => {
      const onMessage = vi.fn();

      service.listenForForegroundMessages(onMessage);

      expect(FirebaseMessaging.addListener).toHaveBeenCalledWith('notificationReceived', expect.any(Function));
    });

    it('forwards the title/body from the event to the callback', () => {
      const onMessage = vi.fn();
      service.listenForForegroundMessages(onMessage);
      const handler = vi.mocked(FirebaseMessaging.addListener).mock.calls[0][1] as (event: unknown) => void;

      handler({ notification: { title: 'Pago recurrente procesado', body: 'Netflix: $70.000' } });

      expect(onMessage).toHaveBeenCalledWith({ title: 'Pago recurrente procesado', body: 'Netflix: $70.000' });
    });

    it('falls back to sensible defaults when title/body are missing', () => {
      const onMessage = vi.fn();
      service.listenForForegroundMessages(onMessage);
      const handler = vi.mocked(FirebaseMessaging.addListener).mock.calls[0][1] as (event: unknown) => void;

      handler({ notification: {} });

      expect(onMessage).toHaveBeenCalledWith({ title: 'MaxFinance', body: '' });
    });
  });
});
