import type pg from 'pg';

import { env } from '../config/env.js';
import { poolAdmin } from './pool.js';

/**
 * Aplica o schema, a carga fictícia e as concessões de privilégio.
 *
 * Usa a conexão administrativa: a aplicação executa as consultas do aluno com
 * um usuário sem permissão de escrita, e quem prepara o banco precisa de
 * permissão para criar tabelas.
 */
export async function prepararBanco(alvo?: pg.Pool): Promise<void> {
  const conexao = alvo ?? poolAdmin;
  if (!conexao) {
    throw new Error(
      'É preciso uma conexão administrativa para preparar o banco. Defina DATABASE_ADMIN_URL.',
    );
  }

  const client = await conexao.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
    await client.query('SET search_path TO public');

    const fs = await import('node:fs/promises');
    const caminho = (nome: string) => `${env.rootDir}/db/${nome}`;

    const schema = await fs.readFile(caminho('schema.sql'), 'utf8');
    const seed = await fs.readFile(caminho('seed.sql'), 'utf8');
    const privilegios = await fs.readFile(caminho('privilegios.sql'), 'utf8');

    await client.query(schema);
    await client.query(seed);

    // As concessões dependem de o usuário administrativo poder criar papéis.
    // Em hospedagens gerenciadas isso nem sempre é possível — e tudo bem: a
    // proteção principal não depende de papel nenhum.
    try {
      await client.query(privilegios);
    } catch (erro) {
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      console.warn(
        `Aviso: nao foi possivel aplicar a separacao de privilegios (${mensagem.split('\n')[0]}). ` +
          'O laboratorio segue protegido pela transacao somente leitura e pelo protocolo estendido.',
      );
    }
  } finally {
    client.release();
  }
}

export async function contarRegistros(tabela: string, alvo: pg.Pool): Promise<number> {
  const { rows } = await alvo.query(`SELECT count(*)::int AS total FROM ${tabela}`);
  return rows[0]?.total ?? 0;
}
