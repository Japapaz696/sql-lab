# Plano de publicação — SQL Lab

O laboratório é um sistema de três partes. Esta é a configuração recomendada
para **publicar a demonstração sem gastar nada**, baseada nas documentação
atual (outubro de 2026) de cada fornecedor.

## Resumo da recomendação

| Parte                       | Onde                                   | Custo | Observação                                                         |
| --------------------------- | -------------------------------------- | ----- | ------------------------------------------------------------------ |
| Frontend (React + Vite)     | **GitHub Pages** (ou Cloudflare Pages) | US$ 0 | Estático. Com `VITE_API_URL` apontando para a API                  |
| Backend (Node.js + Express) | **Render** — plano Hobby               | US$ 0 | Hiberna após 15 min sem tráfego; leva ~1 min para acordar          |
| Banco (PostgreSQL)          | **Neon** — plano Free                  | US$ 0 | Permanente, 100 projetos, 1 GB por projeto, escala a zero em 5 min |

**Total: US$ 0.** Nenhum cartão de crédito é pedido por nenhum dos três.

O repositório já traz a configuração pronta:

| Arquivo                       | Para que serve                                     |
| ----------------------------- | -------------------------------------------------- |
| `render.yaml`                 | a configuração do serviço no Render, campo a campo |
| `.github/workflows/pages.yml` | a publicação da interface no GitHub Pages          |
| `docs/PUBLICACAO.md`          | este guia                                          |

### Por que GitHub Pages e o caminho mais curto

O repositório já está no GitHub, e o GitHub Pages seria o caminho mais óbvio.
Duas restrições:

1. o GitHub Pages só serve repositórios **públicos** — o SQL Lab é público,
   então isso não é bloqueio;
2. o problema real é o **proxy da API**: a interface chama `/api/v1`, e no
   GitHub Pages não há servidor para encaminhar isso. A solução seria configurar
   `VITE_API_URL` com a URL da API e cambiar para chamadas com origem
   cruzada — o que exige CORS liberado na API.

O Cloudflare Pages tem a mesma limitação de hospedagem estática, então a escolha
entre os dois se resume ao que já está em uso. **Minha recomendação: GitHub
Pages**, porque o repositório já está lá, o build é o mesmo, e o
`VITE_API_URL` resolve o resto. Cloudflare Pages fica como alternativa se
preferir um CDN global sem limite de banda.

### Por que o Render para a API

- aceita Node.js sem configuração;
- **750 horas de instância gratuitas por mês** no plano Hobby, sem cartão;
- HTTPS automático;
- deploy direto do repositório.

A desvantagem é real e precisa ser dita: **o serviço hiberna após 15 minutos
sem tráfego** e leva cerca de um minuto para acordar. Para uma demonstração
vista por um recrutador, isso pode significar esperar um minuto na primeira
clique.

A interface já trata isso: a camada de API repete a requisição até três
vezes, com espera entre as tentativas, e a mensagem final explica que a API
está hibernando. O teste correspondente está em
`apps/web/src/services/api.test.ts`.

O banco hiberna também: o Neon reduz a zero depois de alguns minutos sem
tráfego, e a primeira conexão leva alguns segundos. Por isso o pool da API
espera 30 segundos para abrir uma conexão, e não 10.

Se o tempo de espera for um problema, há duas saídas, ambas fora do escopo
gratuito:

| Alternativa                                       | Custo     | Efeito                                                                             |
| ------------------------------------------------- | --------- | ---------------------------------------------------------------------------------- |
| Manter a API acordada com um pinger a cada 14 min | US$ 0     | a API nunca hiberna; é uso do plano fora do espírito, mas é comum em demonstrações |
| Assinar o plano Starter do Render                 | US$ 7/mês | serviço sempre ligado, sem hibernação                                              |

Nenhuma das duas é necessária para o laboratório funcionar.

---

## Passo 1 — O banco no Neon

O projeto do Neon precisa ter **dois pontos de acesso** à mesma conta, e o
laboratório usa os dois:

