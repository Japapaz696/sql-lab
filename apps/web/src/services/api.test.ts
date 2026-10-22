import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErroDeApi, idDaSessao, normalizarBaseDaApi } from './api';

/**
 * Resposta falsa com o mínimo que o cliente usa.
 *
 * O cliente decide o que fazer pelo `content-type`: só interpreta JSON quando
 * o servidor diz que é JSON. Um mock sem cabeçalhos não representa uma
 * resposta HTTP de verdade — e foi o que quebrou os testes quando essa regra
 * entrou.
 */
function respostaMock(
  corpo: unknown,
  opcoes: { status?: number; tipo?: string | null; headers?: Record<string, string> } = {},
) {
  const status = opcoes.status ?? 200;
  const headers = new Headers();

  if (opcoes.tipo === null) {
    headers.delete('content-type');
  } else {
    headers.set('content-type', opcoes.tipo ?? 'application/json');
  }

  for (const [nome, valor] of Object.entries(opcoes.headers ?? {})) {
    headers.set(nome, valor);
  }

  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    json: async () => {
      if (typeof corpo === 'string') throw new SyntaxError('corpo não é JSON');
      return corpo;
    },
    text: async () => (typeof corpo === 'string' ? corpo : JSON.stringify(corpo)),
  };
}

/**
 * O endereço da API publicado precisa apontar para as rotas que existem.
 *
 * O servidor monta as rotas em `/api/v1`. Se a publicação mandar só a
 * origem, toda requisição devolve 404 — e a demonstração abre vazia, sem
 * nenhum erro visível na tela.
 */
describe('endereço da API', () => {
  it('acrescenta o caminho das rotas quando a origem é pura', () => {
    expect(normalizarBaseDaApi('https://sql-lab-api.exemplo.onrender.com')).toBe(
      'https://sql-lab-api.exemplo.onrender.com/api/v1',
    );
  });

  it('aceita a base completa sem acrescentar nada', () => {
    expect(normalizarBaseDaApi('https://api.exemplo.com/api/v1')).toBe(
      'https://api.exemplo.com/api/v1',
    );
  });

  it('ignora barra final e espaços', () => {
    expect(normalizarBaseDaApi('  https://api.exemplo.com/  ')).toBe(
      'https://api.exemplo.com/api/v1',
    );
    expect(normalizarBaseDaApi('https://api.exemplo.com/api/v1/')).toBe(
      'https://api.exemplo.com/api/v1',
    );
  });

  it('mantém o caminho relativo do desenvolvimento', () => {
    expect(normalizarBaseDaApi('/api/v1')).toBe('/api/v1');
  });

  it('usa o caminho da API quando o valor vem vazio', () => {
    expect(normalizarBaseDaApi('')).toBe('/api/v1');
  });

  it('preserva um caminho próprio, quando a API não está na raiz', () => {
    expect(normalizarBaseDaApi('https://api.exemplo.com/lab/api/v1')).toBe(
      'https://api.exemplo.com/lab/api/v1',
    );
  });
});

describe('cliente da API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('envia o identificador de sessão em toda requisição', async () => {
    const spy = vi
      .fn()
      .mockResolvedValue(respostaMock({ cenarios: [], progresso: { total: 0, resolvidos: 0 } }));
    vi.stubGlobal('fetch', spy);

    const { listarCenarios } = await import('./api');
    await listarCenarios();

    const [, opcoes] = spy.mock.calls[0] as [string, RequestInit];
    const headers = opcoes.headers as Headers;
    expect(headers.get('X-Sessao-Id')).toMatch(/^[0-9a-f]{32}$/);
  });

  it('chama a rota que existe no servidor', async () => {
    const spy = vi.fn().mockResolvedValue(respostaMock({ cenarios: [] }));
    vi.stubGlobal('fetch', spy);

    const { listarCenarios } = await import('./api');
    await listarCenarios();

    const [url] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/scenarios');
  });

  it('usa a mensagem do servidor no erro', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(respostaMock({ error: 'Cenário não encontrado' }, { status: 404 })),
    );

    const { detalharCenario } = await import('./api');
    await expect(detalharCenario('inexistente')).rejects.toThrow('Cenário não encontrado');
  });

  it('usa a mensagem padrão quando a resposta não tem JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(respostaMock('<html>erro</html>', { status: 500, tipo: 'text/html' })),
    );

    const { detalharCenario } = await import('./api');
    await expect(detalharCenario('x')).rejects.toThrow(/500/);
  });

  it('preserva o status no erro', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(respostaMock({ error: 'Cenário não encontrado' }, { status: 404 })),
    );

    const { detalharCenario } = await import('./api');
    await expect(detalharCenario('x')).rejects.toMatchObject({ status: 404 });
  });

  it('envia o SQL no corpo da execução', async () => {
    const spy = vi
      .fn()
      .mockResolvedValue(
        respostaMock({ consulta: {}, verificacao: {}, tentativas: 1, resolvido: false }),
      );
    vi.stubGlobal('fetch', spy);

    const { executarCenario } = await import('./api');
    await executarCenario('cenario-1', 'SELECT 1');

    const [, opcoes] = spy.mock.calls[0] as [string, RequestInit];
    expect(opcoes.method).toBe('POST');
    expect(JSON.parse(opcoes.body as string)).toEqual({ sql: 'SELECT 1' });
  });
});

