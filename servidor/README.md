# Servidor do Office Manager

Guarda uma cópia do que o gestor publica na app e serve-a a quem tem convite.
Corre na Cloudflare (Workers + base de dados D1), dentro do plano gratuito.

**A conta Cloudflare tem de ser da empresa, não pessoal.** A autorização de 23-11-2026 diz
que a conta é titulada pela empresa; abri-la com um e-mail pessoal contraria isso.

## O que já está feito e o que falta

Feito: o servidor, o esquema da base de dados e os testes. Falta criar a conta, publicar,
e ligar a app ao servidor (isso é a fase seguinte).

## Publicar, passo a passo

Tudo isto é no computador, uma vez só. Os exemplos são para o PowerShell do Windows.

0. **Ver em que conta estás.** Já há Wrangler neste computador, provavelmente ligado a outra
   conta (a do Head Coach). Se te esqueceres deste passo, o servidor do trabalho vai para a
   conta errada sem dar erro nenhum:
   ```
   npx wrangler whoami
   ```
   Se aparecer a conta errada: `npx wrangler logout` e volta a entrar no passo 2.
   Depois de saberes o `Account ID` da conta certa, escreve-o no `wrangler.toml`
   (`account_id = "..."`), para o Wrangler nunca mais poder publicar na conta errada.

1. **Criar a conta** em cloudflare.com com o e-mail da empresa.
2. **Entrar com o Wrangler**, a ferramenta da Cloudflare:
   ```
   cd servidor
   npx wrangler login
   ```
3. **Criar a base de dados** e copiar o `database_id` que aparece para o `wrangler.toml`:
   ```
   npx wrangler d1 create office-manager
   ```
4. **Criar as tabelas**:
   ```
   npx wrangler d1 execute office-manager --remote --file=schema.sql
   ```
5. **Guardar o segredo do arranque.** Inventa uma frase longa e guarda-a num sítio seguro;
   serve uma vez só, para criares o primeiro gestor:
   ```
   npx wrangler secret put SEGREDO_ARRANQUE
   ```
6. **Confirmar o endereço da app** em `wrangler.toml`, na linha `ORIGEM_PERMITIDA`.
7. **Publicar**:
   ```
   npx wrangler deploy
   ```
   No fim aparece o endereço do servidor, algo como
   `https://office-manager-servidor.<conta>.workers.dev`. Guarda-o.
8. **Criar o primeiro gestor** (uma vez só). Troca o endereço e o segredo pelos teus:
   ```
   $corpo = '{"segredo":"<o teu segredo>","nome":"Alexandre","dispositivo":"telemovel"}'
   $r = Invoke-RestMethod -Method Post -ContentType "application/json" -Body $corpo `
     -Uri "https://office-manager-servidor.<conta>.workers.dev/api/arranque"
   $r.token
   ```
   (No PowerShell, `curl` é outro comando e o exemplo com `curl` não funciona. Sem acentos no
   corpo, para não haver problemas de codificação.)
   A resposta traz um `token`. **Guarda-o**: é o que vai ligar o teu telemóvel ao servidor.
   Não o partilhes com ninguém; quem o tiver escreve como se fosse tu.

## Duas coisas a resolver antes de publicar

- **A app já está alojada na Cloudflare**, em `https://office-manager-pwa.pages.dev` (Pages, com
  `public/_headers`). Essa conta é anterior à autorização. Pôr só o servidor na conta da empresa
  deixa os dados do lado certo, mas o alojamento da app do lado errado. Decidir: mover também o
  Pages para a conta da empresa, ou deixar a app onde está e justificar a diferença.
- **A CSP vai bloquear as chamadas ao servidor.** `public/_headers` tem `connect-src 'self'`.
  Ao ligar a app (Fase C), acrescentar a origem do Worker a essa linha, e só essa.

## Como funciona

| Endereço | Quem pode | O que faz |
|---|---|---|
| `POST /api/arranque` | só com o segredo, uma vez | cria o primeiro gestor |
| `POST /api/entrar` | qualquer um com um código | troca o convite por um acesso |
| `GET /api/eu` | quem entrou | diz o nome e o papel |
| `GET /api/puxar?desde=N` | quem entrou | o que mudou desde a última vez |
| `POST /api/enviar` | só o gestor | publica registos |
| `POST /api/convites` | só o gestor | cria um convite de uso único, válido 48 horas |
| `GET /api/utilizadores` | só o gestor | quem tem acesso e quando entrou |
| `DELETE /api/utilizadores/<id>` | só o gestor | corta o acesso na hora |

## Decisões que vale a pena conhecer

- **Quem só consulta não escreve, e isso é decidido aqui.** Esconder botões na app não protege nada.
- **Os registos são guardados em JSON**, tal como estão na app. O servidor só precisa de saber
  a tabela, o id e quando mudou. Assim, mudar a app não obriga a mudar o servidor.
- **O que marca o tempo é um contador do servidor, não as datas.** Dois telemóveis com a hora
  trocada partiriam a sincronização.
- **Tokens e códigos nunca são guardados.** Fica só o resumo (SHA-256). Se a base de dados for
  lida por alguém, não dá para entrar com o que lá está.
- **Uma versão velha nunca apaga a boa:** um registo só substitui o que está lá se for mais recente.
- **Fotografias, documentos e plantas ficam de fora da Fase 1**, por serem pesados. Entram depois,
  no armazenamento R2.

## Testes

Correm com o resto do projeto (`npm run check`), sem precisar de conta nem de internet:
os testes levantam o servidor a sério contra uma base de dados SQLite com este mesmo esquema.