| Variável             | Ponto de acesso | Papel                                                   | Quem usa                                                |
| -------------------- | --------------- | ------------------------------------------------------- | ------------------------------------------------------- |
| `DATABASE_URL`       | **pooled**      | o usuário **sem** permissão de escrita (`sql_lab_exec`) | a aplicação, para as consultas                          |
| `DATABASE_ADMIN_URL` | **direct**      | o usuário dono do schema                                | a aplicação, para gravar o progresso e preparar o banco |

**Por que pooled na execução e direct na preparação:** o pooler do Neon
(`ep-...-pooler...`) entrega as conexões de forma diferente — cada transação
pode ir para um servidor diferente. Isso é ótimo para a API, que faz muitas
consultas curtas, e ruim para a preparação, que cria papéis e altera o schema.
Por isso a preparação usa a conexão direta.

> A string do painel do Neon é do dono do schema. O usuário de execução
> (`sql_lab_exec`) **não existe ainda**: ele é criado no passo 2.

## Passo 2 — Preparar o banco

### 2.1 Definir as duas conexões, localmente

Na pasta do repositório, num `.env` **local** (que nunca é versionado):

```bash
# Conexão direta do dono do schema, com o banco sql_lab_demo.
DATABASE_ADMIN_URL=postgresql://USUARIO:SENHA@ep-xxx.regiao.aws.neon.tech/sql_lab_demo?sslmode=require

# A senha do papel de execução: forte, 16 caracteres ou mais, e diferente do
# nome do papel.
SQL_LAB_EXEC_PASSWORD=uma-senha-forte-de-16-ou-mais

# Confirmação exigida pelo comando, porque a preparação recria o schema.
SQL_LAB_CONFIRMAR_RESET=sim
```

> A senha do papel de execução é escolhida **aqui**, pelo responsável pela
> publicação. Ela não está no repositório, nem em nenhum arquivo do projeto.
> Depois de criar o papel, ela vai para a `DATABASE_URL` do Render — e para
> mais lugar nenhum.

### 2.2 Rodar a preparação

```bash
npm install
npm run db:reset
```

O que o comando faz, nesta ordem:

1. confere que o banco se chama `sql_lab`, `sql_lab_test` ou `sql_lab_demo`, e
   que a confirmação está presente — **recusando** caso contrário;
2. recria o esquema (`db/schema.sql`) e a carga fictícia (`db/seed.sql`);
3. cria o papel `sql_lab_exec` com a senha informada, **por parâmetro**, sem
   senha fixa em nenhum arquivo do repositório;
4. dá a ele `SELECT` nas tabelas e **nada mais** — nem `INSERT`, `UPDATE`,
   `DELETE`, `TRUNCATE`, nem `CREATE` no schema.

Saída esperada:

```
Banco preparado: sql_lab_demo
Pronto: {"clientes":6,"produtos":8,"pedidos":9,...}
Papel de execução: SELECT (e nada mais)
```

### 2.3 Descobrir a senha do papel de execução para a `DATABASE_URL`

O papel `sql_lab_exec` é criado com a senha que **você** escolheu no passo
2.1 — a mesma que está em `SQL_LAB_EXEC_PASSWORD`. A `DATABASE_URL` do Render
é essa string, com o usuário trocado:

```
postgresql://sql_lab_exec:SUA_SENHA@ep-xxx-pooler.regiao.aws.neon.tech/sql_lab_demo?sslmode=require
```

Se a senha tiver caractere especial (`@`, `:`, `/`, `#`), ela precisa estar
codificada em URL — o jeito mais simples é escolher uma senha só com letras,
números, `-` e `_`.

### 2.4 Conferir, na mão, que a separação está de pé

```bash
# 1. o papel de execução não escreve:
psql "$DATABASE_URL" -c "UPDATE clientes SET nome='X' WHERE codigo='CLI-0001'"
# esperado: ERROR: permission denied for table clientes

# 2. o dono do schema escreve:
psql "$DATABASE_ADMIN_URL" -c "SELECT count(*) FROM clientes"
# esperado: 6
```

## Passo 2.5 — Banco que já está no ar: fechar o progresso das sessões

