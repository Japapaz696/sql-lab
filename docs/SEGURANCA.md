# Segurança

O laboratório executa SQL escrito por quem usa a interface. Isso é o propósito
do projeto, e por isso a proteção foi pensada em três camadas — todas no
servidor, nenhuma dependendo de a aplicação "ser esperta".

## As três camadas

| #   | Camada                           | Onde                 | O que impede                                                                                                |
| --- | -------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | **Protocolo estendido** (cursor) | `database/pool.ts`   | Várias instruções na mesma consulta. `COMMIT; UPDATE ...` é recusado pelo PostgreSQL antes de ser executado |
| 2   | **Transação `READ ONLY`**        | `database/pool.ts`   | Qualquer escrita dentro da transação                                                                        |
| 3   | **Privilégio de banco**          | `db/privilegios.sql` | Qualquer escrita, mesmo fora de transação: o usuário de execução só tem `SELECT`                            |

Cada camada funciona sozinha. Se uma falhar, as outras seguram.

### Um bug real que a camada 1 revelou

A primeira versão usava o protocolo simples do driver, que aceita várias
instruções separadas por `;`. Nela, um `COMMIT` no meio da string **encerrava a
transação `READ ONLY`**, e a instrução seguinte rodava fora dela, em modo de
escrita. A consulta abaixo alterava a tabela de verdade:

```sql
COMMIT; UPDATE clientes SET nome = 'INVADIDO' WHERE codigo = 'CLI-0001'
```

O agravante: passar `values: []` **não** resolve, porque sem parâmetros o
driver continua usando o protocolo simples. A correção foi passar a usar um
cursor, que usa o protocolo estendido e aceita uma única instrução.

### Camada 3 — a separação de privilégios

```
<dono do schema>  dono do schema. Usado só para preparar o banco e para
                   gravar o progresso da aplicação.
sql_lab_exec       o papel que executa as consultas. Tem SELECT e nada mais:
                   sem INSERT, UPDATE, DELETE, TRUNCATE, CREATE, GRANT.
```

A conexão da aplicação é dividida em duas:

| Conexão      | Variável             | Para que serve                                                        |
| ------------ | -------------------- | --------------------------------------------------------------------- |
| de consulta  | `DATABASE_URL`       | o SQL de quem usa a interface, com `default_transaction_read_only=on` |
| da aplicação | `DATABASE_ADMIN_URL` | o progresso do aluno e a preparação do banco                          |

O SQL de quem usa o laboratório **nunca** passa pela conexão da aplicação. E a
conexão de consulta não grava nada — nem o progresso.

Se o usuário administrativo não puder criar papéis (em hospedagens
gerenciadas, onde o dono não é superusuário), o script avisa e segue: as camadas
1 e 2 continuam valendo.

### A camada 4 — a configuração errada não passa

As três camadas protegem contra **SQL malicioso**. A quarta protege contra
**configuração errada**: a variável trocada, o papel não criado, a string do
dono do schema colocada no lugar da do aluno.

Em produção, a API **não sobe** sem a separação de privilégios. A verificação
roda na partida, contra o próprio banco, e confere três coisas:

| O que é conferido                       | Como                                                                         |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| os dois usuários são diferentes         | comparando o usuário das duas URLs                                           |
| o usuário de execução não pode escrever | `has_table_privilege`, que já conta os privilégios herdados por _membership_ |
| o usuário de execução enxerga o banco   | uma contagem na tabela `clientes`                                            |

> **Por que não testar com um `UPDATE` de mentira:** dentro de uma transação
> somente leitura, o PostgreSQL acusa a transação **antes** de olhar o
> privilégio da tabela. O erro seria `cannot execute UPDATE in a read-only
transaction` nos dois casos — com e sem permissão — e a verificação não
> distinguiria nada. O catálogo não tem essa ambiguidade.

Em desenvolvimento, a mesma verificação roda, mas a ausência é um **aviso**: é
assim que o laboratório roda numa máquina com um usuário só.

