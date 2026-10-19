# Arquitetura

## Visão geral

```
Navegador (React + Vite)
   │  fetch('/api/v1/...')
   ▼
API (Express 5 + TypeScript)
   │  rota → serviço → repositório
   ▼
PostgreSQL 16
```

Três pacotes no monorepo:

| Pacote            | Papel                                           |
| ----------------- | ----------------------------------------------- |
| `@sql-lab/api`    | API REST, execução de SQL, cenários e progresso |
| `@sql-lab/web`    | interface React                                 |
| `@sql-lab/shared` | tipos e listas compartilhadas                   |

## O fluxo de um cenário

1. `GET /api/v1/scenarios` devolve a lista, com o estado de progresso da sessão.
2. `GET /api/v1/scenarios/:id` devolve o detalhe: sintoma, contexto, esqueleto
   inicial, dicas, erros comuns e índices.
3. `POST /api/v1/scenarios/:id/execute` recebe o SQL do aluno e:
   - roda a consulta do aluno;
   - roda a consulta de referência;
   - compara os dois conjuntos de linhas;
   - registra a tentativa no progresso;
   - devolve o resultado, a verificação e o número de tentativas.
4. `POST /api/v1/scenarios/:id/explain` devolve o `EXPLAIN` da consulta.
5. `GET /api/v1/scenarios/:id/solucao` devolve a referência, para quem pediu
   para ver.

## Execução segura de SQL

A consulta do aluno é código de terceiros. A proteção vem de três camadas:

**1. Transação somente leitura.** `withReadOnlyClient` abre `BEGIN READ ONLY`.
O PostgreSQL recusa `INSERT`, `UPDATE`, `DELETE` e `DROP` nessa transação — a
recusa vem do servidor, não da aplicação. A aplicação não precisa confiar no
texto da consulta.

**2. Tempo limite.** `statement_timeout` e `idle_in_transaction_session_timeout`
são configurados por sessão. Uma consulta pesada não segura a conexão.

**3. Limite de linhas.** O resultado é truncado em `MAX_RESULT_ROWS` (200 por
padrão) e a interface avisa que houve truncamento.

O que **não** é protegido, e vale registrar: o aluno consegue ler qualquer dado
do banco. Isso é aceitável porque o banco é sintético e público no laboratório —
mas significa que um banco real exigiria mais: usuário sem privilégio de
escrita, `REVOKE` de DDL e isolamento por esquema.

## Verificação de uma resposta

A verificação compara **conjuntos de linhas**, não o texto da consulta:

1. as duas listas são normalizadas — `numeric` chega como texto do PostgreSQL e
   vira número antes da comparação;
2. a ordem das linhas é ignorada: o que importa é quais linhas a consulta
   devolveu;
3. se a quantidade difere, o feedback diz quantas linhas vieram de cada lado;
4. se a quantidade bate mas o conteúdo não, o feedback diz que o conteúdo
   divergiu.

O efeito: qualquer consulta que responda à mesma pergunta conta como resolvida,
mesmo com outra sintaxe, outra ordem de colunas ou `NUMERIC` escrito como texto.

## Progresso

A tabela `progresso_cenarios` tem uma linha por sessão e cenário. A chave é o
identificador aleatório de 16 bytes gerado no navegador e guardado no
`localStorage`. Não há nome, e-mail nem documento — o laboratório não pede
identidade a ninguém, e o identificador não é derivado de nada que identifique
a pessoa.

O registro usa `ON CONFLICT ... DO UPDATE` com `COALESCE`, de modo que o
`resolvido_em` gravado uma vez não é sobrescrito por uma tentativa posterior.

## O banco

`db/schema.sql` define o modelo de um ERP de vendas e distribuição:

```
clientes ──┬── pedidos ──┬── itens_pedido ── produtos
           │              └── pagamentos
           ├── estoque ── produtos, depositos
           │   └── movimentacoes_estoque
           └── chamados ── pedidos
```

As constraints são as de um ERP real: `CHECK` de status e de meio de
pagamento, `UNIQUE` de código, `NOT NULL` em campos obrigatórios e chaves
estrangeiras com `ON UPDATE CASCADE`. As consultas aprendidas no laboratório
têm sentido porque a forma dos dados é a mesma.

Os índices não são acidentais: cada cenário aponta para o índice que a sua
consulta usa, e a interface mostra o `EXPLAIN` para o aluno ver.

`db/seed.sql` é a carga: SQL puro, com identificadores e datas literais. Por
isso a carga é determinística e o resultado de referência de cada cenário é
estável — que é o que permite testar as consultas contra um resultado fixo.

## A interface

- **Escolha do cenário** à esquerda, com a área e a técnica de cada um.
- **Editor** com o esqueleto inicial. O aluno edita livremente.
- **Resultado** em tabela, com a contagem de linhas e o tempo da consulta.
- **Plano de execução**, para ver o índice usado.
- **Dicas** reveladas uma a uma.
- **Aba "Entender"** com a explicação, os índices e os erros comuns.

O estado da sessão é o único dado guardado no navegador, e ele é um
identificador aleatório sem relação com a pessoa.

## Decisões que poderiam ser outras

| Decisão                | Alternativa               | Por que esta                                                                          |
| ---------------------- | ------------------------- | ------------------------------------------------------------------------------------- |
| Transação `READ ONLY`  | filtro de SQL no servidor | a proteção é do banco, e não depende de a API confiar na consulta                     |
| Comparar resultados    | comparar textos           | aceita consultas diferentes com a mesma resposta, que é o objetivo                    |
| Carga em SQL puro      | gerador em TypeScript     | determinística, revisável e serve de material de estudo                               |
| Sessão anônima         | login com e-mail          | o laboratório não precisa saber quem é o usuário                                      |
| Banco com um schema só | esquema por sessão        | o laboratório é de leitura; o isolamento viria de privilégio de banco, não de esquema |