Se o banco já foi preparado antes desta versão, ele ainda tem uma brecha: o
papel de execução consegue ler `progresso_cenarios`, a tabela interna que
guarda as tentativas de **todas** as sessões. O isolamento por sessão na API
não protege o dado no banco — quem descobrisse a sessão de outra pessoa
poderia lê-la pela rota de consulta livre.

`db/privilegios.sql` já nasceu corrigido para bancos novos. Para um banco que
já está no ar, a migração é separada e **idempotente**:

```bash
psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 \
  -f db/migracoes/2026-10-22-isolar-progresso.sql
```

Ela roda com o **dono do schema** (nunca com `sql_lab_exec`) e faz três coisas:

1. revoga a concessão padrão de `SELECT` para tabelas futuras;
2. revoga todo acesso a `public.progresso_cenarios`;
3. reafirma `SELECT` apenas nas nove tabelas do ERP.

Pode ser executada mais de uma vez sem efeito colateral. A API não precisa ser
reiniciada: o PostgreSQL aplica os privilégios na hora.

### Conferir o resultado

```bash
# deve devolver false
psql "$DATABASE_ADMIN_URL" -c \
  "SELECT has_table_privilege('sql_lab_exec', 'public.progresso_cenarios', 'SELECT') AS pode_ler_progresso;"

# deve devolver nove linhas, todas com pode_ler = true
psql "$DATABASE_ADMIN_URL" -c \
  "SELECT tablename, has_table_privilege('sql_lab_exec', format('public.%I', tablename), 'SELECT') AS pode_ler
     FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> 'progresso_cenarios'
    ORDER BY tablename;"
```

E, como o papel de execução:

```bash
psql "$DATABASE_URL" -c "SELECT count(*) FROM progresso_cenarios;"
# esperado: ERROR: permission denied for table progresso_cenarios
```

A API também deixa de listar a tabela no esquema do ERP — a lista de tabelas é
explícita em `apps/api/src/database/tabelas-do-erp.ts`.

### Reversão mínima

A migração não altera dados: desfazer é só voltar o privilégio. Se — e somente
se — a API antiga realmente precisar ler `progresso_cenarios` pelo papel de
execução, restaure **apenas essa tabela**:

```sql
GRANT SELECT ON TABLE public.progresso_cenarios TO sql_lab_exec;
```

Não restaure `ALTER DEFAULT PRIVILEGES ... GRANT SELECT ON TABLES`: isso
reabriria a leitura de qualquer tabela futura e não é necessário para a
compatibilidade. A API grava e lê o progresso pela conexão administrativa
(`DATABASE_ADMIN_URL`), não pelo papel de execução. Prefira corrigir a causa em
vez de reverter.

### Runbook da migração em produção (somente com autorização)

> Esta seção é um roteiro para quando houver autorização específica. Nada aqui
> foi executado em produção. Não faça testes de carga contra a API pública.

**Ordem recomendada:** publicar a API nova, migrar o banco e só então publicar a
interface. A migração é apenas de privilégios — não altera dados — e a API
antiga continua compatível (ver abaixo), então qualquer ordem funciona; a ordem
acima reduz a janela em que o banco ainda permite ler o progresso alheio.

#### 0. Pré-checagens

1. Confirme que a conexão administrativa é a do SQL Lab e não a de outro
   aplicativo:

   ```bash
   psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -c \
     "SELECT current_database(), current_user, inet_server_addr();"
   psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 -c \
     "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1;"
   ```

   O banco deve conter as dez tabelas do laboratório: as nove do ERP
   (`chamados`, `clientes`, `depositos`, `estoque`, `itens_pedido`,
   `movimentacoes_estoque`, `pagamentos`, `pedidos`, `produtos`) e
   `progresso_cenarios`. Se houver tabelas de outro sistema, **pare**: a conexão
   não é a do SQL Lab.

2. Registre os privilégios atuais:

   ```bash
   psql "$DATABASE_ADMIN_URL" -c \
     "SELECT table_name, privilege_type
        FROM information_schema.role_table_grants
       WHERE grantee = 'sql_lab_exec' AND table_schema = 'public'
       ORDER BY table_name, privilege_type;"
   ```

   Antes da migração, o esperado é `SELECT` nas dez tabelas, incluindo
   `progresso_cenarios`.

