import type {
  ExecuteResponse,
  ExplainResponse,
  ScenarioDetail,
  ScenarioSummary,
} from '@sql-lab/shared';

/**
 * Endereço da API.
 *
 * Em desenvolvimento, a interface e a API são servidas pelo mesmo host, e o
 * proxy do Vite encaminha `/api` para o backend. Em publicação, a API pode
 * estar em outro host: defina `VITE_API_URL` na hora do build.
 */
const API = (import.meta.env.VITE_API_URL ?? '/api/v1').replace(/\/$/, '');

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

/**
 * O hosting gratuito da API hiberna depois de um tempo sem tráfego e leva
 * cerca de um minuto para acordar. Uma tentativa que falha por tempo
 * esgotado não é um erro do usuário: é a API acordando.
 *
 * Nesses casos a requisição é repetida, com espera growing entre as
 * tentativas, e o erro final explica o que está acontecendo.
 */
const TENTATIVAS = 3;
const ESPERA_ENTRE_TENTATIVAS_MS = 4000;
const LIMITE_DE_TEMPO_MS = 20_000;

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Distingue "a API não respondeu" de "a API respondeu com erro". */
function semResposta(erro: unknown): boolean {
  return (
    erro instanceof TypeError ||
    (erro instanceof Error && /fetch failed|network|timeout/i.test(erro.message))
  );
}

async function requisitar<T>(caminho: string, opcoes: RequestInit = {}): Promise<T> {
  const headers = new Headers(opcoes.headers);
  headers.set('X-Sessao-Id', idDaSessao());
  if (opcoes.body !== undefined) headers.set('Content-Type', 'application/json');

  let ultimoErro: unknown = null;

  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa += 1) {
    const controlador = new AbortController();
    const tempo = setTimeout(() => controlador.abort(), LIMITE_DE_TEMPO_MS);

    try {
      const resposta = await fetch(`${API}${caminho}`, {
        ...opcoes,
        headers,
        signal: controlador.signal,
      });
      clearTimeout(tempo);

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
    } catch (erro) {
      clearTimeout(tempo);
      ultimoErro = erro;

      // Erro da própria API (4xx, 5xx com corpo) não adianta repetir.
      if (erro instanceof ErroDeApi) throw erro;
      if (tentativa === TENTATIVAS) break;
      await esperar(ESPERA_ENTRE_TENTATIVAS_MS);
    }
  }

  if (semResposta(ultimoErro)) {
    throw new ErroDeApi(
      0,
      'A API não respondeu. Em hospedagem gratuita ela hiberna quando fica sem tráfego — ' +
        'aguarde alguns segundos e tente de novo.',
    );
  }
  throw ultimoErro;
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
