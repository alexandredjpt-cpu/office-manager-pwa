#!/usr/bin/env node
/**
 * Verificação de privacidade antes de publicar.
 *
 * Falha (exit 1) se encontrar, em ficheiros que iriam para o repositório:
 *  - segredos (chaves, tokens, chaves privadas);
 *  - e-mails, telefones portugueses, IBAN, NIF;
 *  - cópias de segurança da app ou fotografias fora de public/;
 *  - termos da lista local `.privacy-denylist` (um por linha: nomes de locais,
 *    equipamentos, empresas, pessoas). Esse ficheiro está no .gitignore e
 *    NUNCA é publicado — senão a própria lista revelaria os dados.
 *
 * Uso: npm run privacy
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';

const IGNORAR = [/^package-lock\.json$/, /^scripts\/privacy-check\.mjs$/];
const BINARIOS = /\.(png|jpe?g|webp|gif|ico|woff2?|zip|pdf|xlsx)$/i;
const IMAGENS_PERMITIDAS = /^public\/icon[\w-]*\.(png|svg)$/;

// Lista de ficheiros: os que o git publicaria (seguidos + novos não ignorados).
const ficheiros = execSync('git ls-files --cached --others --exclude-standard', { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && existsSync(f) && statSync(f).isFile() && !IGNORAR.some((r) => r.test(f)));

const PADROES = [
  ['chave privada', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['token GitHub', /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ['chave AWS', /\bAKIA[0-9A-Z]{16}\b/],
  ['chave API genérica', /\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{16,}/],
  ['token Slack', /\bxox[abpr]-[A-Za-z0-9-]{10,}/],
  ['segredo atribuído', /\b(api[_-]?key|secret|password|passwd|token)\b\s*[:=]\s*['"][^'"\s]{8,}['"]/i],
  ['e-mail', /\b[A-Za-z0-9._%+-]+@(?!example\.(com|org|net)\b|users\.noreply\.github\.com\b|anthropic\.com\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/],
  ['telefone PT', /(?<![\w.-])(?:\+351\s?)?(?:9[1236]\d|2\d{2})\s?\d{3}\s?\d{3}(?![\w.-])/],
  ['IBAN', /\bPT50\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d\b/i]
];

const denylistPath = '.privacy-denylist';
const denylist = existsSync(denylistPath)
  ? readFileSync(denylistPath, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
  : [];

const normalizar = (s) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const termos = denylist.map((t) => ({ original: t, norm: normalizar(t) }));

const problemas = [];

for (const f of ficheiros) {
  if (/office-manager-copia-.*\.zip$/i.test(f) || /\.(zip)$/i.test(f)) {
    problemas.push(`${f}: cópia de segurança/ZIP não pode ir para o repositório`);
    continue;
  }
  if (/\.(png|jpe?g|webp|gif|heic)$/i.test(f) && !IMAGENS_PERMITIDAS.test(f)) {
    problemas.push(`${f}: fotografia/imagem fora dos ícones da app`);
    continue;
  }
  if (BINARIOS.test(f)) continue;

  const texto = readFileSync(f, 'utf8');
  const linhas = texto.split('\n');
  linhas.forEach((linha, i) => {
    if (linha.includes('privacy-ok')) return; // exceção explícita e visível em revisão
    for (const [nome, re] of PADROES) {
      if (re.test(linha)) problemas.push(`${f}:${i + 1}: possível ${nome}`);
    }
    const ln = normalizar(linha);
    for (const t of termos) {
      if (ln.includes(t.norm)) problemas.push(`${f}:${i + 1}: termo da lista privada (${'*'.repeat(Math.min(t.original.length, 8))})`);
    }
  });
}

if (problemas.length) {
  console.error(`✖ Verificação de privacidade falhou (${problemas.length}):\n  ` + problemas.join('\n  '));
  console.error('\nSe for um falso positivo, acrescenta o comentário "privacy-ok" na linha.');
  process.exit(1);
}
console.log(`✔ Privacidade: ${ficheiros.length} ficheiros verificados, ${termos.length} termos privados, nada encontrado.`);
if (!termos.length) console.log('  Dica: cria .privacy-denylist (não publicado) com nomes reais a bloquear.');