3. Confirme que a API antiga usa a conexão administrativa para o progresso:
   no commit anterior (`84fb57e`), `progress.service.ts` chama
   `poolDeEscrita()`, que devolve `poolAdmin` quando `DATABASE_ADMIN_URL` existe.
   No painel do Render, confirme que a variável **existe** (sem copiar o valor).
   As linhas de progresso já gravadas em produção são evidência de que ela está
   configurada.

#### 1. Ponto de recuperação no Neon

No console do Neon, no projeto do SQL Lab:

1. **Branches → Create branch**;
2. nome `backup-pre-p0-2026-10-22`;
3. pai: a branch de produção (`main`/`primary`);
4. ponto: o instante atual.

A branch é copy-on-write: não copia os dados e não interrompe a produção. Antes
de migrar, conecte na branch nova e confira que ela responde e tem os mesmos
números da produção:

```bash
psql "$NEON_BRANCH_URL" -c \
  "SELECT (SELECT count(*) FROM clientes) AS clientes,
          (SELECT count(*) FROM progresso_cenarios) AS progresso,
          (SELECT count(*) FROM pg_tables WHERE schemaname = 'public') AS tabelas;"
```

Se o plano tiver PITR, anote também `SELECT now(), pg_current_wal_lsn();`. A
janela de restauração depende do plano; confirme no painel. Para reverter, crie
uma branch a partir do ponto salvo ou use o histórico da branch — não é preciso
restaurar por cima da produção.

#### 2. Publicar a API

1. No Render, **sql-lab-api → Manual Deploy → Deploy latest commit** (depois do
   merge) ou o commit específico revisado.
2. Acompanhe o build e o log de partida. A API só sobe se a separação de
   privilégios estiver de pé; o log mostra as linhas `[privilegios]`.
3. Confira `GET /health` (200) e `GET /ready` (200 com `banco: ok`).
4. Não rode teste de sobrecarga. As verificações de 429/503 já foram feitas no
   ambiente isolado.

> O serviço está com `autoDeploy` desabilitado no painel. O `render.yaml`
> histórico ainda declara `autoDeploy: true`; não sincronize o Blueprint sem
> antes alinhar esse campo, para não ligar o deploy automático por engano.

#### 3. Migrar o banco

```bash
psql "$DATABASE_ADMIN_URL" -v ON_ERROR_STOP=1 \
  -f db/migracoes/2026-10-22-isolar-progresso.sql
```

Confira o resultado com as consultas da seção anterior e, como papel de
execução:

```bash
psql "$DATABASE_URL" -c "SELECT count(*) FROM progresso_cenarios;"
# esperado: ERROR: permission denied for table progresso_cenarios
```

A rota `GET /api/v1/scenarios/esquema/tabelas` deve devolver nove tabelas. Uma
execução de cenário com sessão deve continuar gravando o progresso (pela conexão
administrativa).

#### 4. Publicar a interface

Só depois de a API protegida estar validada em produção. Rode o workflow manual
`pages.yml` com `api_url=https://sql-lab-api-7bdv.onrender.com` e
`base_path=/sql-lab/`, e confira a origens no CORS: `ALLOWED_ORIGIN` precisa
conter `https://japapaz696.github.io` (sem o caminho `/sql-lab/`).

#### 5. Rollback

- **API:** Render → **Deploys** → deployment anterior que estava no ar →
  **Redeploy**. Anote o ID do deployment atual antes de publicar.
- **Banco:** a migração não altera dados. Só há rollback se aparecer uma
  dependência real do papel de execução em `progresso_cenarios`; nesse caso,
  `GRANT SELECT` **apenas** nessa tabela (seção “Reversão mínima”). Não restaure
  privilégios padrão.
- **Interface:** reexecute o workflow a partir do commit anterior ou reimplante
  o artefato anterior do Pages.

#### 6. Por que a API antiga não quebra

