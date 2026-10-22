import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarApp } from '../app.js';
import { iniciarApi, pedir, type ApiDeTeste } from './http.js';

/**
 * O limite da fila é o que evita esgotar o pool do PostgreSQL.
 *
 * O teste usa um semáforo pequeno e operações controladas: não depende de
 * tempo de banco nem de carga externa, e mede exatamente a garantia que o
 * serviço faz — no máximo N operações ao mesmo tempo, e 503 quando a fila não
 * anda.
 */
describe('semáforo de consultas', () => {
  it('nunca passa do limite configurado', async () => {
    // Import tardio: o módulo lê o ambiente na carga, e o teste não precisa
    // do banco para exercitar o semáforo.
    const { Semaforo } = await import('../services/concorrencia.js');
    const semaforo = new Semaforo(2, 2_000);

    let ativos = 0;
    let maximo = 0;

    const tarefa = () =>
      semaforo.executar(async () => {
        ativos += 1;
        maximo = Math.max(maximo, ativos);
        await new Promise((resolver) => setTimeout(resolver, 25));
        ativos -= 1;
      });

    await Promise.all(Array.from({ length: 8 }, tarefa));

    expect(maximo).toBe(2);
    expect(semaforo.emUso).toBe(0);
    expect(semaforo.naFila).toBe(0);
  });

  it('rejeita com sobrecarga quando a fila passa do tempo de espera', async () => {
    const { ErroDeSobrecarga, Semaforo } = await import('../services/concorrencia.js');
    const semaforo = new Semaforo(1, 40);

    let liberar!: () => void;
    const bloqueio = new Promise<void>((resolver) => {
      liberar = resolver;
    });

    const primeira = semaforo.executar(() => bloqueio);
    await expect(semaforo.executar(async () => 1)).rejects.toBeInstanceOf(ErroDeSobrecarga);

    liberar();
    await primeira;

    // Depois da sobrecarga, o semáforo volta a aceitar — não fica travado.
    await expect(semaforo.executar(async () => 2)).resolves.toBe(2);
    expect(semaforo.emUso).toBe(0);
  });
});

/**
 * Os limites HTTP são testados separadamente do semáforo: aqui o alvo é o
 * contrato da rota (429, JSON e Retry-After), não a fila do banco.
 */
describe('limite de requisições por IP', () => {
  let api: ApiDeTeste;

  beforeAll(async () => {
    api = await iniciarApi(
      criarApp({ limiteDeExecucao: 2, limiteDeExplicacao: 1, janelaDoLimiteMs: 60_000 }),
    );
  });

  afterAll(async () => {
    await api.fechar();
  });

  const SESSAO = 'sessao-do-limite';

  function executar(sessao: string = SESSAO) {
    return pedir(api.url, '/api/v1/scenarios/titulo-vencido/execute', {
      method: 'POST',
      sessao,
      body: JSON.stringify({ sql: 'SELECT 1 AS n' }),
    });
  }

  function explicar() {
    return pedir(api.url, '/api/v1/scenarios/titulo-vencido/explain', {
      method: 'POST',
      sessao: SESSAO,
      body: JSON.stringify({ sql: 'SELECT 1 AS n' }),
    });
  }

  it('deixa passar até o limite e depois responde 429 em JSON com Retry-After', async () => {
    const primeira = await executar();
    expect(primeira.status).toBe(200);
    // Draft-7 do IETF: um cabeçalho combinado, com limite e restante.
    expect(primeira.headers.get('ratelimit')).toContain('limit=2');
    expect(primeira.headers.get('ratelimit-policy')).toBe('2;w=60');

    const segunda = await executar();
    expect(segunda.status).toBe(200);
    expect(segunda.headers.get('ratelimit')).toContain('remaining=0');

    const terceira = await executar();
    expect(terceira.status).toBe(429);
    expect(terceira.headers.get('content-type')).toMatch(/application\/json/);
    expect(terceira.headers.get('retry-after')).toMatch(/^\d+$/);

    const corpo = (await terceira.json()) as { error: string; retryAfterSeconds: number };
    expect(corpo.retryAfterSeconds).toBeGreaterThan(0);
    expect(corpo.error).toMatch(/Muitas consultas/);
  });

  it('o EXPLAIN tem um limite próprio, independente do de execução', async () => {
    const primeira = await explicar();
    expect(primeira.status).toBe(200);

    const segunda = await explicar();
    expect(segunda.status).toBe(429);
    expect(segunda.headers.get('retry-after')).toMatch(/^\d+$/);
  });

  it('o health check não é afetado pelo limite das consultas', async () => {
    const resposta = await fetch(`${api.url}/health`);
    expect(resposta.status).toBe(200);
  });
});
