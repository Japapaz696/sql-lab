import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { conferirPreparacao, nomeDoBanco } from '../database/setup.js';
import { abrirBancoAdministrativo } from './banco.js';

/**
 * A preparação recria o schema inteiro. Num banco com dados de verdade, isso
 * é destrutivo — por isso o comando se recusa a rodar fora de um banco de
 * laboratório, e exige confirmação explícita.
 */
describe('proteção do db:reset', () => {
  const urlDoBanco = (nome: string) => `postgresql://sql_lab:sql_lab@127.0.0.1:55442/${nome}`;

  const ambienteOriginal = { ...process.env };

  afterAll(() => {
    process.env = ambienteOriginal;
  });

  it('lê o nome do banco a partir da URL', () => {
    expect(nomeDoBanco(urlDoBanco('sql_lab'))).toBe('sql_lab');
    expect(nomeDoBanco('nao-e-uma-url')).toBeNull();
  });

  it('recusa um banco que não parece de laboratório', () => {
    process.env.SQL_LAB_CONFIRMAR_RESET = 'sim';
    process.env.SQL_LAB_EXEC_PASSWORD = 'senha-forte-de-teste-2026';

    expect(() => conferirPreparacao(urlDoBanco('dados_de_producao'), 'sql_lab_exec')).toThrow(
      /não parece um banco de laboratório/,
    );
  });

  it('recusa sem a confirmação explícita', () => {
    process.env.SQL_LAB_CONFIRMAR_RESET = 'nao';
    process.env.SQL_LAB_EXEC_PASSWORD = 'senha-forte-de-teste-2026';

    expect(() => conferirPreparacao(urlDoBanco('sql_lab'), 'sql_lab_exec')).toThrow(
      /confirmação não está presente/,
    );
  });

  it('recusa sem a senha do papel de execução', () => {
    process.env.SQL_LAB_CONFIRMAR_RESET = 'sim';
    delete process.env.SQL_LAB_EXEC_PASSWORD;

    expect(() => conferirPreparacao(urlDoBanco('sql_lab'), 'sql_lab_exec')).toThrow(
      /SQL_LAB_EXEC_PASSWORD não está definida/,
    );
  });

  it('recusa uma senha igual ao nome do papel', () => {
    process.env.SQL_LAB_CONFIRMAR_RESET = 'sim';
    process.env.SQL_LAB_EXEC_PASSWORD = 'sql_lab_exec';

    expect(() => conferirPreparacao(urlDoBanco('sql_lab'), 'sql_lab_exec')).toThrow(
      /não pode ser igual ao nome do papel/,
    );
  });

  it('recusa uma senha curta', () => {
    process.env.SQL_LAB_CONFIRMAR_RESET = 'sim';
    process.env.SQL_LAB_EXEC_PASSWORD = 'curta';

    expect(() => conferirPreparacao(urlDoBanco('sql_lab'), 'sql_lab_exec')).toThrow(
      /ao menos 16 caracteres/,
    );
  });

  it('aceita um banco de laboratório, com confirmação e senha forte', () => {
    process.env.SQL_LAB_CONFIRMAR_RESET = 'sim';
    process.env.SQL_LAB_EXEC_PASSWORD = 'senha-forte-de-teste-2026';

    const contexto = conferirPreparacao(urlDoBanco('sql_lab'), 'sql_lab_exec');
    expect(contexto.banco).toBe('sql_lab');
  });

  it('aceita o nome do banco da demonstração', () => {
    process.env.SQL_LAB_CONFIRMAR_RESET = 'sim';
    process.env.SQL_LAB_EXEC_PASSWORD = 'senha-forte-de-teste-2026';

    expect(conferirPreparacao(urlDoBanco('sql_lab_demo'), 'sql_lab_exec').banco).toBe(
      'sql_lab_demo',
    );
  });
});

/**
 * A senha do papel de execução não pode estar no repositório: nem como
 * literal no SQL, nem como valor fixo em qualquer lugar versionado.
 */
describe('nenhuma senha fixa no repositório', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = abrirBancoAdministrativo();
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('o script de privilégios não tem senha literal', async () => {
    const fs = await import('node:fs/promises');
    const caminho = new URL('../../../../db/privilegios.sql', import.meta.url);
    const sql = await fs.readFile(caminho, 'utf8');

    // Nenhuma senha fixa: o texto tem que vir por parâmetro.
    expect(sql).not.toMatch(/PASSWORD\s+'\w+'/i);
    expect(sql).not.toContain("PASSWORD 'sql_lab_exec'");
    expect(sql).toContain("current_setting('sql_lab.exec_password'");
  });

  it('a senha chega por parâmetro, e o papel fica com a senha informada', async () => {
    const fs = await import('node:fs/promises');
    const caminho = new URL('../../../../db/privilegios.sql', import.meta.url);
    const sql = await fs.readFile(caminho, 'utf8');

    const senha = 'senha-de-teste-aleatoria-9f3a';
    const cliente = await pool.connect();
    try {
      await cliente.query("SELECT set_config('sql_lab.exec_password', $1, false)", [senha]);
      await cliente.query(sql);
    } finally {
      cliente.release();
    }

    // O papel existe e consegue entrar com a senha informada.
    const { rows } = await pool.query(
      "SELECT rolcanlogin FROM pg_roles WHERE rolname = 'sql_lab_exec'",
    );
    expect(rows[0]?.rolcanlogin).toBe(true);
  });
});