- `progress.service.ts` usa `poolDeEscrita()` → `DATABASE_ADMIN_URL`; perder
  `SELECT` como `sql_lab_exec` não afeta a gravação nem a leitura do progresso.
- `schema.service.ts` lê `information_schema.tables`; sem privilégio, a tabela
  interna deixa de aparecer e a listagem devolve as nove tabelas do ERP, sem
  tentar `count(*)` nela.
- A verificação de partida só exige que o papel de execução **não escreva** e
  que `clientes` esteja visível; ela não exige `SELECT` em `progresso_cenarios`.

## Passo 3 — Publicar a API no Render

1. <https://dashboard.render.com> → **New → Web Service** → conecte o
   repositório `Japapaz696/sql-lab`.

   > O repositório tem um `render.yaml`. O Render oferece criar o serviço a
   > partir dele (**New → Blueprint**), e os campos abaixo são preenchidos
   > sozinhos.

2. Configure:

   | Campo             | Valor                                                                                                         |
   | ----------------- | ------------------------------------------------------------------------------------------------------------- |
   | Root Directory    | _(vazio — a raiz do repositório)_                                                                             |
   | Runtime           | Node                                                                                                          |
   | Build Command     | `npm ci --include=dev && npm run build --workspace=@sql-lab/shared && npm run build --workspace=@sql-lab/api` |
   | Start Command     | `node apps/api/dist/index.js`                                                                                 |
   | Health Check Path | `/health`                                                                                                     |

   **Por que a raiz e não `apps/api`:** o repositório é um monorepo com
   workspaces npm, e a API usa o pacote compartilhado `@sql-lab/shared`. Com
   `apps/api` como raiz, o npm não enxerga o workspace e a instalação falha.
   Por isso o build compila o pacote compartilhado primeiro, e o start command
   sobe a API já compilada a partir da raiz.

   **Por que `--include=dev`:** o Render define `NODE_ENV=production` já na
   fase de build. Com essa variável, o npm **omite as devDependencies** — e é
   de lá que vem tudo o que compila o projeto (`typescript`, `vite`,
   `@vitejs/plugin-react`, `tsx`, `@types/*`). Sem a flag, o build morre com
   `tsc: not found` antes de compilar qualquer linha. O `--include=dev` manda o
   npm instalar as dependências de build mesmo com `NODE_ENV=production`.

### Se o serviço já existe: corrija o Build Command

O `render.yaml` vale para **criar** o serviço. Um serviço já criado no painel
não muda sozinho — é preciso corrigir o campo à mão:

> **Render → o serviço `sql-lab-api` → Settings → Build Command**
>
> ```
> npm ci --include=dev && npm run build --workspace=@sql-lab/shared && npm run build --workspace=@sql-lab/api
> ```

Depois, **Save & Deploy**. Sem isso, o build continua falhando e o serviço não
sobe — a URL pública fica sem responder.

O CI confere esse detalhe a cada execução: ele repete a instalação do jeito do
Render (`NODE_ENV=production`) e compila a API, de modo que a falha aparece no
CI e não no deploy.

3. Em **Environment**, defina:

   | Chave                    | Valor                                                          |
   | ------------------------ | -------------------------------------------------------------- |
   | `NODE_ENV`               | `production`                                                   |
   | `DATABASE_URL`           | `sql_lab_exec` na string **pooled** do Neon                    |
   | `DATABASE_ADMIN_URL`     | dono do schema na string **direct** do Neon                    |
   | `ALLOWED_ORIGIN`         | a URL da interface, sem barra final                            |
   | `MAX_RESULT_ROWS`        | `200`                                                          |
   | `QUERY_TIMEOUT_MS`       | `5000`                                                         |
   | `MAX_CONCURRENT_QUERIES` | `4` (mínimo útil: `2`)                                         |
   | `QUEUE_WAIT_MS`          | `8000`                                                         |
   | `RATE_LIMIT_EXECUTE_MAX` | `20` por minuto, por IP                                        |
   | `RATE_LIMIT_EXPLAIN_MAX` | `15` por minuto, por IP                                        |
   | `RATE_LIMIT_WINDOW_MS`   | `60000`                                                        |
   | `PORT`                   | `3000` (o Render define o `PORT` sozinho; pode deixar de fora) |

   > As quatro variáveis de limite têm padrão no código; só defina se quiser
   > mudar o comportamento. O limite é por IP e por janela de 60 s, com
   > `Retry-After` na resposta 429. Atrás do proxy do Render, a API confia em
   > **um** salto de `X-Forwarded-For` — confiar em todos permitiria burlar o
   > limite forjando o cabeçalho.
   >
   > `MAX_CONCURRENT_QUERIES` conta consultas SQL, não requisições: cada
   > execução usa duas (a do aluno e a de referência). Com `1`, a própria
   > consulta de referência não caberia e toda requisição acabaria em 503.

   > `ALLOWED_ORIGIN` aceita uma lista separada por vírgula, para a mesma API
   > servir à interface de produção e à de desenvolvimento.

