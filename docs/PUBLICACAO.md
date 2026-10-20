# Plano de publicação — SQL Lab

O laboratório é um sistema de três partes. Esta é a configuração recomendada
para **publicar a demonstração sem gastar nada**, baseada nas documentation
atual (outubro de 2026) de cada fornecedor.

## Resumo da recomendação

| Parte                       | Onde                                   | Custo | Observação                                                         |
| --------------------------- | -------------------------------------- | ----- | ------------------------------------------------------------------ |
| Frontend (React + Vite)     | **GitHub Pages** (ou Cloudflare Pages) | US$ 0 | Estático. Com `VITE_API_URL` apontando para a API                  |
| Backend (Node.js + Express) | **Render** — plano Hobby               | US$ 0 | Hiberna após 15 min sem tráfego; leva ~1 min para acordar          |
| Banco (PostgreSQL)          | **Neon** — plano Free                  | US$ 0 | Permanente, 100 projetos, 1 GB por projeto, escala a zero em 5 min |

**Total: US$ 0.** Nenhum cartão de crédito é pedido por nenhum dos três.

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

**A interface já trata isso**: a camada de API repete a requisição até três
vezes, com espera entre as tentativas, e a mensagem final explica que a API
está hibernando. O teste correspondente está em
`apps/web/src/services/api.test.ts`.

Se o tempo de espera for um problema, há duas saídas, ambas fora do escopo
gratuito:

| Alternativa                                       | Custo     | Efeito                                                                             |
| ------------------------------------------------- | --------- | ---------------------------------------------------------------------------------- |
| Manter a API acordada com um pinger a cada 14 min | US$ 0     | a API nunca hiberna; é uso do plano fora do espírito, mas é comum em demonstrações |
| Assinar o plano Starter do Render                 | US$ 7/mês | serviço sempre ligado, sem hibernação                                              |

Nenhuma das duas é necessária para o laboratório funcionar.

## Passo 1 — O banco no Neon

1. Crie um projeto no <https://neon.tech> (plano Free).
2. Em **Connection details**, copie a **pooled connection string**.
3. Anote o hostname: ele começa com `ep-` e termina em `neon.tech`.

O Neon dá **dois** pontos de acesso à mesma conta, e o laboratório usa os dois:

| Variável             | Papel                                                   | Quem usa                                                |
| -------------------- | ------------------------------------------------------- | ------------------------------------------------------- |
| `DATABASE_URL`       | o usuário **sem** permissão de escrita (`sql_lab_exec`) | a aplicação, para as consultas                          |
| `DATABASE_ADMIN_URL` | o usuário dono do schema                                | a aplicação, para gravar o progresso e preparar o banco |

> **A string do painel do Neon é do dono do schema.** Para o usuário de
> execução, é preciso criá-lo — o passo 3 do guia de instalação faz isso, mas
> exige um usuário com permissão para criar papéis. Em hospedagens gerenciadas,
> essa permissão nem sempre existe, e o laboratório avisa e segue: a transação
> somente leitura e o protocolo estendido continuam protegendo.

## Passo 2 — Preparar o banco

Com as duas strings configuradas:

```bash
npm run db:reset
```

Isso recria o esquema, a carga fictícia e as concessões de privilégio.

## Passo 3 — Publicar a API no Render

1. <https://dashboard.render.com> → **New → Web Service** → conecte o
   repositório `Japapaz696/sql-lab`.
2. Configure:

   | Campo             | Valor                                                                                                |
   | ----------------- | ---------------------------------------------------------------------------------------------------- |
   | Root Directory    | `apps/api`                                                                                           |
   | Runtime           | Node                                                                                                 |
   | Build Command     | `npm install && npm run build --workspace=@sql-lab/shared && npm run build --workspace=@sql-lab/api` |
   | Start Command     | `node dist/index.js`                                                                                 |
   | Health Check Path | `/health`                                                                                            |

3. Em **Environment**, defina:

   | Chave                | Valor                               |
   | -------------------- | ----------------------------------- |
   | `NODE_ENV`           | `production`                        |
   | `DATABASE_URL`       | string do usuário de execução       |
   | `DATABASE_ADMIN_URL` | string do dono do schema            |
   | `ALLOWED_ORIGIN`     | a URL da interface, sem barra final |
   | `MAX_RESULT_ROWS`    | `200`                               |
   | `QUERY_TIMEOUT_MS`   | `5000`                              |

4. **O `DATABASE_URL` precisa apontar para um usuário que exista.** Se o
   `db:reset` não rodou com a string de execução, o papel `sql_lab_exec` ainda
   não existe no banco do Neon e a API falha ao conectar.

## Passo 4 — Publicar a interface

1. <https://dash.cloudflare.com> → **Workers & Pages** → **Create** →
   **Pages** → conecte o repositório `Japapaz696/sql-lab`.
2. Configure:

   | Campo            | Valor                                                                                                |
   | ---------------- | ---------------------------------------------------------------------------------------------------- |
   | Build command    | `npm install && npm run build --workspace=@sql-lab/shared && npm run build --workspace=@sql-lab/web` |
   | Output directory | `apps/web/dist`                                                                                      |
   | Root directory   | _(deixar vazio)_                                                                                     |
   | Node version     | `20`                                                                                                 |

3. Em **Settings → Environment variables**, defina:

   | Chave          | Valor                                   |
   | -------------- | --------------------------------------- |
   | `VITE_API_URL` | a URL da API no Render, sem barra final |

> `VITE_API_URL` é lido **na hora do build**. Mudar a variável exige
> republicar a interface.

## Passo 5 — CORS

A API libera a origem da interface pela variável `ALLOWED_ORIGIN`. Sem isso, o
navegador bloqueia a chamada por origem cruzada. Se a interface mudar de URL,
a variável da API precisa mudar junto.

## Passo 6 — Conferir

```bash
# a API responde
curl https://SUA-API.onrender.com/health
# {"status":"ok"}

# a interface abre e lista os cenários
curl https://SUA-INTERFACE.pages.dev/
```

E, na interface:

1. escolher um cenário;
2. executar a consulta de referência;
3. ver "Diagnóstico correto";
4. abrir "Ver o esquema do ERP";
5. testar `COMMIT; UPDATE ...` e ver que é recusado com
   "Só é permitida uma instrução por consulta".

## O que vai para o ar

- **Só dados fictícios.** O banco é criado por `db/reset`, com a carga de
  `db/seed.sql` — e-mails em `exemplo.invalid`, documentos no placeholder
  `000.000.000-0X`.
- **Nenhum segredo no repositório.** `DATABASE_URL` e `DATABASE_ADMIN_URL` são
  variáveis de ambiente na hospedagem.
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

## Alternativas considered

| Opção                                    | Custo      | Durabilidade                  | Veredito                                          |
| ---------------------------------------- | ---------- | ----------------------------- | ------------------------------------------------- |
| **Neon + Render + GitHub Pages**         | US$ 0      | banco permanente; API hiberna | **recomendado**                                   |
| Neon + Render + Cloudflare Pages         | US$ 0      | idem                          | equivalente, CDN melhor                           |
| Render com Postgres gratuito             | US$ 0      | banco expira em 30 dias       | não                                               |
| Render pago (US$ 7) + Neon pago (US$ 19) | US$ 26/mês | tudo ligado                   | só se for production de verdade                   |
| Neon Functions no lugar da API           | US$ 0      | banco e API no mesmo lugar    | exigiria adaptar o Express para handlers por rota |
