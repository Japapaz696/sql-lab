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
sql_lab_admin  dono do schema. Usado só para preparar o banco.
sql_lab_exec   o papel que executa as consultas. Tem SELECT e nada mais:
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

| Controle                  | Valor        | Onde                                  |
| ------------------------- | ------------ | ------------------------------------- |
| Tempo por consulta        | 5 s (padrão) | `statement_timeout`                   |
| Tempo de transação ociosa | 5 s          | `idle_in_transaction_session_timeout` |
| Tempo de conexão          | 10 s         | pool do `pg`                          |
| Linhas por resultado      | 200          | cursor                                |
| Conexões simultâneas      | 10           | pool                                  |

O `EXPLAIN` também passa pelo cursor: ele mostra o plano sem executar a
consulta, e várias instruções juntas continuam sendo recusadas.

## O que NÃO está protegido

**Leitura não é restrita.** Quem usa a interface consegue ler qualquer linha do
banco. Isso é aceitável no laboratório, porque o banco é sintético e público —
mas é o limite a considerar antes de apontar esta aplicação para um banco real.

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

## Publicação

O laboratório **não deve ser publicado com um banco que contenha dados reais**.
A configuração de referência — API no Render, interface na Vercel, banco no
Neon — está em [INSTALACAO.md](INSTALACAO.md).

Antes de publicar para terceiros:

- use uma conta de demonstração, com senha conhecida só por quem apresenta;
- troque a senha ao final;
- o laboratório não tem provisionamento por convite: quem tiver a URL e a senha
  entra.

## Denúncias

O projeto é pessoal e está em fase de MVP. Problema de segurança encontrado
aqui pode ser reportado pela aba **Security** do próprio repositório.