### A senha do papel não está no repositório

O script `db/privilegios.sql` não tem senha nenhuma. O valor chega por
parâmetro, com `set_config`, e é aplicado com `format('%L')` — o que escapa a
string corretamente, sem concatenar nada no texto do SQL.

```sql
-- Em db/privilegios.sql: nenhuma senha literal.
senha text := current_setting('sql_lab.exec_password', true);
...
EXECUTE format('CREATE ROLE %I WITH LOGIN PASSWORD %L', papel, senha);
```

Se a senha não chegar, o script **falha** — em vez de criar o papel com um
valor previsível.

O CI confere, a cada execução, que nenhuma string de conexão com senha está
versionada no repositório.

### O `db:reset` não pode destruir um banco de verdade

A preparação recria o schema inteiro (`DROP SCHEMA public CASCADE`). O comando
recusa, antes de tocar em qualquer coisa, quando:

- a confirmação `SQL_LAB_CONFIRMAR_RESET=sim` não está presente;
- o nome do banco não é de laboratório (`sql_lab`, `sql_lab_test`, `sql_lab_demo`);
- a senha do papel de execução não está definida, é curta demais, ou é igual ao
  nome do papel.

### O CORS é restrito

A interface publicada fica em outro domínio que a API, então o navegador pede
autorização. `ALLOWED_ORIGIN` lista as origens liberadas — e só elas recebem o
cabeçalho de autorização. Uma origem que não está na lista não recebe nada, e
o navegador bloqueia a resposta.

### O progresso de uma sessão não é legível por outra

Cada navegador recebe um identificador aleatório de 16 bytes (`x-sessao-id`), e
as rotas de cenário exigem o cabeçalho: sem ele, a API responde 400 em vez de
cair num valor compartilhado. O progresso é gravado por sessão e cenário, e a
listagem só devolve as tentativas daquela sessão.

No banco, a tabela `progresso_cenarios` guarda todas as sessões, e o papel de
execução **não tem `SELECT` nela** (`db/privilegios.sql` e a migração
`db/migracoes/2026-10-22-isolar-progresso.sql`). Sem isso, o isolamento da API
seria só de fachada: qualquer pessoa poderia ler a tabela pela rota de consulta
livre. A tabela também não aparece em "Ver o esquema do ERP" — a lista de
tabelas é explícita em `apps/api/src/database/tabelas-do-erp.ts`.

O identificador não é autenticação: quem o tiver consegue ver o progresso
daquela sessão. Ele é aleatório e não guarda dados pessoais, então perdê-lo não
expõe identidade — apenas tentativas.

### Limite de chamadas

`/execute` e `/explain` têm limite por IP (padrão: 20 e 15 por minuto,
respectivamente). A resposta 429 é JSON, com `Retry-After` em segundos e os
cabeçalhos `RateLimit` e `RateLimit-Policy` (rascunho 7). A interface mostra o
tempo de espera em vez de HTML do proxy.

O limite é **por processo e em memória**: com duas instâncias da API, cada uma
conta separadamente. Para o laboratório, uma instância no plano gratuito é o
caso real; se um dia houver mais de uma, o armazenamento precisa ser
compartilhado (Redis ou a própria tabela).

### Fila e proteção do pool

Cada consulta passa por um semáforo (`MAX_CONCURRENT_QUERIES`, padrão 4). O
excedente espera na fila por até `QUEUE_WAIT_MS` (padrão 8 s); se não houver
vaga, a resposta é 503 com `Retry-After`, não um 500. Sem esse controle, um
pico esgotaria as cinco conexões do pool e derrubaria também o `/ready`.

> O valor conta consultas, não requisições: cada execução usa duas (aluno e
> referência). O mínimo útil é 2.

## O limite de linhas é real

A implementação anterior carregava o resultado inteiro na memória e só depois
aplicava o corte de 200 linhas. Uma consulta que devolvesse um milhão de linhas
traria todas elas para o processo.

Agora a leitura é feita em lotes, e para no limite:

