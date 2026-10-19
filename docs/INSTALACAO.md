# Instalação

Este guia cobre os três caminhos de banco: Docker local, PostgreSQL local e o
gratuito do Neon. Todos levam ao mesmo resultado.

## Requisitos

- Node.js 20 ou superior
- npm 10 ou superior
- PostgreSQL 16

## 1. Dependências

```bash
npm install
```

O repositório é um monorepo com workspaces (`apps/api`, `apps/web`,
`packages/shared`). Um `npm install` na raiz resolve tudo.

## 2. Banco de dados

### Opção A — Docker

```bash
docker compose up -d postgres
```

Sobe um PostgreSQL 16 na porta 5432, com o usuário `sql_lab` e a senha `sql_lab`.
O banco `sql_lab` é criado pelo próprio container.

Falta criar o banco de teste:

```bash
docker exec -it sql-lab-postgres createdb -U sql_lab sql_lab_test
```

### Opção B — PostgreSQL local

```sql
CREATE ROLE sql_lab LOGIN PASSWORD 'sql_lab';
CREATE DATABASE sql_lab OWNER sql_lab;
CREATE DATABASE sql_lab_test OWNER sql_lab;
```

### Opção C — Neon (gratuito)

1. Crie uma conta em <https://neon.tech> e um projeto.
2. Em **Connect**, copie a **pooled connection string**.
3. Crie um segundo banco no mesmo projeto (ou em outro) para os testes, e copie
   a string dele.

O Neon tem uma diferença em relação ao PostgreSQL local: a conexão exige TLS.
A string do Neon já vem com `?sslmode=require`, e o código respeita esse
parâmetro — não é preciso configurar nada.

## 3. Configuração

```bash
cp .env.example .env
```

Preencha:

| Variável            | O que é                                                  |
| ------------------- | -------------------------------------------------------- |
| `DATABASE_URL`      | banco de desenvolvimento                                 |
| `TEST_DATABASE_URL` | banco de teste (a suíte recria o schema nele)            |
| `PORT`              | porta da API (padrão 3000)                               |
| `ALLOWED_ORIGIN`    | origem liberada no CORS (padrão `http://localhost:5173`) |
| `MAX_RESULT_ROWS`   | limite de linhas devolvidas (padrão 200)                 |
| `QUERY_TIMEOUT_MS`  | tempo limite de uma consulta (padrão 5000)               |

O `.env` está no `.gitignore` e nunca deve ser versionado.

## 4. Carga do banco

```bash
npm run db:reset
```

O comando recria o esquema (`db/schema.sql`) e a carga fictícia (`db/seed.sql`).
Saída esperada:

```
Pronto: {"clientes":"6","produtos":"8","pedidos":"9","itens":"19",
         "pagamentos":"10","estoque":"8","chamados":"4"}
```

Rodar de novo produz exatamente o mesmo banco: a carga é determinística.

## 5. Rodar

```bash
npm run dev
```

- Interface: <http://localhost:5173>
- API: <http://localhost:3000>

Se a API subir em outra porta, o proxy da interface acompanha:

```bash
API_PORT=4610 npm run dev
```

## 6. Testes

```bash
npm test
```

A suíte precisa do banco de teste com as migrations aplicadas. A suíte recria
o schema dele sozinha no início, então basta o banco existir.

O CI faz o mesmo: sobe um `postgres:16` como serviço, cria o banco de teste e
roda `npm run validate`.

## 7. Publicação (opcional)

O repositório está pronto para ir ao GitHub Pages ou à Vercel, mas a
publicação de um laboratório com banco precisa de um PostgreSQL com
persistência. O caminho que não custa nada:

- **API:** Render ou Fly.io, com o `DATABASE_URL` apontando para o Neon;
- **Interface:** Vercel ou GitHub Pages, com o proxy `/api` para a API.

Antes de publicar, leia [SEGURANCA.md](SEGURANCA.md): a API executa SQL
escrito por quem usa a interface, e a proteção depende do banco estar em modo
somente leitura.
