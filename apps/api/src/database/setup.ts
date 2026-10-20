import type pg from 'pg';

import { env } from '../config/env.js';
import { poolAdmin } from './pool.js';

/**
 * Nomes de banco que a preparação aceita tocar.
 *
 * A carga recria o schema inteiro. Num banco com dados de verdade, isso é
 * destrutivo — por isso o nome do banco precisa ter a cara de um banco de
 * laboratório, e o responsável precisa confirmar.
 */
const NOMES_PERMITIDOS = ['sql_lab', 'sql_lab_test', 'sql_lab_demo'];

export function nomeDoBanco(url: string): string | null {
  try {
    return new URL(url).pathname.replace(/^\//, '');
  } catch {
    return null;
  }
}

export type ContextoDePreparacao = {
  banco: string | null;
  confirmacao: string | undefined;
  nomeExecucao: string;
};

/**
 * Confere se é seguro preparar este banco.
 *
 * Três condições, todas obrigatórias:
 *  1. o nome do banco tem a cara de um banco de laboratório;
 *  2. a confirmação explícita está presente;
 *  3. o papel de execução tem senha definida.
 */
export function conferirPreparacao(url: string, nomeExecucao: string): ContextoDePreparacao {
  const banco = nomeDoBanco(url);
  const confirmacao = process.env.SQL_LAB_CONFIRMAR_RESET;
  const senhaExecucao = process.env.SQL_LAB_EXEC_PASSWORD;

  const problemas: string[] = [];

  if (!banco) {
    problemas.push('não foi possível ler o nome do banco a partir da URL');
  } else if (!NOMES_PERMITIDOS.includes(banco)) {
    problemas.push(
      `o banco "${banco}" não parece um banco de laboratório ` +
        `(aceitos: ${NOMES_PERMITIDOS.join(', ')})`,
    );
  }

  if (confirmacao !== 'sim') {
    problemas.push(
      'a confirmação não está presente: defina SQL_LAB_CONFIRMAR_RESET=sim para confirmar',
    );
  }

  if (!senhaExecucao) {
    problemas.push(
      'SQL_LAB_EXEC_PASSWORD não está definida: a senha do papel de execução ' +
        'não pode ter um valor previsível no repositório',
    );
  } else if (senhaExecucao === nomeExecucao) {
    problemas.push('a senha do papel de execução não pode ser igual ao nome do papel');
  } else if (senhaExecucao.length < 16) {
    problemas.push('a senha do papel de execução precisa ter ao menos 16 caracteres');
  }

  if (problemas.length) {
    const erro = new Error(
      [
        'Preparação do banco cancelada por segurança:',
        ...problemas.map((problema) => `  - ${problema}`),
        '',
        'A preparação recria o schema inteiro. Num banco com dados de verdade,',
        'isso apagaria tudo.',
        '',
        'Para preparar um banco de laboratório:',
        '  $env:SQL_LAB_CONFIRMAR_RESET = "sim"',
        '  $env:SQL_LAB_EXEC_PASSWORD = "<senha forte, 16+ caracteres>"',
        '  npm run db:reset',
      ].join('\n'),
    );
    throw erro;
  }

  return { banco, confirmacao, nomeExecucao };
}

/**
 * Aplica o schema, a carga fictícia e as concessões de privilégio.
 *
 * Usa a conexão administrativa: a aplicação executa as consultas do aluno com
 * um usuário sem permissão de escrita, e quem prepara o banco precisa de
 * permissão para criar tabelas e para conceder leitura ao papel de execução.
 *
 * Tudo acontece dentro de uma transação: ou o banco fica pronto, ou ele
 * continua como estava. A senha do papel de execução entra por
 * `set_config` com escopo de **transação**, e não de sessão — assim a
 * preparação funciona tanto na conexão direta do Neon quanto no pooler (que
 * entrega a sessão de forma diferente).
 */
export async function prepararBanco(alvo?: pg.Pool): Promise<void> {
  const conexao = alvo ?? poolAdmin;
  if (!conexao) {
    throw new Error(
      'É preciso uma conexão administrativa para preparar o banco. Defina DATABASE_ADMIN_URL.',
    );
  }

  const contexto = conferirPreparacao(env.databaseAdminUrl ?? env.databaseUrl, 'sql_lab_exec');

  const client = await conexao.connect();
  try {
    await client.query('BEGIN');
    try {
      await client.query('DROP SCHEMA IF EXISTS public CASCADE');
      await client.query('CREATE SCHEMA public');
      await client.query('SET LOCAL search_path TO public');

      const fs = await import('node:fs/promises');
      const caminho = (nome: string) => `${env.rootDir}/db/${nome}`;

      const schema = await fs.readFile(caminho('schema.sql'), 'utf8');
      const seed = await fs.readFile(caminho('seed.sql'), 'utf8');
      const privilegios = await fs.readFile(caminho('privilegios.sql'), 'utf8');

      await client.query(schema);
      await client.query(seed);

      // A senha do papel de execução chega por parâmetro, por set_config.
      // Nunca é concatenada no texto do SQL, e nunca fica no repositório.
      const senha = process.env.SQL_LAB_EXEC_PASSWORD as string;
      await client.query("SELECT set_config('sql_lab.exec_password', $1, true)", [senha]);
      await client.query(privilegios);

      await client.query('COMMIT');
    } catch (erro) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw erro;
    }
  } finally {
    client.release();
  }

  console.log(`Banco preparado: ${contexto.banco}`);
}
