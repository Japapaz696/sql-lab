/**
 * Contratos do laboratório compartilhados entre a API e a interface.
 */

/** Áreas do ERP em que os cenários se encaixam. */
export const scenarioAreas = [
  'comercial',
  'faturamento',
  'estoque',
  'cadastro',
  'logistica',
  'relatorio',
] as const;

export type ScenarioArea = (typeof scenarioAreas)[number];

/** Níveis de dificuldade, do mais direto ao mais challenging. */
export const scenarioLevels = ['iniciante', 'intermediario', 'avancado'] as const;

export type ScenarioLevel = (typeof scenarioLevels)[number];

/** Uma linha de resultado, como valores simples (nulo, número, texto, booleano). */
export type CellValue = string | number | boolean | null;

export type ResultRow = CellValue[];

/** Visão resumida, usada na lista de cenários. */
export type ScenarioSummary = {
  id: string;
  titulo: string;
  area: ScenarioArea;
  nivel: ScenarioLevel;
  sintoma: string;
  tecnica: string;
  resolvido: boolean;
  tentativas: number;
};

/** Detalhe de um cenário, com o material didático. */
export type ScenarioDetail = ScenarioSummary & {
  contexto: string;
  sqlInicial: string;
  explicacao: string;
  indices: string[];
  errosComuns: string[];
  dicas: string[];
};

/** Resultado da execução de uma consulta. */
export type QueryOutcome = {
  ok: boolean;
  colunas: string[];
  linhas: ResultRow[];
  totalLinhas: number;
  truncado: boolean;
  duracaoMs: number;
  erro?: string;
};

/** Verificação da resposta do aluno contra a referência. */
export type ScenarioCheck = {
  acertou: boolean;
  feedback: string;
  /**
   * Quantas linhas a referência devolveu. `null` quando não houve comparação
   * possível (a consulta do aluno falhou antes de produzir resultado).
   */
  linhasEsperadas: number | null;
  /** Quantas linhas a consulta do aluno devolveu; `null` no mesmo caso. */
  linhasObtidas: number | null;
};

export type ExecuteResponse = {
  consulta: QueryOutcome;
  verificacao: ScenarioCheck;
  tentativas: number;
  resolvido: boolean;
};

/** Plano de execução, para mostrar o índice usado. */
export type ExplainRow = {
  chave: string;
  detalhe: string;
};

export type ExplainResponse = {
  linhas: ExplainRow[];
  erro?: string;
};

export type ProgressResponse = {
  sessaoId: string;
  totalCenarios: number;
  resolvidos: number;
  cenarios: ScenarioSummary[];
};
