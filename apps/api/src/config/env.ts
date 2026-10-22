import { config as loadEnv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raizDoProjeto = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
loadEnv({ path: resolve(raizDoProjeto, '.env'), quiet: true });

function inteiro(nome: string, padrao: number): number {
  const bruto = process.env[nome];
  if (!bruto) return padrao;
  const valor = Number(bruto);
  if (!Number.isInteger(valor) || valor <= 0) {
    throw new Error(`${nome} deve ser um inteiro positivo`);
  }
  return valor;
}

/**
 * Divide uma lista de origens separada por vírgula.
 *
 * A interface pode estar em mais de um endereço ao mesmo tempo — o Pages de
 * produção, o domínio próprio, e o ambiente local. Uma lista é mais cômodo de
 * manter do que várias variáveis.
 */
function lista(nome: string, padrao: string): string[] {
  const bruto = process.env[nome] ?? padrao;
  return bruto
    .split(',')
    .map((item) => item.trim().replace(/\/+$/, ''))
    .filter((item) => item.length > 0);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL é obrigatória');
}

export const env = {
  /**
   * Conexão usada para EXECUTAR as consultas do aluno.
   *
   * Deve apontar para o usuário sem privilégio de escrita (sql_lab_exec). Em
   * produção, a API **não sobe** se esta conexão puder escrever: a separação
   * de privilégios é verificada na partida, contra o próprio banco.
   */
  databaseUrl,
  /**
   * Conexão usada pela aplicação para gravar o progresso e para preparar o
   * banco. O SQL de quem usa o laboratório nunca passa por ela.
   */
  databaseAdminUrl: process.env.DATABASE_ADMIN_URL,
  testDatabaseUrl: process.env.TEST_DATABASE_URL ?? databaseUrl,
  port: inteiro('PORT', 3000),
  /**
   * Origem principal liberada no CORS. Mantida por compatibilidade; a lista
   * completa está em `allowedOrigins`.
   */
  allowedOrigin: process.env.ALLOWED_ORIGIN ?? 'http://localhost:5173',
  /**
   * Todas as origens liberadas no CORS.
   *
   * `ALLOWED_ORIGIN` aceita uma lista separada por vírgula, para que a mesma
   * API sirva a interface de produção e à de desenvolvimento sem precisar de
   * duas implantações.
   */
  allowedOrigins: lista('ALLOWED_ORIGIN', 'http://localhost:5173'),
  maxResultRows: inteiro('MAX_RESULT_ROWS', 200),
  queryTimeoutMs: inteiro('QUERY_TIMEOUT_MS', 5000),
  /**
   * Quantas consultas do aluno podem rodar ao mesmo tempo neste processo.
   *
   * O pool de leitura tem cinco conexões. Quatro consultas simultâneas deixam
   * uma livre para o `/ready` e para a descrição do esquema; o excedente
   * espera na fila em vez de esgotar o pool e derrubar todo mundo.
   */
  maxConcurrentQueries: inteiro('MAX_CONCURRENT_QUERIES', 4),
  /**
   * Quanto tempo uma consulta espera na fila antes de receber 503.
   *
   * Esperar para sempre só transfere o problema: o navegador desiste, a
   * conexão fica presa e a fila cresce. Oito segundos é curto o bastante para
   * o aluno tentar de novo e longo o bastante para absorver um pico.
   */
  queueWaitMs: inteiro('QUEUE_WAIT_MS', 8000),
  /**
   * Limites por IP, por janela. A execução é a rota mais cara (roda a consulta
   * e a referência); o EXPLAIN é mais barato, mas também abre conexão.
   */
  rateLimitExecuteMax: inteiro('RATE_LIMIT_EXECUTE_MAX', 20),
  rateLimitExplainMax: inteiro('RATE_LIMIT_EXPLAIN_MAX', 15),
  rateLimitWindowMs: inteiro('RATE_LIMIT_WINDOW_MS', 60_000),
  /**
   * Em produção, a separação de privilégios é obrigatória: a API não sobe se
   * o usuário de execução puder escrever, e a recusa é testada contra o banco.
   */
  isProduction: (process.env.NODE_ENV ?? 'development') === 'production',
  rootDir: raizDoProjeto,
} as const;
