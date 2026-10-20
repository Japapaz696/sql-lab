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

O papel de execução (`sql_lab_exec`) é criado pelo `npm run db:reset`, na
primeira vez — é o passo 4.

### Opção B — PostgreSQL local

```sql
-- O dono do schema, que prepara o banco.
CREATE ROLE sql_lab LOGIN PASSWORD 'sql_lab';
-- O papel de execução: só leitura. É criado pelo db:reset, mas pode ser
-- criado aqui se preferir.
CREATE ROLE sql_lab_exec LOGIN PASSWORD 'uma-senha-forte-de-16-ou-mais';

CREATE DATABASE sql_lab OWNER sql_lab;
CREATE DATABASE sql_lab_test OWNER sql_lab;

GRANT CONNECT ON DATABASE sql_lab TO sql_lab_exec;
GRANT CONNECT ON DATABASE sql_lab_test TO sql_lab_exec;
```

> A senha do papel de execução **não** pode ser igual ao nome do papel, nem
> ter menos de 16 caracteres. O `db:reset` recusa as duas coisas.

### Opção C — Neon (gratuito)

1. Crie uma conta em <https://neon.tech> e um projeto.
2. Em **Connect**, copie as duas strings: a **pooled** e a **direct**.
3. Crie um segundo banco no mesmo projeto (ou em outro) para os testes, e copie
   a string dele.

O Neon tem uma diferença em relação ao PostgreSQL local: a conexão exige TLS.
A string do Neon já vem com `?sslmode=require`, e o código respeita esse
parâmetro — não é preciso configurar nada.

**Pooled e direct, para quê:**

| Ponto de acesso | Para que serve                                                   |
| --------------- | ---------------------------------------------------------------- |
| **pooled**      | a conexão da API, em tempo de execução — muitas consultas curtas |
| **direct**      | a preparação do banco — criação de papéis e alteração do schema  |

## 3. Configuração

```bash
cp .env.example .env
```

Preencha:

| Variável                  | O que é                                                    |
| ------------------------- | ---------------------------------------------------------- |
| `DATABASE_URL`            | conexão de **execução**: usuário com apenas `SELECT`       |
| `DATABASE_ADMIN_URL`      | conexão da **aplicação**: usuário dono do schema           |
| `TEST_DATABASE_URL`       | banco de teste (a suíte recria o schema nele)              |
| `TEST_DATABASE_ADMIN_URL` | conexão administrativa do banco de teste                   |
| `SQL_LAB_EXEC_PASSWORD`   | senha do papel de execução (16+ caracteres)                |
| `SQL_LAB_CONFIRMAR_RESET` | `sim`, para autorizar a recriação do schema                |
| `PORT`                    | porta da API (padrão 3000)                                 |
| `ALLOWED_ORIGIN`          | origens liberadas no CORS (padrão `http://localhost:5173`) |
| `MAX_RESULT_ROWS`         | limite de linhas devolvidas (padrão 200)                   |
| `QUERY_TIMEOUT_MS`        | tempo limite de uma consulta (padrão 5000)                 |

`ALLOWED_ORIGIN` aceita uma lista separada por vírgula, para a mesma API
servir à interface de produção e à de desenvolvimento.

O `.env` está no `.gitignore` e nunca deve ser versionado.

## 4. Carga do banco

```bash
npm run db:reset
```

O comando recria o esquema (`db/schema.sql`), a carga fictícia (`db/seed.sql`) e as
concessões de privilégio (`db/privilegios.sql`), que criam o papel de execução
com apenas `SELECT`.

Saída esperada:

```
Banco preparado: sql_lab
Pronto: {"clientes":6,"produtos":8,"pedidos":9,"itens":19,
         "pagamentos":10,"estoque":8,"chamados":4}
Papel de execução: SELECT (e nada mais)
```

Rodar de novo produz exatamente o mesmo banco: a carga é determinística.

### O que o comando se recusa a fazer

A preparação recria o schema inteiro — `DROP SCHEMA public CASCADE`. Num banco
com dados de verdade, isso apagaria tudo. Por isso o comando **recusa** antes
de tocar em qualquer coisa, e diz por quê:

| Situação                                                         | O que acontece                                |
| ---------------------------------------------------------------- | --------------------------------------------- |
| `SQL_LAB_CONFIRMAR_RESET` não está valendo `sim`                 | recusa: a confirmação não está presente       |
| o banco não se chama `sql_lab`, `sql_lab_test` ou `sql_lab_demo` | recusa: o banco não parece de laboratório     |
| `SQL_LAB_EXEC_PASSWORD` não está definida                        | recusa: a senha não pode ter valor previsível |
| a senha tem menos de 16 caracteres                               | recusa: senha curta demais                    |
| a senha é igual ao nome do papel                                 | recusa: senha óbvia demais                    |

> Se o usuário administrativo não puder criar papéis — o que acontece em
> hospedagens gerenciadas, onde o dono não é superusuário — o comando avisa e
> segue. O laboratório continua protegido pela transação somente leitura e pelo
> protocolo estendido. Mas, nesse caso, a **API não sobe em produção**: a
> verificação de partida recusa, porque a separação de privilégios é a
> garantia que importa.

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

Em desenvolvimento, a API sobe mesmo sem a separação de privilégios — com um
aviso. Em produção, ela não sobe.

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

O passo a passo, campo a campo, está em [PUBLICACAO.md](PUBLICACAO.md).

Antes de publicar, leia [SEGURANCA.md](SEGURANCA.md): a API executa SQL
escrito por quem usa a interface, e a proteção depende do banco estar em modo
somente leitura.
