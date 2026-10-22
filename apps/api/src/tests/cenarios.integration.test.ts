import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { poolAdmin } from '../database/pool.js';
import { prepararBanco } from '../database/setup.js';
import { TABELAS_DO_ERP } from '../database/tabelas-do-erp.js';
import { cenarios } from '../scenarios/index.js';
import { descreverEsquema } from '../services/schema.service.js';
import { avaliarCenario, compararResultados } from '../services/scenarios.service.js';
import { executarConsulta } from '../services/sql.service.js';

/**
 * A suíte roda contra o banco de teste: o `setup.ts` redireciona
 * `DATABASE_URL` para `TEST_DATABASE_URL` antes de qualquer import, e o
 * `global-setup.ts` recria o esquema e a carga antes dos testes.
 *
 * As consultas da suíte usam a conexão de **execução** — a mesma da
 * aplicação, sem permissão de escrita. As conferências diretas no banco usam a
 * conexão administrativa.
 */
let pool: pg.Pool;

beforeAll(async () => {
  pool =
    poolAdmin ??
    new pg.Pool({
      connectionString: process.env.DATABASE_ADMIN_URL ?? process.env.TEST_DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 10_000,
    });
  // A preparação exige confirmação e a senha do papel de execução. Na suíte,
  // as duas vêm do ambiente, e o banco tem nome de laboratório.
  process.env.SQL_LAB_CONFIRMAR_RESET = 'sim';
  process.env.SQL_LAB_EXEC_PASSWORD ??= 'senha-de-teste-da-suite';
  await prepararBanco(pool);
}, 60_000);

afterAll(async () => {
  await pool?.end();
});

describe('carga de dados fictícios', () => {
  it('popula todas as tabelas do ERP', async () => {
    // O ::int importa: count(*) devolve bigint, e o driver do PostgreSQL
    // devolve bigint como texto.
    const { rows } = await pool.query(`
      SELECT
        (SELECT count(*)::int FROM clientes)     AS clientes,
        (SELECT count(*)::int FROM produtos)     AS produtos,
        (SELECT count(*)::int FROM pedidos)      AS pedidos,
        (SELECT count(*)::int FROM itens_pedido) AS itens,
        (SELECT count(*)::int FROM pagamentos)   AS pagamentos,
        (SELECT count(*)::int FROM estoque)      AS estoque,
        (SELECT count(*)::int FROM chamados)     AS chamados
    `);

    const dados = rows[0];
    expect(dados.clientes).toBe(6);
    expect(dados.produtos).toBe(8);
    expect(dados.pedidos).toBe(9);
    expect(dados.itens).toBe(19);
    expect(dados.pagamentos).toBe(10);
    expect(dados.estoque).toBe(8);
    expect(dados.chamados).toBe(4);
  });

  it('não guarda nenhum e-mail de domínio real', async () => {
    // O domínio fica no fim do endereço, depois do "@". O padrão precisa do
    // ponto antes de "exemplo.invalid".
    const { rows } = await pool.query(
      `SELECT count(*)::int AS total
       FROM clientes
       WHERE split_part(email, '@', 2) NOT LIKE '%.exemplo.invalid'`,
    );
    expect(rows[0].total).toBe(0);
  });

  it('mantém os totais dos pedidos iguais à soma dos itens, exceto o pedido com divergência', async () => {
    const { rows } = await pool.query(`
      SELECT p.numero,
             p.total,
             SUM(i.quantidade * i.preco_unitario - i.desconto_item) AS soma_itens
      FROM pedidos p
      JOIN itens_pedido i ON i.pedido_id = p.id
      GROUP BY p.id, p.numero, p.total
      HAVING p.total <> SUM(i.quantidade * i.preco_unitario - i.desconto_item)
    `);

    // Só o PED-0003 tem divergência, de propósito: é o cenário 5.
    expect(rows).toHaveLength(1);
    expect(rows[0].numero).toBe('PED-0003');
  });
});

