# Segurança

O laboratório executa SQL escrito por quem usa a interface. Isso é o propósito
do projeto, e por isso a proteção foi pensada desde o começo.

## O que está protegido

| Ameaça                           | Proteção                                                                             | Onde                       |
| -------------------------------- | ------------------------------------------------------------------------------------ | -------------------------- |
| Escrever no banco                | transação `READ ONLY`                                                                | `database/pool.ts`         |
| Consulta pesada travar o serviço | `statement_timeout` de 5 s                                                           | `database/pool.ts`         |
| Resposta gigante                 | truncamento em 200 linhas                                                            | `services/sql.service.ts`  |
| Erro vazar detalhes internos     | a mensagem do PostgreSQL vai para a interface; o resto fica no log do servidor       | `services/sql.service.ts`  |
| Dados de uma pessoa no histórico | o laboratório não pede identidade: a sessão é um identificador aleatório de 16 bytes | `services/api.ts` (web)    |
| Segredo no repositório           | `.env` no `.gitignore`, verificado pelo CI                                           | `.github/workflows/ci.yml` |

A proteção contra escrita vem do **servidor de banco**, não da aplicação. A
aplicação não tenta filtrar comandos perigosos: ela abre uma transação
somente leitura e o PostgreSQL recusa a escrita. É a diferença entre "confiamos
na validação" e "o banco recusa".

A suíte de integração verifica isso de verdade: `UPDATE`, `DELETE`, `DROP` e
`INSERT` são recusados, e os dados continuam intactos depois da tentativa.

## O que NÃO está protegido

**Leitura não é restrita.** Quem usa a interface consegue ler qualquer linha do
banco. Isso é aceitável no laboratório, porque o banco é sintético e público —
mas é o limite a considerar antes de apontar esta aplicação para um banco real.

Para um banco real, o que precisaria mudar:

1. um usuário do PostgreSQL **sem privilégio de escrita** e com `REVOKE` de DDL
   sobre o esquema;
2. isolamento por esquema ou por sessão, se os dados de um aluno não puderem
   ser vistos por outro;
3. `statement_timeout` menor e `work_mem` limitado, para conter consumo;
4. limite de tempo por sessão, não só por consulta;
5. registro das consultas executadas, para o dono do banco saber o que rodou.

## Privacidade dos dados

O laboratório **não pede identidade**. A sessão é um identificador aleatório
gerado no navegador, guardado no `localStorage`, e usado só para contar
tentativas por cenário. Não há nome, e-mail, telefone nem documento em
nenhum lugar do sistema.

A carga é inteiramente fictícia:

- e-mails no domínio `exemplo.invalid`, reservado pela RFC 2606;
- documentos na sequência `000.000.000-01` a `000.000.000-06`, o placeholder que
  o próprio CPF reserva para "não aplicável";
- nomes, cidades e telefones de empresas que não existem.

Um teste automatizado verifica a cada execução que nenhum e-mail de domínio
real está na tabela de clientes.

## Publicação

O laboratório **não deve ser publicado com um banco que contenha dados reais**.
A configuração de referência — API no Render ou Fly.io, interface na Vercel ou
no GitHub Pages, banco no Neon — está em
[INSTALACAO.md](INSTALACAO.md).

Se for publicar para terceiros:

- use uma conta de demonstração, com senha conhecida só por quem apresenta;
- troque a senha ao final;
- o laboratório não tem provisionamento por convite: quem tiver a URL e a senha
  entra.

## Denúncias

O projeto é pessoal e está em fase de MVP. Problema de segurança encontrado
aqui pode ser reportado pela aba **Security** do próprio repositório.
