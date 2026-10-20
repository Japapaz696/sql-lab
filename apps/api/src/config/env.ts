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

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL é obrigatória');
}

export const env = {
  /**
   * Conexão usada para EXECUTAR as consultas do aluno.
   *
   * Deve apontar para o usuário sem privilégio de escrita (sql_lab_exec). Se
   * apontar para o administrativo, a separação de privilégios não existe — a
   * transação READ ONLY e o protocolo estendido continuam protegendo.
   */
  databaseUrl,
  /**
   * Conexão usada só para preparar o banco (criar tabelas e aplicar a carga).
   *
   * Quando não está definida, usa a mesma de execução — o laboratório
   * funciona, mas sem a separação de privilégios.
   */
  databaseAdminUrl: process.env.DATABASE_ADMIN_URL,
  testDatabaseUrl: process.env.TEST_DATABASE_URL ?? databaseUrl,
  port: inteiro('PORT', 3000),
  allowedOrigin: process.env.ALLOWED_ORIGIN ?? 'http://localhost:5173',
  maxResultRows: inteiro('MAX_RESULT_ROWS', 200),
  queryTimeoutMs: inteiro('QUERY_TIMEOUT_MS', 5000),
  rootDir: raizDoProjeto,
} as const;
