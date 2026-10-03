import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { ReceiptReader } from './receipt-reader';
import { Auth } from '../auth/auth';
import type { AiPreview } from '../attachments/attachment-compression';

const PREVIEW: AiPreview = { base64: 'BASE64DATA', mediaType: 'image/jpeg' };

const EXTRACTION = {
  amount: 45000,
  currency: 'COP',
  date: '2026-09-30',
  merchant: 'Supermercado La 14',
  suggestedCategory: 'Supermercado',
  lineItems: null,
  confidence: 'high' as const,
};

describe('ReceiptReader', () => {
  let service: ReceiptReader;
  let getIdToken: ReturnType<typeof vi.fn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getIdToken = vi.fn().mockResolvedValue('fake-id-token');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    TestBed.configureTestingModule({
      providers: [{ provide: Auth, useValue: { getIdToken } }],
    });
    service = TestBed.inject(ReceiptReader);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('rejects without calling the Worker when there is no signed-in user', async () => {
    getIdToken.mockResolvedValue(null);

    await expect(service.extract(PREVIEW)).rejects.toThrow('No hay una sesión activa.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs {mediaType, data} with the ID token as a bearer and returns the parsed extraction', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(EXTRACTION), { status: 200 }));

    await expect(service.extract(PREVIEW)).resolves.toEqual(EXTRACTION);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/receipt'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer fake-id-token' }),
        body: JSON.stringify({ mediaType: 'image/jpeg', data: 'BASE64DATA' }),
      })
    );
  });

  it('passes the AbortSignal through to fetch()', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(EXTRACTION), { status: 200 }));
    const controller = new AbortController();

    await service.extract(PREVIEW, { signal: controller.signal });

    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ signal: controller.signal }));
  });

  it('re-throws an AbortError as-is, not as a generic connection error', async () => {
    const abortError = new DOMException('aborted', 'AbortError');
    fetchMock.mockRejectedValue(abortError);

    await expect(service.extract(PREVIEW)).rejects.toBe(abortError);
  });

  it('throws a friendly error when the Worker responds with a non-2xx status (502, ai_unavailable)', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'ai_unavailable' }), { status: 502 }));

    await expect(service.extract(PREVIEW)).rejects.toThrow('No se pudo leer el recibo.');
  });

  // fetch() NUNCA rechaza por un status HTTP no-2xx (eso es estándar de la
  // Fetch API) — sin el check explícito de response.ok, un 429 se
  // "colaría" como si fuera un ReceiptExtraction válido (el body
  // {error:'rate_limited'} no trae confidence, así que el guard de 'low'
  // en MovementForm nunca se dispararía). Confirma que SÍ se detecta.
  it('throws (does not silently resolve) on a 429 rate_limited response', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429 }));

    await expect(service.extract(PREVIEW)).rejects.toThrow('No se pudo leer el recibo.');
  });

  it('throws a friendly error when the network call itself fails', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    await expect(service.extract(PREVIEW)).rejects.toThrow('No se pudo conectar');
  });
});
