import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { Express } from 'express';

export type ApiDeTeste = {
  url: string;
  fechar: () => Promise<void>;
};

/**
 * Sobe a aplicação em uma porta livre e devolve a base para as chamadas.
 *
 * Não usa supertest: `fetch` do Node e um servidor efêmero já exercitam a
 * pilha HTTP de verdade (CORS, helmet, JSON, rate limit), sem mais uma
 * dependência só para os testes.
 */
export async function iniciarApi(app: Express): Promise<ApiDeTeste> {
  const servidor: Server = await new Promise((resolver) => {
    const s = app.listen(0, '127.0.0.1', () => resolver(s));
  });

  const endereco = servidor.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${endereco.port}`,
    fechar: () =>
      new Promise<void>((resolver, rejeitar) => {
        servidor.close((erro) => (erro ? rejeitar(erro) : resolver()));
      }),
  };
}

export type OpcoesDaChamada = RequestInit & {
  /** Enviado como `x-sessao-id`; omitido, o cabeçalho não vai. */
  sessao?: string;
};

/** Chamada JSON com a sessão opcional. */
export async function pedir(
  base: string,
  caminho: string,
  opcoes: OpcoesDaChamada = {},
): Promise<Response> {
  const { sessao, ...resto } = opcoes;
  const headers = new Headers(resto.headers);

  if (sessao) headers.set('x-sessao-id', sessao);
  if (resto.body !== undefined) headers.set('content-type', 'application/json');

  return fetch(`${base}${caminho}`, { ...resto, headers });
}
