import type pg from 'pg';

import { env } from '../config/env.js';
import { pool } from '../database/pool.js';

export type ResultadoDaVerificacao = {
  ok: boolean;
  problemas: string[];
  detalhes: string[];
};

export type PrivilegiosDeEscrita = {
  podeEscrever: boolean;
  detalhe: string;
};

export function usuarioDaUrl(url: string): string | null {
  try {
    return decodeURIComponent(new URL(url).username);
  } catch {
    return null;
  }
}

/**
 * Confere, consultando o catálogo do PostgreSQL, se o usuário de execução
 * **não pode escrever**.
 *
 * A pergunta é feita com `has_table_privilege`, que já considera os
 * privilégios herdados por memberships — o que importa, porque um usuário
 * pode não ter INSERT em uma tabela e mesmo assim escrever nela por pertencer
 * a outro papel.
 *
 * Por que não testar com um `UPDATE` de mentira: dentro de uma transação
 * somente leitura, o PostgreSQL acusa a transação **antes** de olhar o
 * privilégio da tabela. O erro seria "cannot execute UPDATE in a read-only
 * transaction" nos dois casos — com e sem permissão — e a verificação não
 * distinguiria nada. O catálogo não tem essa ambiguidade.
 */
export async function consultarPrivilegiosDeEscrita(
  client: pg.PoolClient,
): Promise<PrivilegiosDeEscrita> {
  const { rows } = await client.query<{
    tabelas_com_escrita: number;
    tabelas: number;
    pode_criar_no_schema: boolean;
  }>(`
    SELECT
      (SELECT count(*)::int FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r') AS tabelas,
      (SELECT count(*)::int FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
          AND has_table_privilege(current_user, c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE')) AS tabelas_com_escrita,
      has_schema_privilege(current_user, 'public', 'CREATE') AS pode_criar_no_schema
  `);

  const linha = rows[0];
  const podeEscrever =
    (linha?.tabelas_com_escrita ?? 0) > 0 || linha?.pode_criar_no_schema === true;

  return {
    podeEscrever,
    detalhe: podeEscrever
      ? `o usuário tem escrita em ${linha?.tabelas_com_escrita} de ${linha?.tabelas} tabela(s)` +
        (linha?.pode_criar_no_schema ? ' e pode criar objetos no schema' : '')
      : `sem escrita em ${linha?.tabelas} tabela(s) e sem CREATE no schema`,
  };
}

/**
 * Confere que o usuário de execução é diferente do administrativo.
 *
 * Se forem o mesmo, a separação de privilégios não existe: o SQL de quem usa
 * o laboratório herdaria todos os privilégios do dono do schema.
 */
export function compararUsuarios(
  urlDeExecucao: string,
  urlAdministrativa: string | undefined,
): { diferentes: boolean; detalhe: string } {
  const execucao = usuarioDaUrl(urlDeExecucao);
  const admin = urlAdministrativa ? usuarioDaUrl(urlAdministrativa) : null;

  if (!admin) {
    return {
      diferentes: false,
      detalhe: 'DATABASE_ADMIN_URL não está definida: não há como separar os papéis',
    };
  }
  if (!execucao) {
    return { diferentes: false, detalhe: 'não foi possível ler o usuário de DATABASE_URL' };
  }
  if (execucao === admin) {
    return {
      diferentes: false,
      detalhe: `DATABASE_URL e DATABASE_ADMIN_URL usam o mesmo usuário (${execucao})`,
    };
  }
  return { diferentes: true, detalhe: `execução: ${execucao} | administrativo: ${admin}` };
}

/**
 * Verificação de partida: a separação de privilégios está de pé?
 *
 * Em produção, uma falha aqui **impede a API de subir**. Sem isso, um erro
 * de configuração — a variável trocada, o papel não criado — deixaria o
 * laboratório rodando com um usuário que escreve no banco.
 */
export async function verificarSeparacaoDePrivilegios(): Promise<ResultadoDaVerificacao> {
  const problemas: string[] = [];
  const detalhes: string[] = [];

  const usuarios = compararUsuarios(env.databaseUrl, env.databaseAdminUrl);
  detalhes.push(usuarios.detalhe);
  if (!usuarios.diferentes) {
    problemas.push(
      'O usuário de execução e o administrativo não são separados: ' + usuarios.detalhe,
    );
  }

  const client = await pool.connect();
  try {
    const escrita = await consultarPrivilegiosDeEscrita(client);
    detalhes.push(escrita.detalhe);
    if (escrita.podeEscrever) {
      problemas.push('O usuário de execução tem permissão de escrita no banco: ' + escrita.detalhe);
    }

    // O papel de execução precisa enxergar as tabelas de verdade.
    try {
      const { rows } = await client.query('SELECT count(*)::int AS total FROM clientes');
      if (rows[0]?.total === undefined) {
        problemas.push('A tabela clientes não está visível para o usuário de execução.');
      } else {
        detalhes.push(`a tabela clientes é visível (${rows[0].total} linha(s))`);
      }
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      problemas.push(`O usuário de execução não consegue ler o banco: ${mensagem.split('\n')[0]}`);
    }
  } finally {
    client.release();
  }

  return { ok: problemas.length === 0, problemas, detalhes };
}

/**
 * Verificação de partida, com o comportamento certo para cada ambiente.
 *
 * Em produção, a separação de privilégios é obrigatória: se faltar algo, a API
 * não sobe. Em desenvolvimento, a ausência é um aviso — é assim que o
 * laboratório roda numa máquina sem dois papéis.
 */
export async function exigirSeparacaoDePrivilegios(): Promise<void> {
  const resultado = await verificarSeparacaoDePrivilegios();

  for (const detalhe of resultado.detalhes) {
    console.log(`[privilegios] ${detalhe}`);
  }

  if (resultado.ok) return;

  const mensagem = [
    'A separação de privilégios do SQL Lab não está de pé:',
    ...resultado.problemas.map((problema) => `  - ${problema}`),
    '',
    'O laboratório executa SQL escrito por quem usa a interface. Sem a separação,',
    'esse SQL herda os privilégios do dono do schema, e a transação somente leitura',
    'passa a ser a única barreira.',
    '',
    'Para corrigir, defina duas conexões diferentes:',
    '  DATABASE_URL         usuário com apenas SELECT (sql_lab_exec)',
    '  DATABASE_ADMIN_URL   usuário dono do schema',
    'e prepare o banco com: npm run db:reset',
  ].join('\n');

  if (env.isProduction) {
    console.error(mensagem);
    throw new Error('Configuração insegura: a API não sobe sem a separação de privilégios.');
  }

  console.warn(mensagem);
  console.warn('Aviso apenas: em desenvolvimento a API sobe mesmo assim.');
}
