import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErroDeApi, idDaSessao } from './api';

describe('sessão do laboratório', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('gera um identificador aleatório de 32 caracteres hexadecimais', () => {
    const id = idDaSessao();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('mantém o mesmo identificador entre chamadas', () => {
    expect(idDaSessao()).toBe(idDaSessao());
  });

  it('gera identificadores diferentes para sessões diferentes', () => {
    const primeiro = idDaSessao();
    window.localStorage.clear();
    const segundo = idDaSessao();
    expect(primeiro).not.toBe(segundo);
  });

  it('não guarda nome, e-mail ou documento', () => {
    idDaSessao();
    const guardado = JSON.stringify(window.localStorage);
    expect(guardado).not.toMatch(/email|nome|documento|@/i);
  });
});

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

describe('classe de erro', () => {
  it('guarda o status e a mensagem', () => {
    const erro = new ErroDeApi(422, 'campo inválido');
    expect(erro).toBeInstanceOf(Error);
    expect(erro.status).toBe(422);
    expect(erro.message).toBe('campo inválido');
  });
});
