import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { prepararBanco } from '../database/setup.js';
import { executarConsulta, explicarConsulta } from '../services/sql.service.js';
import { abrirBancoAdministrativo } from './banco.js';

/**
 * Testes de regressão de segurança.
 *
 * Cada caso aqui é uma falha que existiu de verdade no código e foi
 * corrigida. O objetivo é que a regressão não volte.
 *
 * As consultas da suíte usam a conexão de **execução** — a mesma da
 * aplicação, sem permissão de escrita. As conferências diretas no banco usam
 * a conexão administrativa.
 */
let pool: pg.Pool;
let nomeOriginal: string | undefined;

beforeAll(async () => {
  pool = abrirBancoAdministrativo();
  await prepararBanco(pool);

  const { rows } = await pool.query("SELECT nome FROM clientes WHERE codigo = 'CLI-0001'");
  nomeOriginal = rows[0]?.nome;
}, 60_000);

afterAll(async () => {
  await pool?.end();
});

async function nomeDoCliente(): Promise<string | undefined> {
  const { rows } = await pool.query("SELECT nome FROM clientes WHERE codigo = 'CLI-0001'");
  return rows[0]?.nome;
}

describe('comando SQL múltiplo', () => {
  // O bug: o protocolo simples aceita várias instruções separadas por ";".
  // Um "COMMIT" no meio da string encerrava a transação READ ONLY, e a
  // instrução seguinte rodava fora dela, em modo de escrita.
  it('recusa "COMMIT; UPDATE" sem executar nada', async () => {
    const resultado = await executarConsulta(
      "COMMIT; UPDATE clientes SET nome = 'INVADIDO' WHERE codigo = 'CLI-0001'",
    );

    expect(resultado.ok).toBe(false);
    expect(resultado.erro).toMatch(/uma instrução|uma instrucao/i);
    expect(await nomeDoCliente()).toBe(nomeOriginal);
  });

  it('recusa "COMMIT; SELECT"', async () => {
    const resultado = await executarConsulta('COMMIT; SELECT 1');
    expect(resultado.ok).toBe(false);
  });

  it('recusa "SELECT 1; SELECT 2"', async () => {
    const resultado = await executarConsulta('SELECT 1 AS a; SELECT 2 AS b');
    expect(resultado.ok).toBe(false);
  });

  it('recusa "ROLLBACK; UPDATE"', async () => {
    const resultado = await executarConsulta(
      "ROLLBACK; UPDATE clientes SET nome = 'INVADIDO' WHERE codigo = 'CLI-0001'",
    );
    expect(resultado.ok).toBe(false);
    expect(await nomeDoCliente()).toBe(nomeOriginal);
  });

  it('recusa "BEGIN; UPDATE" fora da transação', async () => {
    const resultado = await executarConsulta(
      "BEGIN; UPDATE clientes SET nome = 'INVADIDO' WHERE codigo = 'CLI-0001'",
    );
    expect(resultado.ok).toBe(false);
    expect(await nomeDoCliente()).toBe(nomeOriginal);
  });

  it('recusa "SET TRANSACTION READ WRITE; UPDATE"', async () => {
    const resultado = await executarConsulta(
      "SET TRANSACTION READ WRITE; UPDATE clientes SET nome = 'INVADIDO' WHERE codigo = 'CLI-0001'",
    );
    expect(resultado.ok).toBe(false);
    expect(await nomeDoCliente()).toBe(nomeOriginal);
  });

  it('recusa "COPY clientes TO STDOUT" seguido de escrita', async () => {
    const resultado = await executarConsulta(
      "COPY clientes TO STDOUT; UPDATE clientes SET nome = 'INVADIDO' WHERE codigo = 'CLI-0001'",
    );
    expect(resultado.ok).toBe(false);
    expect(await nomeDoCliente()).toBe(nomeOriginal);
  });

  it('recusa "DO" com comando aninhado', async () => {
    const resultado = await executarConsulta(
      "DO $$ BEGIN UPDATE clientes SET nome = 'INVADIDO' WHERE codigo = 'CLI-0001'; END $$;",
    );
    expect(resultado.ok).toBe(false);
    expect(await nomeDoCliente()).toBe(nomeOriginal);
  });
});

