import type { ScenarioArea, ScenarioLevel } from '@sql-lab/shared';

/**
 * Um cenário do laboratório.
 *
 * `sqlInicial` é o ponto de partida mostrado ao aluno (com um esqueleto que
 * ele precisa completar). `sqlReferencia` é a solução canônica: o backend
 * executa as duas e compara os resultados, então qualquer consulta que
 * responda à mesma pergunta conta como resolvida.
 */
export type Scenario = {
  id: string;
  titulo: string;
  area: ScenarioArea;
  nivel: ScenarioLevel;
  /** O que o cliente ou o suporte percebe. */
  sintoma: string;
  /** O contexto de negócio que faz o sintoma existir. */
  contexto: string;
  /** A técnica de consulta que o cenário ensina. */
  tecnica: string;
  /** Esqueleto para o aluno completar. */
  sqlInicial: string;
  /** Solução canônica, usada como referência de comparação. */
  sqlReferencia: string;
  /** Explicação didática de por que a consulta funciona. */
  explicacao: string;
  /** Índices que a consulta referencia. */
  indices: string[];
  /** Erros típicos de quem está começando. */
  errosComuns: string[];
  /** Dicas reveladas uma a uma. */
  dicas: string[];
};
