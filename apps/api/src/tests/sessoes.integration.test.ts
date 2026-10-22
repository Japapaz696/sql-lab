import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { criarApp } from '../app.js';
import { buscarCenario } from '../scenarios/index.js';
import { iniciarApi, pedir, type ApiDeTeste, type OpcoesDaChamada } from './http.js';

type Execucao = {
  verificacao: { acertou: boolean; linhasEsperadas: number | null; linhasObtidas: number | null };
  tentativas: number;
  resolvido: boolean;
};

type Listagem = {
  cenarios: { id: string; tentativas: number; resolvido: boolean }[];
  progresso: { total: number; resolvidos: number };
};

/**
 * O progresso é por sessão. Sem isso, duas pessoas — ou duas abas com
 * identidades diferentes — veriam o histórico uma da outra; e quem chamasse a
 * API sem o cabeçalho cairia em uma sessão compartilhada.
 */
describe('isolamento do progresso por sessão', () => {
  let api: ApiDeTeste;

  const cenario = buscarCenario('titulo-vencido');
  const sessaoA = 'sessao-de-teste-a';
  const sessaoB = 'sessao-de-teste-b';
  const sessaoC = 'sessao-de-teste-c';

  beforeAll(async () => {
    api = await iniciarApi(criarApp());
  });

  afterAll(async () => {
    await api.fechar();
  });

  function executar(sessao?: string) {
    const opcoes: OpcoesDaChamada = {
      method: 'POST',
      body: JSON.stringify({ sql: cenario!.sqlReferencia }),
    };

    if (sessao) opcoes.sessao = sessao;

    return pedir(api.url, `/api/v1/scenarios/${cenario!.id}/execute`, opcoes);
  }

  async function listar(sessao: string): Promise<Listagem> {
    const resposta = await pedir(api.url, '/api/v1/scenarios', { sessao });
    expect(resposta.status).toBe(200);
    return (await resposta.json()) as Listagem;
  }

  it('recusa a listagem sem o cabeçalho de sessão', async () => {
    const resposta = await pedir(api.url, '/api/v1/scenarios');

    expect(resposta.status).toBe(400);
    expect(resposta.headers.get('content-type')).toMatch(/application\/json/);
    await expect(resposta.json()).resolves.toMatchObject({
      error: expect.stringMatching(/x-sessao-id/),
    });
  });

  it('recusa um identificador de sessão em formato inválido', async () => {
    for (const invalida of ['curta', 'com espaço na sessão', 'a'.repeat(65)]) {
      const resposta = await fetch(`${api.url}/api/v1/scenarios`, {
        headers: { 'x-sessao-id': invalida },
      });
      expect(resposta.status, invalida).toBe(400);
    }
  });

  it('recusa a execução sem sessão antes de rodar qualquer SQL', async () => {
    const resposta = await executar();
    expect(resposta.status).toBe(400);
  });

  it('duas sessões mantêm contadores independentes', async () => {
    const a1 = (await (await executar(sessaoA)).json()) as Execucao;
    const b1 = (await (await executar(sessaoB)).json()) as Execucao;
    const a2 = (await (await executar(sessaoA)).json()) as Execucao;

    expect(a1.verificacao.acertou).toBe(true);
    expect(a1.tentativas).toBe(1);
    expect(b1.tentativas).toBe(1);
    expect(a2.tentativas).toBe(2);

    const listaA = await listar(sessaoA);
    const listaB = await listar(sessaoB);
    const listaC = await listar(sessaoC);

    expect(listaA.cenarios.find((c) => c.id === cenario!.id)).toMatchObject({
      tentativas: 2,
      resolvido: true,
    });
    expect(listaB.cenarios.find((c) => c.id === cenario!.id)).toMatchObject({
      tentativas: 1,
      resolvido: true,
    });

    // Uma sessão que nunca executou nada não herda o progresso das outras.
    expect(listaC.cenarios.find((c) => c.id === cenario!.id)).toMatchObject({
      tentativas: 0,
      resolvido: false,
    });
    expect(listaC.progresso.resolvidos).toBe(0);
  });

  it('a sessão sem histórico não vê o cenário como resolvido', async () => {
    const lista = await listar(sessaoC);
    expect(lista.cenarios.every((c) => c.tentativas === 0)).toBe(true);
    expect(lista.progresso.resolvidos).toBe(0);
  });
});