4. **A API não sobe se a separação de privilégios não estiver de pé.** Em
   produção, a verificação roda na partida, contra o próprio banco: se o
   usuário de execução conseguir escrever — ou se for o mesmo usuário do
   administrativo — a API recusa subir e diz o que fazer. É de propósito: ficar
   fora do ar é melhor do que rodar com um usuário que altera o banco.

## Passo 4 — Publicar a interface

### Opção A — GitHub Pages (recomendado)

1. No repositório: **Settings → Pages → Source = "GitHub Actions"**.

2. Rode o workflow **Publicar a interface no GitHub Pages** (aba **Actions**),
   preenchendo:

   | Campo       | Valor                                              |
   | ----------- | -------------------------------------------------- |
   | `api_url`   | `https://sql-lab-api-7bdv.onrender.com` (o padrão) |
   | `base_path` | `/sql-lab/` (o padrão)                             |

   > `VITE_API_URL` aceita **a origem pura** (`https://api.exemplo.com`) ou a
   > **base completa** (`https://api.exemplo.com/api/v1`). A interface
   > acrescenta o caminho das rotas quando ele falta — assim não é possível
   > publicar uma demonstração que dá 404 em toda requisição.

   O workflow monta a interface e publica. Como é manual, **nada é publicado
   sem alguém pedir**.

   Antes da primeira execução, o workflow confere a montagem: os arquivos
   precisam apontar para o caminho base, a URL da API precisa estar no
   bundle, e o bundle não pode conter string de conexão com credencial.

3. A interface fica em `https://japapaz696.github.io/sql-lab/`.

### Opção B — Cloudflare Pages

1. <https://dash.cloudflare.com> → **Workers & Pages** → **Create** →
   **Pages** → conecte o repositório `Japapaz696/sql-lab`.
2. Configure:

   | Campo            | Valor                                                                                                         |
   | ---------------- | ------------------------------------------------------------------------------------------------------------- |
   | Build command    | `npm ci --include=dev && npm run build --workspace=@sql-lab/shared && npm run build --workspace=@sql-lab/web` |
   | Output directory | `apps/web/dist`                                                                                               |
   | Root directory   | _(deixar vazio)_                                                                                              |
   | Node version     | `20`                                                                                                          |

3. Em **Settings → Environment variables**, defina:

   | Chave          | Valor                                   |
   | -------------- | --------------------------------------- |
   | `VITE_API_URL` | a URL da API no Render, sem barra final |

> `VITE_API_URL` é lido **na hora do build**. Mudar a variável exige
> republicar a interface.
>
> O mesmo `--include=dev` do Render vale aqui: com `NODE_ENV=production` no
> ambiente de build, o npm omite o Vite e o TypeScript, e a interface não é
> montada.

## Passo 5 — Conferir

```bash
# a API responde
curl https://sql-lab-api-7bdv.onrender.com/health
# {"status":"ok"}

# a API está com o banco ao alcance
curl https://sql-lab-api-7bdv.onrender.com/ready
# {"status":"ok","banco":"ok"}

# a interface abre
curl -I https://japapaz696.github.io/sql-lab/
```

