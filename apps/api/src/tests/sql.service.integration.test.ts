import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { prepararBanco } from '../database/setup.js';
import { executarConsulta, explicarConsulta } from '../services/sql.service.js';
import { abrirBancoAdministrativo } from './banco.js';

/**
 * A suíte roda contra o banco de teste: o `setup.ts` redireciona
 * `DATABASE_URL` para `TEST_DATABASE_URL` antes de qualquer import, e o
 * `global-setup.ts` recria o esquema e a carga antes dos testes.
 *
 * As consultas da suíte usam a conexão de **execução** — a mesma da
 * aplicação, sem permissão de escrita. As conferências diretas no banco usam
 * a conexão administrativa.
 */
let pool: pg.Pool;

beforeAll(async () => {
  pool = abrirBancoAdministrativo();
  await prepararBanco(pool);
}, 60_000);

afterAll(async () => {
  await pool?.end();
});

describe('execução de consultas', () => {
  it('devolve a mensagem do PostgreSQL quando a consulta tem erro de sintaxe', async () => {
    const resultado = await executarConsulta('SELEC * FROM clientes');
    expect(resultado.ok).toBe(false);
    expect(resultado.erro).toBeTruthy();
    expect(resultado.erro).not.toMatch(/^\s*$/);
  });

  it('devolve a mensagem do PostgreSQL quando a tabela não existe', async () => {
    const resultado = await executarConsulta('SELECT * FROM tabela_que_nao_existe');
    expect(resultado.ok).toBe(false);
    expect(resultado.erro).toMatch(/inexistente/i);
  });

  it('traduz o erro de coluna inexistente', async () => {
    const resultado = await executarConsulta('SELECT coluna_que_nao_existe FROM clientes');
    expect(resultado.ok).toBe(false);
    expect(resultado.erro).toMatch(/Coluna inexistente/i);
  });

  it('traduz o erro de sintaxe', async () => {
    const resultado = await executarConsulta('SELECT FROM');
    expect(resultado.ok).toBe(false);
    expect(resultado.erro).toMatch(/sintaxe/i);
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

  it('devolve o tempo que a consulta levou', async () => {
    const resultado = await executarConsulta('SELECT 1');
    expect(resultado.ok).toBe(true);
    expect(resultado.duracaoMs).toBeGreaterThanOrEqual(0);
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