|                   | Linhas entregues | Memória |
| ----------------- | ---------------- | ------- |
| Antes (buffering) | 50.006           | 6 MB    |
| Agora (cursor)    | 200              | 0 MB    |

A consulta é abandonada no servidor assim que o limite é atingido, e a interface
avisa que o resultado foi truncado.

## Tempo e recursos

| Controle                  | Valor                   | Onde                                  |
| ------------------------- | ----------------------- | ------------------------------------- |
| Tempo por consulta        | 5 s (padrão)            | `statement_timeout`                   |
| Tempo de transação ociosa | 5 s                     | `idle_in_transaction_session_timeout` |
| Tempo de conexão          | 30 s                    | pool do `pg`                          |
| Linhas por resultado      | 200                     | cursor                                |
| Conexões simultâneas      | 5 (+3 admin)            | pool                                  |
| Consultas simultâneas     | 4                       | semáforo (`MAX_CONCURRENT_QUERIES`)   |
| Espera na fila            | 8 s                     | `QUEUE_WAIT_MS`                       |
| Chamadas por IP           | 20 execute / 15 explain | `express-rate-limit`, janela de 60 s  |

O tempo de conexão é de 30 segundos porque o banco hiberna: num plano
gratuito, o primeiro acesso depois de um tempo sem tráfego passa por uma
partida a frio. Com 10 segundos, a API responderia "não consegui falar com o
banco" logo depois de acordar.

O `EXPLAIN` também passa pelo cursor: ele mostra o plano sem executar a
consulta, e várias instruções juntas continuam sendo recusadas.

## O que NÃO está protegido

**Leitura não é restrita.** Quem usa a interface consegue ler qualquer linha do
banco. Isso é aceitável no laboratório, porque o banco é sintético e público —
mas é o limite a considerar antes de apontar esta aplicação para um banco real.

**A sessão não é autenticada.** O identificador é aleatório e imprevisível, mas
não há login: quem tiver o valor vê o progresso daquela sessão. Como não há
dado pessoal, o impacto é limitado a tentativas.

**O limite de chamadas é por processo.** Duas instâncias da API contam
separadamente. Para o plano gratuito (uma instância), o limite vale integralmente.

Para um banco real, o que precisaria mudar:

1. um usuário do PostgreSQL sem privilégio de escrita e com `REVOKE` de DDL —
   o laboratório já faz isso, com `sql_lab_exec`;
2. isolamento por esquema ou por sessão, se os dados de um aluno não puderem
   ser vistos por outro;
3. `work_mem` limitado, para conter consumo por consulta;
4. limite de tempo por sessão, não só por consulta;
5. registro das consultas executadas, para o dono do banco saber o que rodou.

## Mensagens de erro

O erro do PostgreSQL é traduzido para algo que ajude quem está aprendendo:

| Erro do banco                                      | O que o aluno vê                                                                    |
| -------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `cannot insert multiple commands`                  | "Só é permitida uma instrução por consulta."                                        |
| `cannot execute UPDATE in a read-only transaction` | "Esta consulta tentaria escrever no banco. O laboratório é de leitura."             |
| `permission denied`                                | "O usuário de execução do laboratório só tem permissão de leitura."                 |
| `relation ... does not exist`                      | "Tabela ou visão inexistente. Confira o nome no esquema do ERP."                    |
| `column ... does not exist`                        | "Coluna inexistente. Confira o nome das colunas da tabela."                         |
| `syntax error`                                     | "Erro de sintaxe. Verifique as palavras-chave e a ordem das cláusulas."             |
| `statement timeout`                                | "A consulta passou do tempo limite. Tente reduzir o volume ou adicionar um filtro." |

## Privacidade dos dados

O laboratório **não pede identidade**. A sessão é um identificador aleatório
gerado no navegador, guardado no `localStorage`, e usado só para contar
tentativas por cenário. Não há nome, e-mail, telefone ou documento em nenhum
lugar do sistema.

A carga é inteiramente fictícia:

- e-mails no domínio `exemplo.invalid`, reservado pela RFC 2606;
- documentos na sequência `000.000.000-01` a `000.000.000-06`, o placeholder
  que o próprio CPF reserva para "não aplicável";
- nomes, cidades e telefones de empresas que não existem.

Um teste automatizado verifica a cada execução que nenhum e-mail de domínio
real está na tabela de clientes.

## Testes que cobrem a regressão

`apps/api/src/tests/seguranca.integration.test.ts` — 23 casos:

- sete variações de comando múltiplo (`COMMIT;`, `ROLLBACK;`, `BEGIN;`,
  `SET TRANSACTION READ WRITE;`, `COPY`, `DO $$`, `SELECT 1; SELECT 2`), cada um
  conferindo que o dado **não** foi alterado;
- sete formas de escrita isolada (`UPDATE`, `DELETE`, `DROP`, `INSERT`,
  `TRUNCATE`, `CREATE`, `GRANT`, `VACUUM`);
- o limite de linhas, com 1.200 e 20.000 linhas injetadas;
- o consumo de memória, conferindo que 20 mil linhas no banco não carregam o
  processo;
- o tempo limite;
- o `EXPLAIN`, conferindo que não executa a consulta que explica.

`apps/api/src/tests/privilegios.integration.test.ts` — a camada 3 e a 4:

- o usuário de execução **não tem** permissão de escrita, e o administrativo
  **tem** — os dois lados, para que o teste não seja vazio;
- a escrita é recusada por **privilégio** numa conexão crua, sem transação
  somente leitura: a terceira camada funcionando sozinha;
- a verificação de partida passa com a separação no lugar;
- a comparação de usuários detecta o mesmo usuário em ambas as conexões, e a
  ausência da conexão administrativa;
- a consulta do aluno **não depende** da conexão administrativa: com ela
  quebrada, a consulta continua rodando.

`apps/api/src/tests/preparacao.integration.test.ts` — as guardas do `db:reset`:
nome de banco, confirmação, senha presente, senha forte, senha diferente do
nome do papel. E que o script de privilégios não tem senha literal.

`apps/api/src/tests/sessoes.integration.test.ts` — o isolamento por sessão: as
três rotas de cenário respondem 400 sem `x-sessao-id`, duas sessões não
compartilham tentativas, e a mesma sessão continua de onde parou.

`apps/api/src/tests/concorrencia.test.ts` — a fila e o limite de chamadas: o
semáforo respeita o máximo, a espera estoura em `ErroDeSobrecarga` (503), e a
rota devolve 429 em JSON com `Retry-After` e os cabeçalhos `RateLimit` depois
do limite.

`apps/api/src/tests/infra.integration.test.ts` — a API na internet: health check
sem tocar o banco, readiness com o estado do banco, CORS liberando as origens
declaradas e recusando as outras, preflight, cabeçalhos do helmet e 400 para
corpo que não é JSON.

A interface tem testes próprios (`apps/web/src/services/api.test.ts`) para as
respostas que não vêm da API: 429 com `Retry-After`, HTML de WAF/proxy em 403,
200 em HTML e JSON inválido — nenhum deles pode virar HTML cru na tela.

O CI, além da suíte, confere que **a API montada sobe em produção** com as
duas conexões separadas — e que **recusa subir** quando elas não estão.

## Publicação

O laboratório **não deve ser publicado com um banco que contenha dados reais**.
A configuração de referência — API no Render, interface no GitHub Pages, banco
no Neon — está em [PUBLICACAO.md](PUBLICACAO.md), campo a campo.

Antes de publicar para terceiros:

- use uma conta de demonstração, com senha conhecida só por quem apresenta;
- troque a senha ao final;
- o laboratório não tem provisionamento por convite: quem tiver a URL e a senha
  entra.

## Denúncias

O projeto é pessoal e está em fase de MVP. Problema de segurança encontrado
aqui pode ser reportado pela aba **Security** do próprio repositório.