O `curl` na URL da API pode demorar até um minuto na **primeira** chamada: é o
serviço do plano gratuito acordando. As chamadas seguintes respondem na hora.

E, na interface:

1. escolher um cenário;
2. executar a consulta de referência;
3. ver "Diagnóstico correto";
4. abrir "Ver o esquema do ERP";
5. testar `COMMIT; UPDATE ...` e ver que é recusado com
   "Só é permitida uma instrução por consulta".

## Problemas que aparecem no caminho

| Sintoma                                              | Causa provável                                         | O que fazer                                                          |
| ---------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------- |
| A URL da API fica sem responder                      | o build do Render falhou                               | corrija o Build Command (Passo 3) e faça Save & Deploy               |
| O log do build diz `tsc: not found`                  | `npm ci` sem `--include=dev` com `NODE_ENV=production` | acrescente `--include=dev` ao Build Command                          |
| A API sobe e cai na hora                             | `DATABASE_URL` apontando para o dono do schema         | a separação não está de pé; o log diz qual das duas condições falhou |
| `permission denied for table clientes`               | o papel `sql_lab_exec` não tem `SELECT` na tabela      | rode `npm run db:reset` de novo com a senha certa                    |
| `database "sql_lab_demo" does not exist`             | a string do Neon aponta para outro banco               | confira o nome do banco na string de conexão                         |
| A interface carrega, mas a lista de cenários não vem | `VITE_API_URL` não foi embutida no build               | republique a interface com a URL correta                             |
| A interface carrega e a lista vem, mas dá 404        | `VITE_API_URL` sem o caminho das rotas                 | a interface acrescenta `/api/v1`; confira a URL embutida             |
| O navegador reclama de CORS                          | `ALLOWED_ORIGIN` não bate com a URL da interface       | ajuste a variável da API e reinicie o serviço                        |
| A primeira clique demora um minuto                   | o plano gratuito hiberna                               | é o comportamento esperado; a interface repete a requisição sozinha  |

## O que vai para o ar

- **Só dados fictícios.** O banco é criado por `db:reset`, com a carga de
  `db/seed.sql` — e-mails em `exemplo.invalid`, documentos no placeholder
  `000.000.000-0X`.
- **Nenhum segredo no repositório.** `DATABASE_URL`, `DATABASE_ADMIN_URL` e a
  senha do papel de execução são variáveis de ambiente na hospedagem. O CI
  inclusive confere, a cada execução, que nenhuma string de conexão com senha
  está versionada.
- **O laboratório não pede identidade.** A sessão é um identificador aleatório
  de 16 bytes, guardado no navegador.

## O que NÃO é recomendado

- **Publicar com um banco de produção.** O laboratório foi feito para ser lido,
  não para ser escrito. A separação de privilégios garante que a escrita é
  recusada, mas o certo é não apontar para dados de ninguém.
- **Deixar a API sem `ALLOWED_ORIGIN` restrito.** O padrão é
  `http://localhost:5173`; em publicação, ajuste para a URL da interface.
- **Usar o Postgres gratuito do Render.** Ele expira em 30 dias. O Neon é
  permanente.
- **Rodar `npm run db:reset` contra um banco que não seja de laboratório.** O
  comando recusa, mas a checagem é sua última linha de defesa.

## Alternativas consideradas

| Opção                                    | Custo      | Durabilidade                  | Veredito                                          |
| ---------------------------------------- | ---------- | ----------------------------- | ------------------------------------------------- |
| **Neon + Render + GitHub Pages**         | US$ 0      | banco permanente; API hiberna | **recomendado**                                   |
| Neon + Render + Cloudflare Pages         | US$ 0      | idem                          | equivalente, CDN melhor                           |
| Render com Postgres gratuito             | US$ 0      | banco expira em 30 dias       | não                                               |
| Render pago (US$ 7) + Neon pago (US$ 19) | US$ 26/mês | tudo ligado                   | só se for production de verdade                   |
| Neon Functions no lugar da API           | US$ 0      | banco e API no mesmo lugar    | exigiria adaptar o Express para handlers por rota |
