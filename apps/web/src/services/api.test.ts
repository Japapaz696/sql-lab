import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErroDeApi, idDaSessao } from './api';

describe('cliente da API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('envia o identificador de sessão em toda requisição', async () => {
    const spy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ cenarios: [], progresso: { total: 0, resolvidos: 0 } }),
    });
    vi.stubGlobal('fetch', spy);

    const { listarCenarios } = await import('./api');
    await listarCenarios();

    const [, opcoes] = spy.mock.calls[0] as [string, RequestInit];
    const headers = opcoes.headers as Headers;
    expect(headers.get('X-Sessao-Id')).toMatch(/^[0-9a-f]{32}$/);
  });

  it('usa a mensagem do servidor no erro', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Cenário não encontrado' }),
      }),
    );

    const { detalharCenario } = await import('./api');
    await expect(detalharCenario('inexistente')).rejects.toThrow('Cenário não encontrado');
  });

  it('usa a mensagem padrão quando a resposta não tem JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new SyntaxError('sem json');
        },
      }),
    );

    const { detalharCenario } = await import('./api');
    await expect(detalharCenario('x')).rejects.toThrow(/500/);
  });

  it('preserva o status no erro', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Cenário não encontrado' }),
      }),
    );

    const { detalharCenario } = await import('./api');
    await expect(detalharCenario('x')).rejects.toMatchObject({ status: 404 });
  });

  it('envia o SQL no corpo da execução', async () => {
    const spy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ consulta: {}, verificacao: {}, tentativas: 1, resolvido: false }),
    });
    vi.stubGlobal('fetch', spy);

    const { executarCenario } = await import('./api');
    await executarCenario('cenario-1', 'SELECT 1');

    const [, opcoes] = spy.mock.calls[0] as [string, RequestInit];
    expect(opcoes.method).toBe('POST');
    expect(JSON.parse(opcoes.body as string)).toEqual({ sql: 'SELECT 1' });
  });
});

/**
 * Em hospedagem gratuita, a API hiberna depois de um tempo sem tráfego e leva
 * cerca de um minuto para acordar. A interface precisa tratar isso como
 * "está acordando", e não como "está quebrada".
 */
describe('partida a frio da API', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('repete a requisição quando a API não responde', async () => {
    let chamadas = 0;
    const spy = vi.fn().mockImplementation(async () => {
      chamadas += 1;
      if (chamadas < 3) throw new TypeError('fetch failed');
      return { ok: true, status: 200, json: async () => ({ cenarios: [] }) };
    });
    vi.stubGlobal('fetch', spy);

    const { listarCenarios } = await import('./api');
    const promessa = listarCenarios();
    await vi.advanceTimersByTimeAsync(10_000);
    const resultado = await promessa;

    expect(chamadas).toBe(3);
    expect(resultado.cenarios).toEqual([]);
  });

  it('explica que a API está acordando quando todas as tentativas falham', async () => {
    const spy = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', spy);

    const { listarCenarios } = await import('./api');
    // A espera precisa ser anexada antes de o relógio andar: do contrário a
    // promessa rejeita sem ninguém ouvindo, e o Node acusa o unhandled.
    const promessa = expect(listarCenarios()).rejects.toThrow(/hiberna|tente de novo/i);
    await vi.advanceTimersByTimeAsync(20_000);
    await promessa;
  });

  it('não repete quando a API responde com erro próprio', async () => {
    const spy = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Cenário não encontrado' }),
    });
    vi.stubGlobal('fetch', spy);

    const { detalharCenario } = await import('./api');
    await expect(detalharCenario('inexistente')).rejects.toThrow('Cenário não encontrado');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('não repete quando a API responde com erro de validação', async () => {
    const spy = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'categoryId deve ser um UUID' }),
    });
    vi.stubGlobal('fetch', spy);

    const { executarCenario } = await import('./api');
    await expect(executarCenario('x', 'SELECT 1')).rejects.toThrow(/UUID/);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('preserva o status HTTP no erro final', async () => {
    const spy = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Erro interno' }),
    });
    vi.stubGlobal('fetch', spy);

    const { listarCenarios } = await import('./api');
    await expect(listarCenarios()).rejects.toMatchObject({ status: 500 });
  });
});

describe('identificador de sessão', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('é aleatório e não guarda dados pessoais', () => {
    const id = idDaSessao();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    const guardado = JSON.stringify(window.localStorage);
    expect(guardado).not.toMatch(/email|nome|documento|@/i);
  });

  it('mantém o mesmo identificador entre chamadas', () => {
    expect(idDaSessao()).toBe(idDaSessao());
  });

  it('gera identificadores diferentes para sessões diferentes', () => {
    const primeiro = idDaSessao();
    window.localStorage.clear();
    expect(idDaSessao()).not.toBe(primeiro);
  });
});

describe('classe de erro', () => {
  it('guarda o status e a mensagem', () => {
    const erro = new ErroDeApi(0, 'A API não respondeu');
    expect(erro).toBeInstanceOf(Error);
    expect(erro.status).toBe(0);
    expect(erro.message).toMatch(/não respondeu/);
  });
});