describe('escrita isolada', () => {
  it('recusa um UPDATE', async () => {
    const resultado = await executarConsulta(
      "UPDATE clientes SET nome = 'alterado' WHERE codigo = 'CLI-0001'",
    );
    expect(resultado.ok).toBe(false);
    expect(await nomeDoCliente()).toBe(nomeOriginal);
  });

  it('recusa um DELETE', async () => {
    const resultado = await executarConsulta('DELETE FROM clientes');
    expect(resultado.ok).toBe(false);
  });

  it('recusa um DROP TABLE', async () => {
    const resultado = await executarConsulta('DROP TABLE clientes');
    expect(resultado.ok).toBe(false);
  });

  it('recusa um INSERT', async () => {
    const resultado = await executarConsulta(
      "INSERT INTO clientes (id, codigo, nome, documento, cidade, uf, canal) VALUES (gen_random_uuid(), 'X', 'X', 'X', 'X', 'MG', 'varejo')",
    );
    expect(resultado.ok).toBe(false);
  });

  it('recusa um TRUNCATE', async () => {
    const resultado = await executarConsulta('TRUNCATE clientes');
    expect(resultado.ok).toBe(false);
  });

  it('recusa um CREATE TABLE', async () => {
    const resultado = await executarConsulta('CREATE TABLE x (a int)');
    expect(resultado.ok).toBe(false);
  });

  it('recusa um GRANT', async () => {
    const resultado = await executarConsulta('GRANT ALL ON clientes TO public');
    expect(resultado.ok).toBe(false);
  });

  it('recusa um VACUUM, que não pode rodar dentro de transação', async () => {
    const resultado = await executarConsulta('VACUUM clientes');
    expect(resultado.ok).toBe(false);
  });

  it('não deixa os dados alterados depois de uma tentativa de escrita', async () => {
    await executarConsulta("UPDATE clientes SET nome = 'alterado' WHERE codigo = 'CLI-0001'");
    await executarConsulta(
      "COMMIT; UPDATE clientes SET nome = 'alterado' WHERE codigo = 'CLI-0001'",
    );
    expect(await nomeDoCliente()).toBe(nomeOriginal);
  });
});

describe('limite de linhas', () => {
  // O bug: o driver carregava o resultado inteiro na memória e o limite de
  // 200 era aplicado só depois, no array já cheio.
  it('para no limite e avisa que truncou', async () => {
    await pool.query(`
      INSERT INTO clientes (id, codigo, nome, documento, cidade, uf, canal)
      SELECT gen_random_uuid(), 'LIM-' || g, 'Cliente ' || g, 'X' || g, 'BH', 'MG', 'varejo'
      FROM generate_series(1, 1200) g
    `);

    try {
      const resultado = await executarConsulta('SELECT codigo FROM clientes');
      expect(resultado.ok).toBe(true);
      expect(resultado.linhas.length).toBe(200);
      expect(resultado.truncado).toBe(true);
    } finally {
      await pool.query("DELETE FROM clientes WHERE codigo LIKE 'LIM-%'");
    }
  });

  it('não marca truncamento quando o resultado cabe no limite', async () => {
    const resultado = await executarConsulta('SELECT codigo FROM clientes');
    expect(resultado.ok).toBe(true);
    expect(resultado.truncado).toBe(false);
    expect(resultado.linhas.length).toBeLessThanOrEqual(200);
  });

  it('não carrega o resultado inteiro na memória', async () => {
    await pool.query(`
      INSERT INTO clientes (id, codigo, nome, documento, cidade, uf, canal)
      SELECT gen_random_uuid(), 'MEM-' || g, 'Cliente ' || g, 'X' || g, 'BH', 'MG', 'varejo'
      FROM generate_series(1, 20000) g
    `);

    try {
      const antes = process.memoryUsage().heapUsed;
      const resultado = await executarConsulta('SELECT codigo FROM clientes');
      const depois = process.memoryUsage().heapUsed;
      const crescimentoMb = (depois - antes) / 1024 / 1024;

      expect(resultado.linhas.length).toBe(200);
      // Com 20 mil linhas no banco, o processo não pode carregar tudo.
      expect(crescimentoMb).toBeLessThan(20);
    } finally {
      await pool.query("DELETE FROM clientes WHERE codigo LIKE 'MEM-%'");
    }
  });
});

describe('tempo limite', () => {
  it('cancela uma consulta que passa do tempo limite', async () => {
    const resultado = await executarConsulta('SELECT pg_sleep(10), generate_series(1, 500000) g');
    expect(resultado.ok).toBe(false);
    expect(resultado.erro).toMatch(/tempo limite/i);
  }, 30_000);
});

describe('EXPLAIN', () => {
  it('recusa comando múltiplo', async () => {
    const resultado = await explicarConsulta('SELECT 1; SELECT 2');
    expect(resultado.erro).toBeTruthy();
  });

  it('não executa a consulta que ele explica', async () => {
    // O EXPLAIN de um UPDATE mostra o plano sem alterar nada.
    const resultado = await explicarConsulta(
      "UPDATE clientes SET nome = 'INVADIDO' WHERE codigo = 'CLI-0001'",
    );
    expect(await nomeDoCliente()).toBe(nomeOriginal);
    void resultado;
  });
});