describe('cenários do laboratório', () => {
  it('tem os 10 cenários do MVP, com identificadores únicos', () => {
    expect(cenarios).toHaveLength(10);
    const ids = cenarios.map((cenario) => cenario.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('todo cenário tem sintoma, contexto, técnica e explicação', () => {
    for (const cenario of cenarios) {
      expect(cenario.sintoma.length, cenario.id).toBeGreaterThan(40);
      expect(cenario.contexto.length, cenario.id).toBeGreaterThan(60);
      expect(cenario.explicacao.length, cenario.id).toBeGreaterThan(120);
      expect(cenario.errosComuns.length, cenario.id).toBeGreaterThanOrEqual(2);
      expect(cenario.dicas.length, cenario.id).toBeGreaterThanOrEqual(2);
      expect(cenario.indices.length, cenario.id).toBeGreaterThanOrEqual(1);
    }
  });

  it('todo cenário tem a consulta de referência completa', () => {
    for (const cenario of cenarios) {
      expect(cenario.sqlReferencia, cenario.id).toMatch(/^\s*select\b/i);
      // Não pode terminar no meio de uma instrução.
      expect(cenario.sqlReferencia.trimEnd(), cenario.id).not.toMatch(/,\s*$/);
      expect(cenario.sqlReferencia.trimEnd(), cenario.id).not.toMatch(/--\s*$/);
    }
  });

  it('a consulta de referência de cada cenário roda e devolve o resultado esperado', async () => {
    for (const cenario of cenarios) {
      const resultado = await executarConsulta(cenario.sqlReferencia);
      expect(resultado.ok, `${cenario.id}: ${resultado.erro ?? ''}`).toBe(true);
      // Todo cenário do MVP devolve pelo menos uma linha: um sintoma sem
      // achado não serve para o exercício.
      expect(resultado.totalLinhas, cenario.id).toBeGreaterThan(0);
    }
  });

  it('a consulta de referência devolve exatamente as linhas esperadas', async () => {
    // As contagens foram conferidas contra a carga fictícia do seed.
    const esperado: Record<string, number> = {
      // Só a CLI-0001 comprou antes e parou.
      'cliente-que-parou-de-comprar': 1,
      // Só o PED-0001 tem títulos pagos somando mais que o total.
      'titulo-pago-a-mais': 1,
      // Só o PROD-004 tem reservado maior que a quantidade.
      'estoque-availability-negativa': 1,
      // 7 pedidos entregues, e só o PED-0001 tem movimentação de saída.
      'pedido-entregue-sem-baixa': 6,
      // Só o PED-0003 tem total diferente da soma dos itens.
      'total-pedido-divergente': 1,
      // Só a CLI-0002 tem valor pedido acima do limite.
      'limite-credito-estourado': 1,
      // PROD-005 e PROD-006 nunca tiveram movimentação.
      'produto-sem-movimentacao': 2,
      // Só o CHM-0001 é de cobrança de pedido sem título em aberto.
      'chamado-de-cobranca-ja-pago': 1,
      // TIT-9003 e TIT-9004 estão pendentes e vencidos.
      'titulo-vencido': 2,
      // Três clientes têm pedido entregue.
      'concentracao-faturamento': 3,
    };

    for (const cenario of cenarios) {
      const resultado = await executarConsulta(cenario.sqlReferencia);
      expect(resultado.totalLinhas, cenario.id).toBe(esperado[cenario.id]);
    }
  });

  it('o cenário de cliente que parou devolve só o CLI-0001', async () => {
    const resultado = await executarConsulta(
      cenarios.find((c) => c.id === 'cliente-que-parou-de-comprar')!.sqlReferencia,
    );
    expect(resultado.linhas.map((linha) => linha[0])).toEqual(['CLI-0001']);
  });

  it('o cenário de divergência acha o PED-0003 com 95.00 de diferença', async () => {
    const resultado = await executarConsulta(
      cenarios.find((c) => c.id === 'total-pedido-divergente')!.sqlReferencia,
    );
    expect(resultado.linhas[0]?.[0]).toBe('PED-0003');
    expect(Number(resultado.linhas[0]?.[3])).toBe(95);
  });

  it('o cenário de estoque negativo acha só o PROD-004', async () => {
    const resultado = await executarConsulta(
      cenarios.find((c) => c.id === 'estoque-availability-negativa')!.sqlReferencia,
    );
    expect(resultado.linhas.map((linha) => linha[0])).toEqual(['PROD-004']);
  });

  it('o cenário de limite de crédito acha só o CLI-0002', async () => {
    const resultado = await executarConsulta(
      cenarios.find((c) => c.id === 'limite-credito-estourado')!.sqlReferencia,
    );
    expect(resultado.linhas.map((linha) => linha[0])).toEqual(['CLI-0002']);
  });

  it('o cenário de movimentação devolve os dois produtos sem movimento', async () => {
    const resultado = await executarConsulta(
      cenarios.find((c) => c.id === 'produto-sem-movimentacao')!.sqlReferencia,
    );
    expect(resultado.linhas.map((linha) => linha[0])).toEqual(['PROD-005', 'PROD-006']);
  });

  it('o cenário de título vencido acha os dois pendentes vencidos', async () => {
    const resultado = await executarConsulta(
      cenarios.find((c) => c.id === 'titulo-vencido')!.sqlReferencia,
    );
    // Ambos estão marcados como "pendente" no cadastro, e é exatamente esse
    // o problema relatado: o relatório de inadimplência não os lista.
    expect(resultado.linhas.map((linha) => linha[0])).toEqual(['TIT-9003', 'TIT-9004']);
  });
});

describe('comparação de resultados', () => {
  it('trata o mesmo número escrito de formas diferentes como igual', () => {
    const { iguais } = compararResultados([['110.50']], [[110.5]]);
    expect(iguais).toBe(true);
  });

  it('ignora a ordem das linhas', () => {
    const { iguais } = compararResultados(
      [
        ['CLI-0001', '1'],
        ['CLI-0002', '2'],
      ],
      [
        ['CLI-0002', '2'],
        ['CLI-0001', '1'],
      ],
    );
    expect(iguais).toBe(true);
  });

  it('reconhece quantidades diferentes', () => {
    const { iguais, feedback } = compararResultados([['a']], [['a'], ['b']]);
    expect(iguais).toBe(false);
    expect(feedback).toMatch(/1 linha/);
  });

  it('reconhece conteúdos diferentes na mesma quantidade', () => {
    const { iguais, feedback } = compararResultados([['a']], [['b']]);
    expect(iguais).toBe(false);
    expect(feedback).toMatch(/conteúdo/);
  });
});

describe('esquema exposto ao aluno', () => {
  it('lista somente as nove tabelas do ERP, sem a tabela interna', async () => {
    const tabelas = await descreverEsquema();

    expect(tabelas.map((tabela) => tabela.nome).sort()).toEqual([...TABELAS_DO_ERP].sort());
    expect(tabelas.some((tabela) => tabela.nome === 'progresso_cenarios')).toBe(false);
  });

  it('descreve colunas, chave primária e contagem', async () => {
    const tabelas = await descreverEsquema();
    const clientes = tabelas.find((tabela) => tabela.nome === 'clientes');

    expect(clientes).toBeDefined();
    expect(clientes?.linhas).toBe(6);
    expect(clientes?.chavePrimaria).toEqual(['id']);
    expect(clientes?.colunas.map((coluna) => coluna.nome)).toContain('codigo');
  });
});

describe('avaliação do aluno', () => {
  it('não inventa contagem quando a consulta falha', async () => {
    const avaliacao = await avaliarCenario('titulo-vencido', 'SELECT * FROM tabela_inexistente');

    expect(avaliacao).not.toBeNull();
    expect(avaliacao?.verificacao.acertou).toBe(false);
    expect(avaliacao?.verificacao.linhasEsperadas).toBeNull();
    expect(avaliacao?.verificacao.linhasObtidas).toBeNull();
    expect(avaliacao?.consulta.ok).toBe(false);
  });

  it('devolve a consulta executada, sem repetir o SQL', async () => {
    const referencia = cenarios.find((cenario) => cenario.id === 'titulo-vencido');
    expect(referencia).toBeDefined();

    const avaliacao = await avaliarCenario(referencia!.id, referencia!.sqlReferencia);

    expect(avaliacao?.verificacao.acertou).toBe(true);
    expect(avaliacao?.consulta.ok).toBe(true);
    expect(avaliacao?.consulta.totalLinhas).toBe(2);
    expect(avaliacao?.verificacao.linhasEsperadas).toBe(2);
    expect(avaliacao?.verificacao.linhasObtidas).toBe(2);
  });
});
