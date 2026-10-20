/**
 * Preparação global da suíte.
 *
 * Roda uma vez, no processo principal do Vitest, antes de qualquer arquivo de
 * teste. Recria o esquema e a carga fictícia no banco de teste, para que o
 * resultado de referência de cada cenário seja estável.
 *
 * A preparação usa a conexão **administrativa**: é ela que pode criar
 * tabelas e conceder privilégios. As consultas da suíte usam a conexão de
 * execução, sem permissão de escrita — é a mesma que a aplicação usa.
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
  const teste = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  const admin = process.env.TEST_DATABASE_ADMIN_URL ?? process.env.DATABASE_ADMIN_URL ?? teste;

  if (!teste) {
    throw new Error('TEST_DATABASE_URL (ou DATABASE_URL) é obrigatória para rodar a suíte');
  }

  const pool = new pg.Pool({ connectionString: admin, max: 2, connectionTimeoutMillis: 30_000 });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    try {
      await client.query('DROP SCHEMA IF EXISTS public CASCADE');
      await client.query('CREATE SCHEMA public');
      await client.query('SET LOCAL search_path TO public');

      const fs = await import('node:fs/promises');
      const schema = await fs.readFile(resolve(raizDoProjeto, 'db', 'schema.sql'), 'utf8');
      const seed = await fs.readFile(resolve(raizDoProjeto, 'db', 'seed.sql'), 'utf8');

      await client.query(schema);
      await client.query(seed);

      // As concessões para o papel de execução. A senha chega por parâmetro,
      // via set_config: nunca é concatenada no texto do SQL.
      //
      // O savepoint mantém a falha contida: se o papel não puder ser criado,
      // o esquema e a carga sobrevivem, e a suíte segue protegida pela
      // transação somente leitura e pelo protocolo estendido.
      const senha = process.env.SQL_LAB_EXEC_PASSWORD;
      if (senha) {
        await client.query('SAVEPOINT concessoes');
        try {
          const privilegios = await fs.readFile(
            resolve(raizDoProjeto, 'db', 'privilegios.sql'),
            'utf8',
          );
          await client.query("SELECT set_config('sql_lab.exec_password', $1, true)", [senha]);
          await client.query(privilegios);
          await client.query('RELEASE SAVEPOINT concessoes');
        } catch (erro) {
          await client.query('ROLLBACK TO SAVEPOINT concessoes').catch(() => undefined);
          const mensagem = erro instanceof Error ? erro.message : String(erro);
          console.warn(
            `Aviso: separacao de privilegios nao aplicada (${mensagem.split('\n')[0]}). ` +
              'A suite segue protegida pela transacao somente leitura e pelo protocolo estendido.',
          );
        }
      } else {
        console.warn(
          'Aviso: SQL_LAB_EXEC_PASSWORD ausente, as concessoes nao foram aplicadas. ' +
            'A suite continua protegida pela transacao somente leitura e pelo protocolo estendido.',
        );
      }

      await client.query('COMMIT');
    } catch (erro) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw erro;
    }
  } finally {
    client.release();
    await pool.end();
  }
}
