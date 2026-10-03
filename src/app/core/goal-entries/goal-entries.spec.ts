import { TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { Auth } from '../auth/auth';
import { AttachmentsService } from '../attachments/attachments';
import { GoalEntriesService } from './goal-entries';
import type { GoalEntry } from '../../models/goal-entry.model';

const { mockAddDoc, mockDeleteDoc, mockUpdateDoc, mockCollectionData } = vi.hoisted(() => ({
  mockAddDoc: vi.fn().mockResolvedValue({ id: 'new-entry-id' }),
  mockDeleteDoc: vi.fn().mockResolvedValue(undefined),
  mockUpdateDoc: vi.fn().mockResolvedValue(undefined),
  mockCollectionData: vi.fn((..._args: unknown[]) => of([])),
}));

vi.mock('@angular/fire/firestore', () => ({
  Firestore: class {},
  collection: vi.fn((_fs, path) => ({ path })),
  collectionData: (...args: unknown[]) => mockCollectionData(...args),
  doc: vi.fn((_fs, path, id) => ({ path, id })),
  addDoc: (...args: unknown[]) => mockAddDoc(...args),
  deleteDoc: (...args: unknown[]) => mockDeleteDoc(...args),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  query: vi.fn((...args: unknown[]) => args),
  where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
  Timestamp: {
    fromDate: vi.fn((date: Date) => ({ toDate: () => date })),
  },
}));

describe('GoalEntriesService', () => {
  let service: GoalEntriesService;
  let attachmentUpload: ReturnType<typeof vi.fn>;
  let attachmentRemove: ReturnType<typeof vi.fn>;
  const fakeUser = { uid: 'u1' };

  const fakeEntry: GoalEntry = {
    groupId: 'goal1',
    uid: 'u1',
    type: 'contribution',
    amount: 1000,
    date: { toDate: () => new Date() } as never,
    note: '',
  };

  beforeEach(() => {
    mockAddDoc.mockClear().mockResolvedValue({ id: 'new-entry-id' });
    mockDeleteDoc.mockClear();
    mockUpdateDoc.mockClear().mockResolvedValue(undefined);
    mockCollectionData.mockClear().mockReturnValue(of([]));
    attachmentUpload = vi.fn().mockResolvedValue(undefined);
    attachmentRemove = vi.fn().mockResolvedValue(undefined);

    TestBed.configureTestingModule({
      providers: [
        { provide: Firestore, useValue: {} },
        { provide: Auth, useValue: { currentUser$: of(fakeUser), currentUser: fakeUser } },
        { provide: AttachmentsService, useValue: { upload: attachmentUpload, remove: attachmentRemove } },
      ],
    });
    service = TestBed.inject(GoalEntriesService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('creates a contribution entry with the current uid and a Timestamp date, resolving with the new id', async () => {
    const date = new Date('2026-05-01T12:00:00');
    const id = await service.create({ groupId: 'goal1', type: 'contribution', amount: 50000, date, note: 'Ahorro de mayo' });

    expect(id).toBe('new-entry-id');
    expect(mockAddDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        groupId: 'goal1',
        uid: 'u1',
        type: 'contribution',
        amount: 50000,
        note: 'Ahorro de mayo',
      })
    );
    const [, entry] = mockAddDoc.mock.calls[0];
    expect(entry.date.toDate()).toEqual(date);
  });

  it('creates a withdrawal entry the same way', async () => {
    await service.create({
      groupId: 'goal1',
      type: 'withdrawal',
      amount: 20000,
      date: new Date(),
      note: '',
    });

    expect(mockAddDoc).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'withdrawal' }));
  });

  describe('attachFile()', () => {
    it('uploads the blob to a fixed path and writes attachmentPath/attachmentContentType on the entry', async () => {
      const blob = new Blob(['x']);
      await service.attachFile('entry1', { blob, contentType: 'application/pdf' });

      expect(attachmentUpload).toHaveBeenCalledWith('goalEntries/entry1/attachment', blob, 'application/pdf');
      expect(mockUpdateDoc).toHaveBeenCalledWith(expect.objectContaining({ id: 'entry1' }), {
        attachmentPath: 'goalEntries/entry1/attachment',
        attachmentContentType: 'application/pdf',
      });
    });
  });

  describe('remove()', () => {
    it('deletes the entry by id', async () => {
      await service.remove('entry1', fakeEntry);

      expect(mockDeleteDoc).toHaveBeenCalledWith({ path: 'goalEntries', id: 'entry1' });
    });

    it('best-effort deletes the attachment when the entry had one', async () => {
      await service.remove('entry1', { ...fakeEntry, attachmentPath: 'goalEntries/entry1/attachment' });

      expect(attachmentRemove).toHaveBeenCalledWith('goalEntries/entry1/attachment');
    });

    it('does not touch Storage when there was no attachment', async () => {
      await service.remove('entry1', fakeEntry);

      expect(attachmentRemove).not.toHaveBeenCalled();
    });
  });

  it('rejects creating an entry when there is no authenticated user', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: Firestore, useValue: {} },
        { provide: Auth, useValue: { currentUser$: of(null), currentUser: null } },
        { provide: AttachmentsService, useValue: { upload: vi.fn(), remove: vi.fn() } },
      ],
    });
    const unauthenticatedService = TestBed.inject(GoalEntriesService);

    await expect(
      unauthenticatedService.create({ groupId: 'goal1', type: 'contribution', amount: 1, date: new Date(), note: '' })
    ).rejects.toThrow('No hay un usuario autenticado.');
  });
});
