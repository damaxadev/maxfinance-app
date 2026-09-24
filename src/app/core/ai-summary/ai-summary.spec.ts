import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import { AiSummary, type SummaryContext } from './ai-summary';
import { Auth } from '../auth/auth';

const CONTEXT: SummaryContext = {
  accounts: [{ name: 'Efectivo', balance: 100000 }],
  categoryTotals: [{ category: 'Mercado', total: 50000 }],
  budget: { limit: 200000, spent: 50000, percentage: 25 },
};

describe('AiSummary', () => {
  let service: AiSummary;
  let getIdToken: ReturnType<typeof vi.fn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getIdToken = vi.fn().mockResolvedValue('fake-id-token');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    TestBed.configureTestingModule({
      providers: [{ provide: Auth, useValue: { getIdToken } }],
    });
    service = TestBed.inject(AiSummary);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('rejects without calling the Worker when there is no signed-in user', async () => {
    getIdToken.mockResolvedValue(null);

    await expect(service.analyze(CONTEXT)).rejects.toThrow('No hay una sesión activa.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs the context with the ID token as a bearer and returns the parsed result', async () => {
    const result = { summary: 'Te fue bien este mes.', cached: false, generatedAt: '2026-03-15T00:00:00.000Z' };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(result), { status: 200 }));

    await expect(service.analyze(CONTEXT)).resolves.toEqual(result);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/summary'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer fake-id-token' }),
        body: JSON.stringify(CONTEXT),
      })
    );
  });

  it('throws a friendly error when the Worker responds with a non-2xx status', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'ai_unavailable' }), { status: 502 }));

    await expect(service.analyze(CONTEXT)).rejects.toThrow('No se pudo generar el análisis');
  });

  it('throws a friendly error when the network call itself fails', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    await expect(service.analyze(CONTEXT)).rejects.toThrow('No se pudo conectar');
  });
});
