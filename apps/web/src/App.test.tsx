import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { App } from './App';

// React 19 exige que o ambiente se declare como de teste, para o ct ser
// aceito sem aviso.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * A interface é a parte que o recrutador vê. Estes testes renderizam o
 * componente de verdade, em jsdom, contra uma API simulada com o mesmo
 * formato da API real.
 *
 * O que importa aqui:
 *
 *   - os dez cenários aparecem, com título e técnica;
 *   - o editor de SQL é preenchido com o esqueleto do cenário;
 *   - o botão de executar dispara a consulta e mostra o diagnóstico;
 *   - quando a API não responde, a interface explica que ela está acordando.
 */

const CENARIOS = [
  {
    id: 'c1',
    titulo: 'Cliente que parou de comprar',
    area: 'comercial',
    nivel: 'iniciante',
    sintoma: 'A cliente não compra há seis meses.',
    tecnica: 'GROUP BY com HAVING',
    resolvido: false,
    tentativas: 0,
  },
  {
    id: 'c2',
    titulo: 'Título pago a mais que o pedido',
    area: 'faturamento',
    nivel: 'intermediario',
    sintoma: 'O título não bate com o pedido.',
    tecnica: 'Agregação e comparação',
    resolvido: false,
    tentativas: 0,
  },
  {
    id: 'c3',
    titulo: 'Produto com disponibilidade negativa',
    area: 'estoque',
    nivel: 'intermediario',
    sintoma: 'O estoque aparece negativo.',
    tecnica: 'Aritmética entre colunas',
    resolvido: false,
    tentativas: 0,
  },
  {
    id: 'c4',
    titulo: 'Pedido entregue sem baixa no estoque',
    area: 'estoque',
    nivel: 'intermediario',
    sintoma: 'A mercadoria saiu e o estoque não baixou.',
    tecnica: 'LEFT JOIN com COUNT',
    resolvido: false,
    tentativas: 0,
  },
  {
    id: 'c5',
    titulo: 'Total do pedido diferente da soma dos itens',
    area: 'faturamento',
    nivel: 'intermediario',
    sintoma: 'O total não bate com os itens.',
    tecnica: 'Subquery agregada',
    resolvido: false,
    tentativas: 0,
  },
  {
    id: 'c6',
    titulo: 'Cliente acima do limite de crédito',
    area: 'comercial',
    nivel: 'intermediario',
    sintoma: 'A cliente passou do limite.',
    tecnica: 'LEFT JOIN com COALESCE',
    resolvido: false,
    tentativas: 0,
  },
  {
    id: 'c7',
    titulo: 'Produto ativo que nunca se movimentou',
    area: 'estoque',
    nivel: 'avancado',
    sintoma: 'O produto está ativo e não sai.',
    tecnica: 'NOT EXISTS',
    resolvido: false,
    tentativas: 0,
  },
  {
    id: 'c8',
    titulo: 'Chamado de cobrança de pedido já pago',
    area: 'cadastro',
    nivel: 'avancado',
    sintoma: 'O suporte recebe cobrança de pedido pago.',
    tecnica: 'EXISTS com agregação',
    resolvido: false,
    tentativas: 0,
  },
  {
    id: 'c9',
    titulo: 'Título vencido que ninguém cobrou',
    area: 'faturamento',
    nivel: 'avancado',
    sintoma: 'O título venceu e não foi cobrado.',
    tecnica: 'Filtro de intervalo de datas',
    resolvido: false,
    tentativas: 0,
  },
  {
    id: 'c10',
    titulo: 'Quem concentra o faturamento',
    area: 'relatorio',
    nivel: 'avancado',
    sintoma: 'A concentração de faturamento é alta.',
    tecnica: 'Soma acumulada com SUM() OVER',
    resolvido: false,
    tentativas: 0,
  },
];

const DETALHE = {
  ...CENARIOS[0],
  contexto: 'O relatório de clientes ativos usa a última compra.',
  sqlInicial: 'SELECT nome FROM clientes',
  explicacao: 'A consulta agrupa por cliente e compara com a data.',
  indices: ['idx_pedidos_cliente'],
  errosComuns: ['Faltou o filtro de data'],
  dicas: ['Comece pela data do último pedido'],
};

function resposta(corpo: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => corpo };
}

/**
 * Simula a API real: a lista, o detalhe, o esquema e a execução.
 */
