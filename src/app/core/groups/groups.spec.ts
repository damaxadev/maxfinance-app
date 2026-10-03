import { TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { Functions } from '@angular/fire/functions';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { Auth } from '../auth/auth';
import { GroupsService } from './groups';

const { mockAddDoc, mockUpdateDoc, mockDeleteDoc, mockGetDocs, mockCallable, mockHttpsCallable } = vi.hoisted(() => ({
  mockAddDoc: vi.fn().mockResolvedValue({ id: 'new-group-id' }),
  mockUpdateDoc: vi.fn().mockResolvedValue(undefined),
  mockDeleteDoc: vi.fn().mockResolvedValue(undefined),
  mockGetDocs: vi.fn().mockResolvedValue({ empty: true }),
  mockCallable: vi.fn().mockResolvedValue({ data: { success: true } }),
  mockHttpsCallable: vi.fn(),
}));

vi.mock('@angular/fire/firestore', () => ({
  Firestore: class {},
  collection: vi.fn((_fs, path) => ({ path })),
  collectionData: vi.fn(() => of([])),
  doc: vi.fn((_fs, path, id) => ({ path, id })),
  addDoc: (...args: unknown[]) => mockAddDoc(...args),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  deleteDoc: (...args: unknown[]) => mockDeleteDoc(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  arrayRemove: vi.fn((value: unknown) => ({ arrayRemove: value })),
  arrayUnion: vi.fn((...values: unknown[]) => ({ arrayUnion: values })),
  query: vi.fn((...args: unknown[]) => args),
  where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
  limit: vi.fn((n: number) => ({ limit: n })),
  serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
  Timestamp: {
    now: vi.fn(() => ({ toMillis: () => 0 })),
    fromDate: vi.fn((date: Date) => ({ toDate: () => date })),
  },
}));

vi.mock('@angular/fire/functions', () => ({
  Functions: class {},
  httpsCallable: (...args: unknown[]) => mockHttpsCallable(...args),
}));

describe('GroupsService', () => {
  let service: GroupsService;
  const fakeUser = { uid: 'u1' };

  beforeEach(() => {
    mockAddDoc.mockClear().mockResolvedValue({ id: 'new-group-id' });
    mockUpdateDoc.mockClear();
    mockDeleteDoc.mockClear();
    mockGetDocs.mockClear().mockResolvedValue({ empty: true });
    mockHttpsCallable.mockClear().mockReturnValue(mockCallable);
    mockCallable.mockClear().mockResolvedValue({ data: { success: true } });
    vi.mocked(FirebaseAuthentication.getCurrentUser).mockReset().mockResolvedValue({ user: null });
    vi.mocked(FirebaseAuthentication.addListener).mockReset().mockResolvedValue({ remove: vi.fn() });

    TestBed.configureTestingModule({
      providers: [
        { provide: Firestore, useValue: {} },
        { provide: Functions, useValue: {} },
        { provide: Auth, useValue: { currentUser$: of(fakeUser), currentUser: fakeUser } },
      ],
    });
    service = TestBed.inject(GroupsService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('creates a shared group with the current user as sole member and creator', async () => {
    const id = await service.create('Apartamento', 'shared');

    expect(id).toBe('new-group-id');
    expect(mockAddDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'Apartamento', members: ['u1'], createdBy: 'u1', type: 'shared' })
    );
  });

  it('creates a personal group with the type it was given', async () => {
    await service.create('Ahorros', 'personal');

    expect(mockAddDoc).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'personal' }));
  });

  it('leaves a group via the leaveGroup callable', async () => {
    await service.leave('group1');

    expect(mockHttpsCallable).toHaveBeenCalledWith(expect.anything(), 'leaveGroup');
    expect(mockCallable).toHaveBeenCalledWith({ groupId: 'group1' });
  });

  it('removes another member directly against Firestore (no callable needed)', async () => {
    await service.removeMember('group1', 'u2');

    expect(mockUpdateDoc).toHaveBeenCalledWith(expect.anything(), { members: { arrayRemove: 'u2' } });
  });

  it('invites a member by email via the inviteGroupMember callable', async () => {
    mockCallable.mockResolvedValue({ data: { uid: 'u2' } });

    await service.inviteByEmail('group1', 'friend@example.com');

    expect(mockHttpsCallable).toHaveBeenCalledWith(expect.anything(), 'inviteGroupMember');
    expect(mockCallable).toHaveBeenCalledWith({ groupId: 'group1', email: 'friend@example.com' });
  });

  it('translates a callable error into a plain Error with its message', async () => {
    mockCallable.mockRejectedValue(new Error('Esta persona aún no tiene cuenta en MaxFinance.'));

    await expect(service.inviteByEmail('group1', 'nobody@example.com')).rejects.toThrow(
      'Esta persona aún no tiene cuenta en MaxFinance.'
    );
  });

  it('fetches member profiles via the getGroupMembers callable', async () => {
    mockCallable.mockResolvedValue({
      data: [{ uid: 'u1', displayName: 'Diego', email: 'diego@example.com', photoURL: '' }],
    });

    const profiles = await service.getMemberProfiles('group1');

    expect(mockHttpsCallable).toHaveBeenCalledWith(expect.anything(), 'getGroupMembers');
    expect(profiles).toEqual([{ uid: 'u1', displayName: 'Diego', email: 'diego@example.com', photoURL: '' }]);
  });

  it('invites a known contact by uid via the same inviteGroupMember callable', async () => {
    mockCallable.mockResolvedValue({ data: { uid: 'u2' } });

    await service.inviteByUid('group1', 'u2');

    expect(mockHttpsCallable).toHaveBeenCalledWith(expect.anything(), 'inviteGroupMember');
    expect(mockCallable).toHaveBeenCalledWith({ groupId: 'group1', uid: 'u2' });
  });

  it('fetches known-contact suggestions via the getKnownContacts callable, with no arguments', async () => {
    mockCallable.mockResolvedValue({
      data: [{ uid: 'u2', displayName: 'Ana', email: 'ana@example.com', photoURL: '' }],
    });

    const contacts = await service.getKnownContacts();

    expect(mockHttpsCallable).toHaveBeenCalledWith(expect.anything(), 'getKnownContacts');
    expect(mockCallable).toHaveBeenCalledWith(undefined);
    expect(contacts).toEqual([{ uid: 'u2', displayName: 'Ana', email: 'ana@example.com', photoURL: '' }]);
  });

  it('removes a group with no linked movements or settlements', async () => {
    await service.remove('group1');

    expect(mockDeleteDoc).toHaveBeenCalledWith({ path: 'groups', id: 'group1' });
  });

  it('refuses to remove a group that still has shared movements', async () => {
    mockGetDocs.mockResolvedValueOnce({ empty: false }).mockResolvedValueOnce({ empty: true });

    await expect(service.remove('group1')).rejects.toThrow(/gastos registrados/);
    expect(mockDeleteDoc).not.toHaveBeenCalled();
  });

  it('refuses to remove a group that still has settlements', async () => {
    mockGetDocs.mockResolvedValueOnce({ empty: true }).mockResolvedValueOnce({ empty: false });

    await expect(service.remove('group1')).rejects.toThrow(/gastos registrados/);
    expect(mockDeleteDoc).not.toHaveBeenCalled();
  });

  it('refuses to remove a savings goal that still has ledger entries', async () => {
    mockGetDocs
      .mockResolvedValueOnce({ empty: true })
      .mockResolvedValueOnce({ empty: true })
      .mockResolvedValueOnce({ empty: false });

    await expect(service.remove('goal1')).rejects.toThrow(/gastos registrados/);
    expect(mockDeleteDoc).not.toHaveBeenCalled();
  });

  describe('createGoal()', () => {
    const baseTargetInput = {
      name: 'Vacaciones',
      goalMode: 'target' as const,
      targetAmount: 2000000,
      celebrationAmount: null,
      targetDate: null,
      reminderFrequency: null,
      reminderSuggestedAmount: null,
    };

    it('creates a "target" goal with type "savings", the goal fields, current user as sole member/creator, and an empty reachedMilestones', async () => {
      const id = await service.createGoal(baseTargetInput);

      expect(id).toBe('new-group-id');
      expect(mockAddDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          name: 'Vacaciones',
          members: ['u1'],
          createdBy: 'u1',
          type: 'savings',
          goalMode: 'target',
          targetAmount: 2000000,
          celebrationAmount: null,
          reachedMilestones: [],
          targetDate: null,
          reminderFrequency: null,
          reminderSuggestedAmount: null,
          nextReminderDate: null,
        })
      );
    });

    it('creates an "open-ended" goal with celebrationAmount set and targetAmount null', async () => {
      await service.createGoal({ ...baseTargetInput, goalMode: 'open-ended', targetAmount: null, celebrationAmount: 1000000 });

      expect(mockAddDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ goalMode: 'open-ended', targetAmount: null, celebrationAmount: 1000000 })
      );
    });

    it('sets targetDate as a Timestamp when given', async () => {
      const targetDate = new Date('2026-12-01T12:00:00');
      await service.createGoal({ ...baseTargetInput, targetDate });

      const [, value] = mockAddDoc.mock.calls[0];
      expect(value.targetDate.toDate()).toEqual(targetDate);
    });

    it('sets nextReminderDate (and keeps reminderSuggestedAmount) only when a reminderFrequency is given', async () => {
      await service.createGoal({ ...baseTargetInput, reminderFrequency: 'weekly', reminderSuggestedAmount: 50000 });

      expect(mockAddDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          reminderFrequency: 'weekly',
          reminderSuggestedAmount: 50000,
          nextReminderDate: expect.anything(),
        })
      );
    });

    it('drops reminderSuggestedAmount when no reminderFrequency is chosen, even if one was passed in', async () => {
      await service.createGoal({ ...baseTargetInput, reminderSuggestedAmount: 50000 });

      expect(mockAddDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ reminderSuggestedAmount: null, nextReminderDate: null })
      );
    });
  });

  describe('markMilestonesReached()', () => {
    it('adds the given milestones to reachedMilestones via arrayUnion', async () => {
      await service.markMilestonesReached('goal1', [50, 75]);

      expect(mockUpdateDoc).toHaveBeenCalledWith(expect.anything(), { reachedMilestones: { arrayUnion: [50, 75] } });
    });

    it('does nothing (no Firestore write) when there are no new milestones', async () => {
      await service.markMilestonesReached('goal1', []);

      expect(mockUpdateDoc).not.toHaveBeenCalled();
    });
  });
});
