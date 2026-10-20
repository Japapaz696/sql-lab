import type {
  ExecuteResponse,
  ExplainResponse,
  ScenarioDetail,
  ScenarioSummary,
} from '@sql-lab/shared';

const API = '/api/v1';

/**
 * Identificador da sessão de trabalho.
 *
 * Serve só para acompanhar o progresso dos cenários. É aleatório, fica no
 * navegador e não tem relação com nome, e-mail ou documento — o laboratório
 * não pede identidade a ninguém.
 */
const CHAVE_SESSAO = 'sql_lab:sessao';

export function idDaSessao(): string {
  const existente = window.localStorage.getItem(CHAVE_SESSAO);
  if (existente) return existente;

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const id = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  window.localStorage.setItem(CHAVE_SESSAO, id);
  return id;
}

export class ErroDeApi extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ErroDeApi';
  }
}

async function requisitar<T>(caminho: string, opcoes: RequestInit = {}): Promise<T> {
  const headers = new Headers(opcoes.headers);
  headers.set('X-Sessao-Id', idDaSessao());
  if (opcoes.body !== undefined) headers.set('Content-Type', 'application/json');

  const resposta = await fetch(`${API}${caminho}`, { ...opcoes, headers });

  if (!resposta.ok) {
    let mensagem = `Erro ${resposta.status} ao falar com a API.`;
    try {
      const corpo = (await resposta.json()) as { error?: string };
      if (corpo.error) mensagem = corpo.error;
    } catch {
      // Resposta sem JSON: fica a mensagem padrão.
    }
    throw new ErroDeApi(resposta.status, mensagem);
  }

  return (await resposta.json()) as T;
}

export async function listarCenarios(): Promise<{
  cenarios: ScenarioSummary[];
  progresso: { total: number; resolvidos: number };
}> {
  return requisitar('/scenarios');
}

export async function detalharCenario(id: string): Promise<ScenarioDetail> {
  return requisitar(`/scenarios/${encodeURIComponent(id)}`);
}

export async function executarCenario(id: string, sql: string): Promise<ExecuteResponse> {
  return requisitar(`/scenarios/${encodeURIComponent(id)}/execute`, {
    method: 'POST',
    body: JSON.stringify({ sql }),
  });
}

export async function explicarCenario(id: string, sql: string): Promise<ExplainResponse> {
  return requisitar(`/scenarios/${encodeURIComponent(id)}/explain`, {
    method: 'POST',
    body: JSON.stringify({ sql }),
  });
}

export async function buscarSolucao(id: string): Promise<{ sqlReferencia: string }> {
  return requisitar(`/scenarios/${encodeURIComponent(id)}/solucao`);
}

export type ColunaDoEsquema = {
  nome: string;
  tipo: string;
  nulo: boolean;
  padrao: string | null;
};

export type TabelaDoEsquema = {
  nome: string;
  colunas: ColunaDoEsquema[];
  linhas: number;
  chavePrimaria: string[];
  relacionamentos: { coluna: string }[];
};

export async function buscarEsquema(): Promise<TabelaDoEsquema[]> {
  const resposta = await requisitar<{ tabelas: TabelaDoEsquema[] }>('/scenarios/esquema/tabelas');
  return resposta.tabelas;
}
