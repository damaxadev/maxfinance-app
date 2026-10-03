import { vi } from 'vitest';

import {
  classifyAttachment,
  compressImage,
  INITIAL_COMPRESSION_ATTEMPT,
  MAX_ATTACHMENT_BYTES,
  nextCompressionAttempt,
  prepareAttachment,
  prepareForAi,
} from './attachment-compression';

describe('classifyAttachment', () => {
  it('classifies application/pdf as "pdf"', () => {
    expect(classifyAttachment('application/pdf')).toBe('pdf');
  });

  it('classifies any image/* mime type as "image"', () => {
    expect(classifyAttachment('image/png')).toBe('image');
    expect(classifyAttachment('image/heic')).toBe('image');
  });

  it('rejects anything that is not an image or a PDF', () => {
    expect(() => classifyAttachment('video/mp4')).toThrow('Solo se aceptan imágenes o archivos PDF.');
    expect(() => classifyAttachment('application/msword')).toThrow('Solo se aceptan imágenes o archivos PDF.');
  });
});

describe('nextCompressionAttempt', () => {
  it('starts at the documented initial attempt', () => {
    expect(INITIAL_COMPRESSION_ATTEMPT).toEqual({ quality: 0.8, maxDimension: 1600 });
  });

  it('lowers quality in 0.1 steps first', () => {
    expect(nextCompressionAttempt({ quality: 0.8, maxDimension: 1600 })).toEqual({ quality: 0.7, maxDimension: 1600 });
    expect(nextCompressionAttempt({ quality: 0.7, maxDimension: 1600 })).toEqual({ quality: 0.6, maxDimension: 1600 });
  });

  it('switches to shrinking maxDimension once quality hits its floor (0.4)', () => {
    expect(nextCompressionAttempt({ quality: 0.4, maxDimension: 1600 })).toEqual({ quality: 0.4, maxDimension: 1280 });
  });

  it('keeps shrinking maxDimension by 20% per step past the quality floor', () => {
    let attempt = nextCompressionAttempt({ quality: 0.4, maxDimension: 1600 })!;
    expect(attempt.maxDimension).toBe(1280);
    attempt = nextCompressionAttempt(attempt)!;
    expect(attempt.maxDimension).toBe(1024);
  });

  it('returns null once both floors are reached — no more margin to try', () => {
    expect(nextCompressionAttempt({ quality: 0.4, maxDimension: 800 })).toBeNull();
  });
});

// jsdom no implementa un contexto 2D de canvas real (mismo motivo que en
// home.spec.ts/group-detail.spec.ts para Chart.js) — se mockea Image y
// HTMLCanvasElement para probar la ORQUESTACIÓN (cuántos intentos, con
// qué calidad, cuándo se rinde) sin depender de un render real.
describe('compressImage / prepareAttachment (canvas mockeado)', () => {
  let blobSizes: number[];
  let toBlobCalls: { quality: number }[];

  beforeEach(() => {
    toBlobCalls = [];

    class FakeImage {
      naturalWidth = 2000;
      naturalHeight = 1000;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        Promise.resolve().then(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', FakeImage);
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:fake'), revokeObjectURL: vi.fn() });

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
      (callback: BlobCallback, _type?: string, quality?: number) => {
        toBlobCalls.push({ quality: quality ?? 1 });
        const size = blobSizes[toBlobCalls.length - 1] ?? blobSizes[blobSizes.length - 1];
        callback(new Blob([new Uint8Array(size)]));
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function fakeFile(type: string, size: number, name = 'file'): File {
    return new File([new Uint8Array(size)], name, { type });
  }

  it('compresses in a single attempt if it already fits under the budget', async () => {
    blobSizes = [1000];
    const blob = await compressImage(fakeFile('image/png', 5_000_000), 2000);

    expect(blob.size).toBe(1000);
    expect(toBlobCalls).toEqual([{ quality: 0.8 }]);
  });

  it('retries with lower quality, in order, until it fits under the budget', async () => {
    blobSizes = [5000, 3000, 1000];
    const blob = await compressImage(fakeFile('image/jpeg', 5_000_000), 2000);

    expect(blob.size).toBe(1000);
    expect(toBlobCalls.map((c) => c.quality)).toEqual([0.8, 0.7, 0.6]);
  });

  it('gives up and returns the last attempt once nextCompressionAttempt runs out of margin', async () => {
    blobSizes = [9000]; // el mock siempre devuelve el mismo tamaño, imposible de bajar
    const blob = await compressImage(fakeFile('image/jpeg', 5_000_000), 100);

    expect(blob.size).toBe(9000);
    expect(toBlobCalls.length).toBeGreaterThan(1); // agotó los reintentos, no se dio por vencido al primero
  });

  describe('prepareAttachment', () => {
    it('compresses an image and always re-encodes it to image/jpeg', async () => {
      blobSizes = [1000];
      const result = await prepareAttachment(fakeFile('image/png', 5_000_000), 2000);

      expect(result.contentType).toBe('image/jpeg');
      expect(result.blob.size).toBe(1000);
    });

    it('passes a PDF through unchanged (no compression) when under the size limit', async () => {
      const file = fakeFile('application/pdf', 1_000_000, 'recibo.pdf');
      const result = await prepareAttachment(file, MAX_ATTACHMENT_BYTES);

      expect(result.blob).toBe(file);
      expect(result.contentType).toBe('application/pdf');
      expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
    });

    it('rejects a PDF over the size limit, with no compression attempt (PDFs are never compressed)', async () => {
      const file = fakeFile('application/pdf', 5_000_000, 'recibo.pdf');

      await expect(prepareAttachment(file, 4_000_000)).rejects.toThrow(/no puede superar/);
      expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
    });

    it('rejects an unsupported file type before touching canvas at all', async () => {
      await expect(prepareAttachment(fakeFile('video/mp4', 1000))).rejects.toThrow(
        'Solo se aceptan imágenes o archivos PDF.'
      );
      expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
    });
  });

  // prepareForAi() — copia de mayor calidad para ReceiptReader, nunca se
  // sube a Storage. Nunca lanza (AttachmentPicker la llama sin bloquear el
  // adjunto real si algo sale mal), por eso todos los casos de fallo
  // esperan null en vez de un rechazo.
  describe('prepareForAi', () => {
    it('encodes an image in a single pass at quality 0.9 / maxDimension 1568, as base64', async () => {
      blobSizes = [1234];
      const result = await prepareForAi(fakeFile('image/png', 5_000_000));

      expect(result?.mediaType).toBe('image/jpeg');
      expect(result?.base64).toBeTruthy();
      expect(result?.base64.startsWith('data:')).toBe(false);
      expect(toBlobCalls).toEqual([{ quality: 0.9 }]);
    });

    it('sends a PDF through as base64 unchanged (no canvas/compression at all)', async () => {
      const file = fakeFile('application/pdf', 2000, 'recibo.pdf');
      const result = await prepareForAi(file);

      expect(result?.mediaType).toBe('application/pdf');
      expect(result?.base64).toBeTruthy();
      expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
    });

    it('returns null (not a throw) for an unsupported file type', async () => {
      await expect(prepareForAi(fakeFile('video/mp4', 1000))).resolves.toBeNull();
      expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
    });

    it('returns null (not a throw) when the canvas context is unavailable', async () => {
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

      await expect(prepareForAi(fakeFile('image/png', 1000))).resolves.toBeNull();
    });
  });
});
