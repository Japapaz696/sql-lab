/**
 * Preparação global da suíte.
 *
 * Roda uma vez, no processo principal do Vitest, antes de qualquer arquivo de
 * teste. Recria o esquema e a carga fictícia no banco de teste, para que o
 * resultado de referência de cada cenário seja estável.
 */
import pg from 'pg';
import { config as loadEnv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raizDoProjeto = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

// O globalSetup roda no processo principal, fora do módulo de ambiente da
// aplicação: o .env precisa ser carregado aqui também.
loadEnv({ path: resolve(raizDoProjeto, '.env'), quiet: true });

export async function setup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('TEST_DATABASE_URL (ou DATABASE_URL) é obrigatória para rodar a suíte');
  }

  const pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 15_000 });
  const client = await pool.connect();

  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
    await client.query('SET search_path TO public');

    const fs = await import('node:fs/promises');
    const schema = await fs.readFile(resolve(raizDoProjeto, 'db', 'schema.sql'), 'utf8');
    const seed = await fs.readFile(resolve(raizDoProjeto, 'db', 'seed.sql'), 'utf8');

    await client.query(schema);
    await client.query(seed);
  } finally {
    client.release();
    await pool.end();
  }
}