function apiSimulada() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const caminho = String(url);

    if (caminho.endsWith('/scenarios')) {
      return resposta({
        cenarios: CENARIOS,
        progresso: { total: CENARIOS.length, resolvidos: 0 },
      });
    }

    if (caminho.includes('/esquema/tabelas')) {
      return resposta({ tabelas: [] });
    }

    if (caminho.endsWith('/execute')) {
      const sql = JSON.parse(String(init?.body ?? '{}')).sql as string;
      const acertou = sql.includes('HAVING');
      return resposta({
        consulta: {
          ok: true,
          colunas: ['cliente', 'total'],
          linhas: [['Comércio Alfa', '12500.00']],
          totalLinhas: 1,
          truncado: false,
          duracaoMs: 12,
        },
        verificacao: {
          acertou,
          feedback: acertou ? 'Diagnóstico correto.' : 'Ainda não é o diagnóstico.',
          linhasEsperadas: 1,
          linhasObtidas: 1,
        },
        tentativas: 1,
        resolvido: acertou,
      });
    }

    if (caminho.endsWith('/solucao')) {
      return resposta({ sqlReferencia: 'SELECT ... HAVING ...' });
    }

    if (caminho.includes('/scenarios/')) {
      return resposta(DETALHE);
    }

    return resposta({ error: 'Rota não encontrada' }, 404);
  });
}

describe('a interface do laboratório', () => {
  let raiz: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    window.localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    raiz = createRoot(container);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function montar(fetchSimulado: ReturnType<typeof apiSimulada>) {
    vi.stubGlobal('fetch', fetchSimulado);
    await act(async () => {
      raiz.render(<App />);
    });
    // deixa as promessas de carga resolverem
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it('mostra os dez cenários', async () => {
    await montar(apiSimulada());

    const cartoes = container.querySelectorAll('.cartao-cenario');
    expect(cartoes).toHaveLength(10);
    expect(container.textContent).toContain('Cliente que parou de comprar');
    expect(container.textContent).toContain('Quem concentra o faturamento');
  });

  it('mostra o sintoma e preenche o editor com o esqueleto do cenário', async () => {
    await montar(apiSimulada());

    expect(container.textContent).toContain('A cliente não compra há seis meses.');

    const editor = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(editor).toBeTruthy();
    expect(editor.value).toBe('SELECT nome FROM clientes');
  });

  it('executa a consulta e mostra o diagnóstico', async () => {
    const fetchSimulado = apiSimulada();
    await montar(fetchSimulado);

    const editor = container.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      setter?.call(
        editor,
        'SELECT cliente, total FROM vendas GROUP BY cliente HAVING total > 1000',
      );
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const botao = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Executar',
    );
    expect(botao).toBeTruthy();

    await act(async () => {
      botao?.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Diagnóstico correto');
    expect(container.textContent).toContain('Comércio Alfa');
    expect(container.textContent).toContain('1 linha(s)');
  });

  it('avisa que o cenário ainda não é o diagnóstico', async () => {
    const fetchSimulado = apiSimulada();
    await montar(fetchSimulado);

    const botao = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Executar',
    );

    await act(async () => {
      botao?.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Ainda não é o diagnóstico');
  });

  it('avisa que a API está acordando quando a primeira carga demora', async () => {
    // A API do plano gratuito hiberna. A primeira carga depois disso leva
    // cerca de um minuto, e "Carregando…" sozinho parece página quebrada.
    vi.useFakeTimers();
    try {
      const lenta = vi.fn(
        () =>
          new Promise(() => {
            // nunca resolve: é a partida a frio
          }),
      );
      vi.stubGlobal('fetch', lenta);

      await act(async () => {
        raiz.render(<App />);
      });

      expect(container.textContent).toContain('Carregando…');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(7000);
      });

      expect(container.textContent).toMatch(/Acordando a API/);
      expect(container.textContent).toMatch(/hiberna/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it('explica que a API está acordando quando ela não responde', async () => {
    // A interface repete a requisição três vezes, com espera entre as
    // tentativas. O relógio é controlado para não esperar de verdade.
    vi.useFakeTimers();
    try {
      const falha = vi.fn(async (_url: string, _init?: RequestInit) => {
        throw new TypeError('fetch failed');
      });
      vi.stubGlobal('fetch', falha);

      await act(async () => {
        raiz.render(<App />);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });

      // O texto final precisa explicar a hibernação, e não dizer apenas
      // "erro" — quem está aprendendo não pode confundir o laboratório com
      // uma falha.
      expect(container.textContent).toMatch(/hiberna|tente de novo|não respondeu/i);

      // Três tentativas para a lista de cenários. A interface também pede o
      // esquema ao abrir, e ele repete do mesmo jeito — mas a mensagem de
      // erro vem da lista.
      const chamadasDaLista = falha.mock.calls.filter((chamada) =>
        String(chamada[0]).endsWith('/scenarios'),
      );
      expect(chamadasDaLista).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
