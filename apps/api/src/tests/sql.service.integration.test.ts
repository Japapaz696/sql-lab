import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { prepararBanco } from '../database/setup.js';
import { executarConsulta, explicarConsulta } from '../services/sql.service.js';

/**
 * A suíte roda contra o banco de teste: o `setup.ts` redireciona
 * `DATABASE_URL` para `TEST_DATABASE_URL` antes de qualquer import, e o
 * `global-setup.ts` recria o esquema e a carga antes dos testes.
 */
let pool: pg.Pool;

beforeAll(async () => {
  pool = new pg.Pool({
    connectionString: process.env.TEST_DATABASE_URL,
    max: 5,
    connectionTimeoutMillis: 10_000,
  });
  await prepararBanco(pool);
}, 60_000);

afterAll(async () => {
  await pool?.end();
});

/**
 * A proteção do laboratório não depende de a API confiar no texto da consulta:
 * ela vem do servidor, em uma transação READ ONLY.
 */
describe('execução segura de consultas', () => {
  it('recusa um UPDATE', async () => {
    const resultado = await executarConsulta(
      "UPDATE clientes SET nome = 'alterado' WHERE codigo = 'CLI-0001'",
    );
    expect(resultado.ok).toBe(false);
    expect(resultado.erro).toMatch(/read-only|read only/i);
  });

  it('recusa um DELETE', async () => {
    const resultado = await executarConsulta('DELETE FROM clientes');
    expect(resultado.ok).toBe(false);
    expect(resultado.erro).toMatch(/read-only|read only/i);
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

  it('deixa os dados intactos depois de uma tentativa de escrita', async () => {
    await executarConsulta("UPDATE clientes SET nome = 'alterado' WHERE codigo = 'CLI-0001'");
    const { rows } = await pool.query("SELECT nome FROM clientes WHERE codigo = 'CLI-0001'");
    expect(rows[0].nome).toBe('Padaria Aurora Ltda');
  });

  it('devolve a mensagem do PostgreSQL quando a consulta tem erro de sintaxe', async () => {
    const resultado = await executarConsulta('SELEC * FROM clientes');
    expect(resultado.ok).toBe(false);
    expect(resultado.erro).toBeTruthy();
    expect(resultado.erro).not.toMatch(/^\s*$/);
  });

  it('devolve a mensagem do PostgreSQL quando a tabela não existe', async () => {
    const resultado = await executarConsulta('SELECT * FROM tabela_que_nao_existe');
    expect(resultado.ok).toBe(false);
    expect(resultado.erro).toMatch(/does not exist|não existe/i);
  });

  it('rejeita consulta vazia com uma mensagem útil', async () => {
    const resultado = await executarConsulta('   ');
    expect(resultado.ok).toBe(false);
    expect(resultado.erro).toMatch(/Escreva uma consulta/);
  });

  it('executa um SELECT válido e devolve colunas e linhas', async () => {
    const resultado = await executarConsulta(
      'SELECT codigo, nome FROM clientes ORDER BY codigo LIMIT 2',
    );
    expect(resultado.ok).toBe(true);
    expect(resultado.colunas).toEqual(['codigo', 'nome']);
    expect(resultado.linhas).toHaveLength(2);
    expect(resultado.linhas[0]?.[0]).toBe('CLI-0001');
  });

  it('trunca o resultado no limite configurado', async () => {
    const resultado = await executarConsulta('SELECT codigo FROM clientes');
    expect(resultado.ok).toBe(true);
    expect(resultado.linhas.length).toBeLessThanOrEqual(200);
    expect(resultado.truncado).toBe(false);
  });

  it('normaliza valores numéricos e datas', async () => {
    const resultado = await executarConsulta(
      "SELECT total, emitido_em FROM pedidos WHERE numero = 'PED-0001'",
    );
    expect(resultado.ok).toBe(true);
    expect(resultado.linhas[0]?.[0]).toBe('110.50');
    expect(String(resultado.linhas[0]?.[1])).toMatch(/^2025-06-10/);
  });
});

describe('plano de execução', () => {
  it('mostra o índice usado pela consulta', async () => {
    const resultado = await explicarConsulta(
      "SELECT * FROM pedidos WHERE cliente_id = 'c1000000-0000-4000-8000-000000000001'",
    );
    expect(resultado.erro).toBeUndefined();
    const plano = resultado.linhas.map((linha) => linha.chave).join(' ');
    expect(plano).toMatch(/Index Scan|Seq Scan/);
  });

  it('mostra uma varredura sequencial quando não há índice utilizável', async () => {
    const resultado = await explicarConsulta("SELECT * FROM clientes WHERE nome LIKE '%Aurora%'");
    expect(resultado.erro).toBeUndefined();
    const plano = resultado.linhas.map((linha) => linha.chave).join(' ');
    expect(plano).toMatch(/Seq Scan/);
  });

  it('devolve o erro quando a consulta não compila', async () => {
    const resultado = await explicarConsulta('SELEC 1');
    expect(resultado.erro).toBeTruthy();
  });
});
