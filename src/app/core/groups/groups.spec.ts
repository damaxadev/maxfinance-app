import { TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { Functions } from '@angular/fire/functions';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { Auth } from '../auth/auth';
import { GroupsService } from './groups';

const { mockAddDoc, mockUpdateDoc, mockCallable, mockHttpsCallable } = vi.hoisted(() => ({
  mockAddDoc: vi.fn().mockResolvedValue({ id: 'new-group-id' }),
  mockUpdateDoc: vi.fn().mockResolvedValue(undefined),
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
  arrayRemove: vi.fn((value: unknown) => ({ arrayRemove: value })),
  query: vi.fn((...args: unknown[]) => args),
  where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
  serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
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

  it('creates a group with the current user as sole member and creator', async () => {
    const id = await service.create('Apartamento');

    expect(id).toBe('new-group-id');
    expect(mockAddDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'Apartamento', members: ['u1'], createdBy: 'u1' })
    );
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
});
