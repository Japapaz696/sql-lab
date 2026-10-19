import type { Scenario } from './types.js';

/**
 * Os dez cenários do MVP.
 *
 * Todos speak de um ERP de vendas e distribuição: cliente, pedido, produto,
 * pagamento, estoque e chamado. As consultas são as que um suporte de ERP
 * realmente escreve no dia a dia — e as respostas dependem só dos dados
 * fictícios de `db/seed.sql`.
 *
 * A data de referência usada pelos cenários é 2026-07-01.
 */
export const cenarios: Scenario[] = [
  {
    id: 'cliente-que-parou-de-comprar',
    titulo: 'Cliente que parou de comprar',
    area: 'comercial',
    nivel: 'iniciante',
    sintoma:
      'A equipe comercial avisa que três clientes "sumiram" do relatório de compra recorrente. Eles compravam bem e de repente não compram mais.',
    contexto:
      'No ERP, o que separa "nunca comprou" de "comprou e parou" é o histórico de pedidos. O relatório de recorrência compara o último pedido do cliente com uma janela de 90 dias, contada a partir de 2026-07-01.',
    tecnica: 'JOIN com GROUP BY e HAVING sobre a data máxima',
    sqlInicial: `SELECT c.codigo, c.nome, MAX(p.emitido_em) AS ultimo_pedido
FROM clientes c
JOIN pedidos p ON p.cliente_id = c.id
WHERE c.ativo = TRUE
  AND p.emitido_em < DATE '2026-07-01' - INTERVAL '90 days'
GROUP BY c.id, c.codigo, c.nome
-- complete a consulta`,
    sqlReferencia: `SELECT c.codigo, c.nome, MAX(p.emitido_em) AS ultimo_pedido
FROM clientes c
JOIN pedidos p ON p.cliente_id = c.id
WHERE c.ativo = TRUE
GROUP BY c.id, c.codigo, c.nome
HAVING MAX(p.emitido_em) < DATE '2026-07-01' - INTERVAL '90 days'
ORDER BY ultimo_pedido`,
    explicacao:
      'O filtro de data fica no HAVING, não no WHERE: o WHERE filtra linhas antes de agrupar e o HAVING filtra grupos já formados. Aqui a condição precisa ser avaliada sobre MAX(p.emitido_em) — o máximo só existe depois do GROUP BY, então colocá-la no WHERE seria um erro de SQL. O JOIN interno já resolve o "nunca comprou": quem não tem pedido nenhum não aparece, porque o INNER JOIN descarta a linha do cliente. O índice idx_pedidos_cliente evita varrer todos os pedidos para cada cliente.',
    indices: ['idx_pedidos_cliente', 'idx_pedidos_emitido'],
    errosComuns: [
      'Colocar a condição de data no WHERE: ela tenta filtrar p.emitido_em linha a linha e devolve todos os clientes com algum pedido antigo.',
      'Usar LEFT JOIN e esquecer que o cliente sem pedido não tem MAX: o MAX fica NULL e a comparação com NULL devolve desconhecido, silenciosamente.',
      'Trazer o cliente inativo, que também está sem pedido recente, e confundir com o caso do portfólio.',
    ],
    dicas: [
      'Agrupe por cliente e calcule o máximo da data de emissão.',
      'A janela de 90 dias termina em 2026-07-01.',
      'Quem nunca comprou não tem linha de pedido: um JOIN interno já o exclui.',
    ],
  },
  {
    id: 'titulo-pago-a-mais',
    titulo: 'Título pago a mais que o pedido',
    area: 'faturamento',
    nivel: 'intermediario',
    sintoma:
      'O cliente recebeu duas cobranças do mesmo pedido e não sabe qual vale. O suporte precisa saber quanto foi cobrado a mais e por qual título.',
    contexto:
      'Um pedido pode ter vários títulos (parcelas, trocas, ajustes). O que caracteriza a cobrança a mais é a soma dos títulos pagos do pedido ultrapassar o total do pedido.',
    tecnica: 'JOIN com agregação e comparação entre agregados',
    sqlInicial: `SELECT p.numero, p.total AS total_pedido,
       SUM(pg.valor) AS total_pago
FROM pedidos p
JOIN pagamentos pg ON pg.pedido_id = p.id
WHERE pg.situacao = 'pago'
GROUP BY p.id, p.numero, p.total
-- complete a consulta`,
    sqlReferencia: `SELECT p.numero, p.total AS total_pedido,
       SUM(pg.valor) AS total_pago,
       SUM(pg.valor) - p.total AS cobrado_a_mais
FROM pedidos p
JOIN pagamentos pg ON pg.pedido_id = p.id
WHERE pg.situacao = 'pago'
GROUP BY p.id, p.numero, p.total
HAVING SUM(pg.valor) > p.total
ORDER BY cobrado_a_mais DESC`,
    explicacao:
      "A comparação final é entre dois valores agregados: o total do pedido (que é uma coluna) e a soma dos títulos pagos (que só existe após o GROUP BY). Por isso a condição vai no HAVING. Sem o filtro de situacao = 'pago', um título pendente ou estornado entraria na soma e mascararia a divergência. O índice idx_pagamentos_pedido e idx_pagamentos_situacao sustentam o JOIN e o filtro.",
    indices: ['idx_pagamentos_pedido', 'idx_pagamentos_situacao'],
    errosComuns: [
      'Somar todos os títulos, sem filtrar situacao: título estornado ou pendente entra na conta e a divergência some.',
      'Comparar linha a linha no WHERE em vez de comparar os totais no HAVING.',
      'Usar COUNT no lugar de SUM: conta os títulos, não o valor.',
    ],
    dicas: [
      'Filtre primeiro pelos títulos que realmente foram pagos.',
      'Agrupe por pedido.',
      'A diferença entre o pago e o total do pedido é o valor cobrado a mais.',
    ],
  },
  {
    id: 'estoque-availability-negativa',
    titulo: 'Produto com disponibilidade negativa',
    area: 'estoque',
    nivel: 'iniciante',
    sintoma:
      'O relatório de estoque mostra um produto com saldo zerado, mas o cliente recebeu o pedido. A equipe suspecta que houve reserva maior do que a quantidade disponível.',
    contexto:
      'No ERP, a quantidade física em estoque e a quantidade reservada para pedidos em aberto são campos diferentes. O que o time de vendas pode prometer é a disponibilidade: quantidade menos reservado.',
    tecnica: 'Aritmética entre colunas e filtro sobre o resultado da conta',
    sqlInicial: `SELECT pr.codigo, pr.nome, e.quantidade, e.reservado
FROM estoque e
JOIN produtos pr ON pr.id = e.produto_id
WHERE e.quantidade - e.reservado < 0
-- complete a consulta`,
    sqlReferencia: `SELECT pr.codigo, pr.nome, e.deposito_id,
       e.quantidade, e.reservado,
       e.quantidade - e.reservado AS disponivel
FROM estoque e
JOIN produtos pr ON pr.id = e.produto_id
WHERE e.quantidade - e.reservado < 0
ORDER BY disponivel`,
    explicacao:
      'A disponibilidade é a diferença entre duas colunas da mesma linha, então não há agregação nem JOIN com outra tabela para o filtro. O filtro pode ir direto no WHERE porque compara duas colunas da mesma linha. O JOIN com produtos existe só para trazer o nome legível: em um relatório de suporte, "PROD-004" sozinho não ajuda ninguém. O índice idx_estoque_produto cobre a busca pelo produto; a tabela estoque é pequena e o filtro percorre as linhas de qualquer forma.',
    indices: ['idx_estoque_produto'],
    errosComuns: [
      'Filtrar por e.quantidade = 0 em vez de quantidade - reservado: são coisas diferentes — estoque zerado não é o mesmo que estoque disponível zerado.',
      'Esquecer o JOIN com produtos e devolver UUID no relatório.',
      'Trazer só o primeiro depósito, esquecendo que a disponibilidade é por produto e por depósito.',
    ],
    dicas: [
      'A disponibilidade é quantidade menos reservado.',
      'Falta o nome do produto: um JOIN resolve.',
      'A disponibilidade é calculada por depósito.',
    ],
  },
  {
    id: 'pedido-entregue-sem-baixa',
    titulo: 'Pedido entregue sem baixa no estoque',
    area: 'logistica',
    nivel: 'avancado',
    sintoma:
      'O relatório de "pedidos entregues" não bate com o estoque: há produtos que saíram da loja, o pedido aparece como entregue e a movimentação de estoque sumiu.',
    contexto:
      'Cada saída de estoque tem uma movimentação com o pedido de origem. Quando o relatório cruza pedidos entregues com as movimentações, é comum esquecer de trazer o JOIN que dá nome à movimentação — e a contagem sai zerada, parecendo que nada foi movimentado.',
    tecnica: 'LEFT JOIN para não perder linhas e COUNT com FILTER',
    sqlInicial: `SELECT p.numero, p.emitido_em, p.entregue_em
FROM pedidos p
WHERE p.status = 'entregue'
  AND p.entregue_em IS NOT NULL
-- complete a consulta com a contagem de movimentacoes`,
    sqlReferencia: `SELECT p.numero, p.emitido_em, p.entregue_em,
       COUNT(m.id) FILTER (WHERE m.tipo = 'saida') AS saidas,
       COUNT(m.id) FILTER (WHERE m.tipo = 'reserva') AS reservas
FROM pedidos p
LEFT JOIN movimentacoes_estoque m ON m.pedido_id = p.id
WHERE p.status = 'entregue'
  AND p.entregue_em IS NOT NULL
GROUP BY p.id, p.numero, p.emitido_em, p.entregue_em
HAVING COUNT(m.id) FILTER (WHERE m.tipo = 'saida') = 0
ORDER BY p.emitido_em`,
    explicacao:
      'O LEFT JOIN é obrigatório aqui: com um JOIN interno, os pedidos sem movimentação desaparecem do resultado — e o diagnóstico some junto com o problema. O COUNT com FILTER conta só as linhas do tipo desejado sem precisar de dois subqueries. O HAVING filtra os grupos já contados. O índice idx_movimentacoes_produto ajuda a localizar as movimentações por produto, e o idx_pedidos_status atende o filtro inicial.',
    indices: ['idx_movimentacoes_produto', 'idx_pedidos_status'],
    errosComuns: [
      'Usar JOIN interno: o próprio problema some da consulta, e a lista sai vazia.',
      'Contar movimentações sem filtrar o tipo: entra entrada, reserva e ajuste, e o número não diz nada.',
      'Colocar a condição de "sem movimentação" no WHERE em vez do HAVING.',
    ],
    dicas: [
      'O problema some da consulta se você usar JOIN interno. Qual JOIN preserva as linhas sem movimentação?',
      'Você quer contar só as saídas, mas a tabela tem vários tipos de movimentação.',
      'A contagem é um agregado: a condição que olha a contagem vai no HAVING.',
    ],
  },
  {
    id: 'total-pedido-divergente',
    titulo: 'Total do pedido diferente da soma dos itens',
    area: 'faturamento',
    nivel: 'intermediario',
    sintoma:
      'A contabilidade pediu a conferência de um pedido específico porque o valor do pedido não bate com os itens lançados. A diferença precisa ser encontrada.',
    contexto:
      'No ERP, o total do pedido é gravado no momento do fechamento, e os itens podem ter sido alterados depois. A conferência é uma soma dos itens comparada com o total gravado.',
    tecnica: 'Agregação na subquery e comparação entre a soma e o total',
    sqlInicial: `SELECT p.numero, p.total,
       SUM(i.quantidade * i.preco_unitario - i.desconto_item) AS soma_itens
FROM pedidos p
JOIN itens_pedido i ON i.pedido_id = p.id
GROUP BY p.id, p.numero, p.total
-- complete a consulta`,
    sqlReferencia: `SELECT p.numero, p.total,
       SUM(i.quantidade * i.preco_unitario - i.desconto_item) AS soma_itens,
       p.total - SUM(i.quantidade * i.preco_unitario - i.desconto_item) AS diferenca
FROM pedidos p
JOIN itens_pedido i ON i.pedido_id = p.id
GROUP BY p.id, p.numero, p.total
HAVING SUM(i.quantidade * i.preco_unitario - i.desconto_item) <> p.total
ORDER BY diferenca DESC`,
    explicacao:
      'A diferença entre dois agregados só pode ser calculada depois do GROUP BY, então a expressão da diferença vive no SELECT e a condição de divergência no HAVING. O item tem quantidade, preço e desconto: a fórmula precisa ser quantidade vezes preço menos o desconto do item. O idx_itens_pedido sustenta o JOIN entre pedido e itens.',
    indices: ['idx_itens_pedido'],
    errosComuns: [
      'Somar apenas quantidade * preco, esquecendo o desconto do item.',
      'Colocar a diferença no WHERE: ela ainda não existe antes do agrupamento.',
      'Usar <> e esquecer que NULL <> valor é desconhecido — nesse banco não há NULL nessa conta, mas em outros sim.',
    ],
    dicas: [
      'O valor de um item é quantidade vezes preço, menos o desconto do próprio item.',
      'A soma dos itens é um agregado: a comparação com o total do pedido vai no HAVING.',
    ],
  },
  {
    id: 'limite-credito-estourado',
    titulo: 'Cliente acima do limite de crédito',
    area: 'comercial',
    nivel: 'intermediario',
    sintoma:
      'O controle de crédito liberou uma venda que não devia. O suporte precisa saber quais clientes têm valor pedido acima do limite e em quanto.',
    contexto:
      'O limite de crédito é uma coluna do cliente. O valor considered é a soma dos pedidos que não foram cancelados. Clientes sem pedido nenhum não estouram limite.',
    tecnica: 'LEFT JOIN com COALESCE e HAVING sobre o agregado',
    sqlInicial: `SELECT c.codigo, c.nome, c.limite_credito
FROM clientes c
JOIN pedidos p ON p.cliente_id = c.id
WHERE c.ativo = TRUE
GROUP BY c.id, c.codigo, c.nome, c.limite_credito
-- complete a consulta`,
    sqlReferencia: `SELECT c.codigo, c.nome, c.limite_credito,
       COALESCE(SUM(p.total) FILTER (WHERE p.status <> 'cancelado'), 0) AS valor_pedido
FROM clientes c
LEFT JOIN pedidos p ON p.cliente_id = c.id
WHERE c.ativo = TRUE
GROUP BY c.id, c.codigo, c.nome, c.limite_credito
HAVING COALESCE(SUM(p.total) FILTER (WHERE p.status <> 'cancelado'), 0) > c.limite_credito
ORDER BY valor_pedido DESC`,
    explicacao:
      'O LEFT JOIN garante que um cliente sem pedidos apareça com valor zero, e o COALESCE evita que o NULL devolvido pelo SUM seja comparado com o limite — a comparação com NULL é desconhecida e a linha seria descartada em silêncio. O FILTER dentro do SUM exclui os pedidos cancelados sem precisar de um WHERE, que mudaria a contagem de linhas. O idx_pedidos_cliente sustenta o JOIN.',
    indices: ['idx_pedidos_cliente', 'idx_clientes_canal'],
    errosComuns: [
      'Usar JOIN interno e perder os clientes sem pedido: o problema some em silêncio.',
      'Não usar COALESCE: SUM devolve NULL e a comparação devolve desconhecido.',
      'Somar pedidos cancelados como se fossem venda.',
    ],
    dicas: [
      'Cliente sem pedido tem SUM igual a NULL. O que você quer nesse caso?',
      'Pedido cancelado não conta como venda.',
      'A comparação final fica no HAVING.',
    ],
  },
  {
    id: 'produto-sem-movimentacao',
    titulo: 'Produto ativo que nunca se movimentou',
    area: 'estoque',
    nivel: 'intermediario',
    sintoma:
      'A equipe comercial pede para desativar produtos que "nunca venderam", mas o cadastro está inconsistente: alguns produtos aparecem como tendo movimento quando não têm.',
    contexto:
      'Todo movimento de estoque tem tipo (entrada, saída, reserva, liberação, ajuste). A pergunta "esse produto já se movimentou?" responde sobre qualquer movimentação, não só sobre venda: um produto que só recebeu entrada de mercadoria já se movimentou.',
    tecnica: 'NOT EXISTS para responder "não existe" sem duplicar linhas',
    sqlInicial: `SELECT pr.codigo, pr.nome
FROM produtos pr
WHERE pr.ativo = TRUE
-- complete a consulta: produtos sem NENHUMA movimentacao de estoque`,
    sqlReferencia: `SELECT pr.codigo, pr.nome, pr.categoria
FROM produtos pr
WHERE pr.ativo = TRUE
  AND NOT EXISTS (
    SELECT 1
    FROM movimentacoes_estoque m
    WHERE m.produto_id = pr.id
  )
ORDER BY pr.codigo`,
    explicacao:
      'NOT EXISTS responde "não existe nenhuma linha que satisfaz isto" e não duplica a linha do produto, ao contrário de um LEFT JOIN com filtro no WHERE (que exigiria um IS NULL sobre a coluna da outra tabela). O detalhe que costuma errar aqui é o filtro por tipo dentro do subquery: se você acrescentar m.tipo = \'saida\', passa a responder "nunca vendeu" em vez de "nunca se movimentou" — e o resultado muda de 2 para 7 linhas, porque quase todo produto do catálogo teve entrada de mercadoria. O idx_movimentacoes_produto atende a busca por produto dentro do subquery.',
    indices: ['idx_movimentacoes_produto'],
    errosComuns: [
      'Filtrar o tipo dentro do subquery: a resposta passa a ser "nunca vendeu", que é outra pergunta.',
      'Usar LEFT JOIN com filtro no WHERE: as linhas com movimentação somem do resultado em vez de retornarem.',
      'Incluir produtos inativos na resposta.',
    ],
    dicas: [
      'O que você quer: produtos que NÃO têm movimentação. Qual construção expressa isso sem duplicar linhas?',
      'Uma entrada de mercadoria já conta como movimentação.',
    ],
  },
  {
    id: 'chamado-de-cobranca-ja-pago',
    titulo: 'Chamado de cobrança de pedido já pago',
    area: 'faturamento',
    nivel: 'avancado',
    sintoma:
      'A fila de suporte tem chamados abertos pedindo cobrança de pedidos que já foram pagos. O time quer a lista para encerrá-los de uma vez.',
    contexto:
      'Um chamado de faturamento referencia cliente e, às vezes, pedido. Um pedido pode ter títulos pagos e títulos pendentes ao mesmo tempo. O chamado só faz sentido se ainda houver valor em aberto.',
    tecnica: 'EXISTS com uma condição de agregação aninhada',
    sqlInicial: `SELECT ch.numero, ch.titulo, p.numero AS pedido
FROM chamados ch
JOIN pedidos p ON p.id = ch.pedido_id
WHERE ch.categoria = 'faturamento'
  AND ch.status <> 'resolvido'
-- complete a consulta: chamados cujo pedido NAO tem titulo em aberto`,
    sqlReferencia: `SELECT ch.numero, ch.titulo, p.numero AS pedido, c.nome AS cliente
FROM chamados ch
JOIN pedidos p ON p.id = ch.pedido_id
JOIN clientes c ON c.id = p.cliente_id
WHERE ch.categoria = 'faturamento'
  AND ch.status <> 'resolvido'
  AND NOT EXISTS (
    SELECT 1
    FROM pagamentos pg
    WHERE pg.pedido_id = p.id
      AND pg.situacao IN ('pendente', 'vencido')
  )
ORDER BY ch.aberto_em`,
    explicacao:
      'A condição "não tem título em aberto" é um NOT EXISTS cujo subquery traz um filtro de situação: o que interessa é o título que ainda não foi quitado, não o total de títulos. Filtrar o status do chamado antes importa: um chamado já resolvido não entra na fila de trabalho, mesmo que o pedido continue com valor em aberto — o sintoma e o estado do chamado são coisas diferentes.',
    indices: ['idx_chamados_status', 'idx_chamados_pedido', 'idx_pagamentos_pedido'],
    errosComuns: [
      'Buscar o pedido inteiro em vez do título em aberto: o pedido existe, mas o valor já foi quitado.',
      'Esquecer o filtro de status do chamado e devolver chamados já resolvidos.',
      'Usar NOT IN com uma subquery que pode devolver NULL: o resultado fica vazio sem aviso.',
    ],
    dicas: [
      'O pedido não está errado: ele tem títulos pagos e outros que continuam em aberto.',
      'O que precisa existir para o chamado fazer sentido?',
    ],
  },
  {
    id: 'titulo-vencido',
    titulo: 'Título vencido que ninguém cobrou',
    area: 'faturamento',
    nivel: 'iniciante',
    sintoma:
      'O relatório de inadimplência não lista um título que passou do vencimento. O financeiro pergunta por que ele não apareceu.',
    contexto:
      'No ERP, a situação do título é calculada: um título pendente com vencimento passado é vencido. Nem todo título vencido está marcado como tal no cadastro, e é por isso que o relatório não bate.',
    tecnica: 'Filtro de intervalo de datas sobre uma coluna de data',
    sqlInicial: `SELECT pg.numero_titulo, pg.valor, pg.vencimento, pg.situacao
FROM pagamentos pg
WHERE pg.situacao = 'pendente'
-- complete a consulta: apenas os titulos ja vencidos`,
    sqlReferencia: `SELECT pg.numero_titulo, pg.valor, pg.vencimento, pg.situacao,
       pg.vencimento - DATE '2026-07-01' AS dias_atraso
FROM pagamentos pg
WHERE pg.situacao = 'pendente'
  AND pg.vencimento < DATE '2026-07-01'
ORDER BY pg.vencimento`,
    explicacao:
      'A situação "vencido" é derivada do vencimento comparado com a data de referência, não de uma coluna. Filtrar por pg.situacao = \'vencido\' perderia justamente o título que ninguém atualizou — que é o problema relatado. A comparação de uma data com uma data literal é direta e usa o índice idx_pagamentos_vencimento.',
    indices: ['idx_pagamentos_vencimento', 'idx_pagamentos_situacao'],
    errosComuns: [
      "Filtrar por situacao = 'vencido': o título do problema está marcado como pendente.",
      'Usar a data de hoje em vez da data de referência: o resultado muda conforme o dia em que se roda.',
      'Esquecer o filtro de situacao: entra também título já pago com vencimento antigo.',
    ],
    dicas: [
      'O que está no cadastro do título não é a verdade: ele é que não foi atualizado.',
      'A data de referência do laboratório é 2026-07-01.',
    ],
  },
  {
    id: 'concentracao-faturamento',
    titulo: 'Quem concentra o faturamento',
    area: 'relatorio',
    nivel: 'avancado',
    sintoma:
      'A diretoria quer saber quanto do faturamento depende de poucos clientes, para priorizar o relacionamento comercial. O relatório precisa mostrar o quanto cada um representa do total — e não só o total.',
    contexto:
      'O faturamento de cada cliente é a soma dos pedidos entregues. Para saber o quanto cada cliente representa do total, e quem carrega o faturamento, o cálculo precisa de uma soma acumulada — e isso é o que a função de janela faz.',
    tecnica: 'Soma acumulada com SUM() OVER e percentual sobre o total geral',
    sqlInicial: `SELECT c.codigo, c.nome, SUM(p.total) AS faturamento
FROM pedidos p
JOIN clientes c ON c.id = p.cliente_id
WHERE p.status = 'entregue'
GROUP BY c.id, c.codigo, c.nome
ORDER BY faturamento DESC
-- complete a consulta com o percentual acumulado`,
    sqlReferencia: `SELECT codigo, nome, faturamento,
       ROUND(100.0 * faturamento / SUM(faturamento) OVER (), 1) AS percentual,
       ROUND(100.0 * SUM(faturamento) OVER (ORDER BY faturamento DESC) / SUM(faturamento) OVER (), 1) AS acumulado
FROM (
  SELECT c.codigo, c.nome, SUM(p.total) AS faturamento
  FROM pedidos p
  JOIN clientes c ON c.id = p.cliente_id
  WHERE p.status = 'entregue'
  GROUP BY c.id, c.codigo, c.nome
) t
ORDER BY faturamento DESC`,
    explicacao:
      'A janela entra depois do agrupamento: primeiro se calcula o faturamento de cada cliente com GROUP BY, e só então a soma acumulada é calculada sobre esse resultado — daí a subquery. SUM(faturamento) OVER () sem PARTITION BY dá o total geral, que vira o denominador do percentual. ORDER BY faturamento DESC dentro do OVER define a ordem do acumulado. Lendo o resultado: o primeiro cliente responde por 63,4% do faturamento e os dois primeiros juntos chegam a 86,6% — é a leitura de Pareto que a diretoria queria. O total geral também poderia vir de uma CTE; a subquery foi escolhida porque o leitor está vendo o mesmo padrão em todo o laboratório.',
    indices: ['idx_pedidos_status', 'idx_pedidos_cliente'],
    errosComuns: [
      'Tentar usar a função de janela direto sobre a tabela de pedidos, sem o GROUP BY: a janela passaria a correr por linha de item.',
      'Colocar o OVER (ORDER BY) em uma coluna que não é a do ranking: o acumulado sai fora de ordem.',
      "Esquecer o filtro de status = 'entregue' e somar pedidos que ainda não foram faturados.",
    ],
    dicas: [
      'Primeiro calcule o faturamento por cliente. Depois calcule o acumulado sobre esse resultado.',
      'O total geral é a soma de todos os faturamentos: é uma janela sem PARTITION BY.',
      'A ordem do acumulado é a ordem do ranking: ela vai dentro do OVER.',
    ],
  },
];

export function buscarCenario(id: string): Scenario | undefined {
  return cenarios.find((cenario) => cenario.id === id);
}