/**
 * A API é publicada atrás de um proxy (Render) e pode receber respostas que
 * não são dela: um WAF devolve HTML 403, o gateway devolve HTML 502 durante
 * a partida. Nada disso pode virar HTML cru na tela, nem ser tratado como
 * resposta válida.
 */
describe('respostas que não são da API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('traduz o 429 com Retry-After em uma mensagem com o tempo de espera', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        respostaMock('<html>too many requests</html>', {
          status: 429,
          tipo: 'text/html',
          headers: { 'retry-after': '30' },
        }),
      ),
    );

    const { listarCenarios } = await import('./api');

    const erro = (await listarCenarios().catch((capturado: unknown) => capturado)) as ErroDeApi;
    expect(erro).toBeInstanceOf(ErroDeApi);
    expect(erro.status).toBe(429);
    expect(erro.message).toMatch(/Aguarde 30 segundo/);
  });

  it('não mostra o HTML de um bloqueio 403', async () => {
    const html = '<html><body>Blocked by firewall</body></html>';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(respostaMock(html, { status: 403, tipo: 'text/html' })),
    );

    const { listarCenarios } = await import('./api');

    const erro = (await listarCenarios().catch((capturado: unknown) => capturado)) as ErroDeApi;
    expect(erro.message).toMatch(/proxy ou da hospedagem/i);
    expect(erro.message).not.toMatch(/<html>/i);
  });

  it('recusa um 200 que veio em HTML em vez de JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(respostaMock('<html>portal</html>', { status: 200, tipo: 'text/html' })),
    );

    const { listarCenarios } = await import('./api');
    await expect(listarCenarios()).rejects.toMatchObject({ status: 502 });
  });

  it('recusa um JSON inválido sem repetir a chamada', async () => {
    const spy = vi.fn().mockResolvedValue(respostaMock('{quebrado', { status: 200 }));
    vi.stubGlobal('fetch', spy);

    const { listarCenarios } = await import('./api');
    await expect(listarCenarios()).rejects.toThrow(/incompleto/i);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('usa a mensagem de 429 do servidor quando ela vem em JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          respostaMock(
            { error: 'Muitas consultas em pouco tempo. Aguarde 12 segundo(s) e tente de novo.' },
            { status: 429, headers: { 'retry-after': '12' } },
          ),
        ),
    );

    const { executarCenario } = await import('./api');
    await expect(executarCenario('x', 'SELECT 1')).rejects.toThrow(/Aguarde 12 segundo/);
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
      return respostaMock({ cenarios: [] });
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
    const spy = vi
      .fn()
      .mockResolvedValue(respostaMock({ error: 'Cenário não encontrado' }, { status: 404 }));
    vi.stubGlobal('fetch', spy);

    const { detalharCenario } = await import('./api');
    await expect(detalharCenario('inexistente')).rejects.toThrow('Cenário não encontrado');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('não repete quando a API responde com erro de validação', async () => {
    const spy = vi
      .fn()
      .mockResolvedValue(respostaMock({ error: 'categoryId deve ser um UUID' }, { status: 400 }));
    vi.stubGlobal('fetch', spy);

    const { executarCenario } = await import('./api');
    await expect(executarCenario('x', 'SELECT 1')).rejects.toThrow(/UUID/);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('preserva o status HTTP no erro final', async () => {
    const spy = vi.fn().mockResolvedValue(respostaMock({ error: 'Erro interno' }, { status: 500 }));
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
