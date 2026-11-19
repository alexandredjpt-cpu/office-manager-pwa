# Office Manager — PWA pessoal

App pessoal para gerir equipamentos, stock e anomalias, pensada para o telemóvel Android.
Funciona **sem rede**, **sem servidor** e **sem contas**: os dados ficam só no dispositivo.

Código aberto, licença [MIT](LICENSE).

## Princípios

- **Os dados nunca saem do dispositivo**, exceto pelas cópias de segurança que tu próprio envias.
- **Nada é apagado**: registos usam eliminação lógica; equipamentos são abatidos, nunca eliminados.
- **Códigos legíveis nunca reutilizados** (`EQ-000001`, …).
- **Cópia de segurança completa** (ZIP com JSON + fotografias), com aviso ao fim de 7 dias
  (ou 25 alterações) e restauro tudo-ou-nada.

## Privacidade do repositório

Este repositório é público. **Nunca** entram aqui dados reais, fotografias, cópias de segurança
nem segredos. Para garantir:

```bash
npm install          # ativa o hook de pré-commit (.githooks/pre-commit)
npm run privacy      # verificação manual
```

A verificação bloqueia e-mails, telefones, IBAN, chaves/tokens, ZIPs e imagens fora dos ícones.
Para bloquear também nomes reais (locais, equipamentos, pessoas, empresas), cria
`.privacy-denylist` na raiz com um termo por linha. Esse ficheiro está no `.gitignore` e
**nunca é publicado**.

## Desenvolvimento

Requer Node 22+.

```bash
npm install
npm run dev          # servidor local
npm run check        # privacidade + tipos + testes
npm run build        # gera dist/
npm run preview      # serve dist/ (testar offline e instalação)
```

## Publicação (Cloudflare Pages)

1. Cloudflare → Workers & Pages → Create → Pages → ligar a este repositório.
2. Build command: `npm run build` · Output directory: `dist`.
3. Cada merge em `main` publica automaticamente. O GitHub Actions não publica nada.

O build usa caminhos relativos, por isso também funciona no GitHub Pages.

## Instalar no Android

Abre o endereço no Chrome → **Instalar app** (ou menu ⋮ → Instalar app).
Instalada, a app abre sem rede e o Android trata o armazenamento como persistente.

## Estrutura

```
src/db/        esquema Dexie (IndexedDB), regras de criação/abate/eliminação lógica
src/backup/    cópia de segurança ZIP, restauro, aviso, partilha Android
src/ui/        interface React
tests/         testes (Vitest + fake-indexeddb)
scripts/       verificação de privacidade
```

## Roteiro

1. ✅ Base: PWA instalável, offline, cópia de segurança e restauro
2. Localizações e equipamentos: fichas, fotografias, ciclo de vida
3. Economato pessoal: artigos, locais, contagens, stock mínimo
4. Anomalias com fotografias e histórico
5. Relatórios PDF e Excel
