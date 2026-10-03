import { TestBed } from '@angular/core/testing';
import { Storage } from '@angular/fire/storage';
import { vi } from 'vitest';

import { AttachmentsService } from './attachments';

const { mockUploadBytes, mockGetDownloadURL, mockDeleteObject, mockRef } = vi.hoisted(() => ({
  mockUploadBytes: vi.fn().mockResolvedValue(undefined),
  mockGetDownloadURL: vi.fn().mockResolvedValue('https://example.com/file'),
  mockDeleteObject: vi.fn().mockResolvedValue(undefined),
  mockRef: vi.fn((..._args: unknown[]) => ({ path: _args[1] as string })),
}));

vi.mock('@angular/fire/storage', () => ({
  Storage: class {},
  ref: (...args: unknown[]) => mockRef(...args),
  uploadBytes: (...args: unknown[]) => mockUploadBytes(...args),
  getDownloadURL: (...args: unknown[]) => mockGetDownloadURL(...args),
  deleteObject: (...args: unknown[]) => mockDeleteObject(...args),
}));

describe('AttachmentsService', () => {
  let service: AttachmentsService;

  beforeEach(() => {
    mockUploadBytes.mockClear().mockResolvedValue(undefined);
    mockGetDownloadURL.mockClear().mockResolvedValue('https://example.com/file');
    mockDeleteObject.mockClear().mockResolvedValue(undefined);
    mockRef.mockClear();

    TestBed.configureTestingModule({
      providers: [{ provide: Storage, useValue: {} }],
    });
    service = TestBed.inject(AttachmentsService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('uploads a blob with its content type to the given path', async () => {
    const blob = new Blob(['x']);
    await service.upload('movements/m1/attachment', blob, 'image/jpeg');

    expect(mockRef).toHaveBeenCalledWith(expect.anything(), 'movements/m1/attachment');
    expect(mockUploadBytes).toHaveBeenCalledWith({ path: 'movements/m1/attachment' }, blob, {
      contentType: 'image/jpeg',
    });
  });

  it('resolves a download URL for a path', async () => {
    const url = await service.getDownloadUrl('movements/m1/attachment');

    expect(url).toBe('https://example.com/file');
    expect(mockGetDownloadURL).toHaveBeenCalledWith({ path: 'movements/m1/attachment' });
  });

  it('removes the object at a path', async () => {
    await service.remove('movements/m1/attachment');

    expect(mockDeleteObject).toHaveBeenCalledWith({ path: 'movements/m1/attachment' });
  });

  it('remove() is best-effort — swallows an error instead of throwing (e.g. nothing was ever uploaded there)', async () => {
    mockDeleteObject.mockRejectedValue(new Error('object-not-found'));

    await expect(service.remove('movements/m1/attachment')).resolves.toBeUndefined();
  });

  // prepare() es un envoltorio inyectable sobre prepareAttachment() (ver
  // attachment-compression.ts, que ya prueba a fondo el algoritmo de
  // compresión) — acá solo se confirma la delegación, con casos que no
  // necesitan tocar canvas (PDF y tipo rechazado), para no duplicar esa
  // batería de pruebas.
  describe('prepare()', () => {
    it('delegates to prepareAttachment() — a PDF under the limit passes through unchanged', async () => {
      const file = new File([new Uint8Array(1000)], 'recibo.pdf', { type: 'application/pdf' });
      const result = await service.prepare(file);

      expect(result.blob).toBe(file);
      expect(result.contentType).toBe('application/pdf');
    });

    it('rejects an unsupported file type', async () => {
      const file = new File([new Uint8Array(10)], 'video.mp4', { type: 'video/mp4' });

      await expect(service.prepare(file)).rejects.toThrow('Solo se aceptan imágenes o archivos PDF.');
    });
  });
});
