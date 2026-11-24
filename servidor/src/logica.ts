/**
 * Decisões do servidor que não precisam da base de dados. Ficam à parte para poderem
 * ser testadas sem publicar nada na Cloudflare.
 */

/** Gestor gere pessoas e escreve; registo escreve; consulta só lê. */
export const PAPEIS = ['gestor', 'registo', 'consulta'] as const;
export type Papel = (typeof PAPEIS)[number];
export const papelValido = (valor: unknown): valor is Papel => (PAPEIS as readonly unknown[]).includes(valor);

/**
 * Tabelas que a Fase 1 sincroniza. Fotografias, documentos e plantas ficam de fora
 * por serem pesadas; `meta` fica de fora por guardar definições de cada telemóvel.
 */
export const TABELAS_SINCRONIZADAS = [
  'localizacoes', 'equipamentos', 'artigos', 'contagensStock', 'movimentosStock', 'anomalias', 'atividades'
] as const;

export const MAX_REGISTOS_POR_ENVIO = 500;
export const MAX_BYTES_POR_REGISTO = 256 * 1024;
export const VALIDADE_CONVITE_HORAS = 48;
export const LIMITE_ENTRADAS_POR_MINUTO = 5; // por endereço IP, em /api/entrar

export const podeEscrever = (papel: Papel) => papel === 'gestor' || papel === 'registo';
export const podeGerir = (papel: Papel) => papel === 'gestor';

/** Resumo SHA-256 em hexadecimal. Tokens e códigos de convite nunca são guardados em claro. */
export async function resumo(texto: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem I, O, 0 e 1, que se confundem

/** Código de convite curto, para ser ditado ou enviado por mensagem. */
export function gerarCodigo(bytes = crypto.getRandomValues(new Uint8Array(8))): string {
  const letras = [...bytes].map((b) => ALFABETO[b % ALFABETO.length]).join('');
  return `${letras.slice(0, 4)}-${letras.slice(4)}`;
}

/** Token de acesso de um telemóvel: 32 bytes ao acaso. */
export function gerarToken(bytes = crypto.getRandomValues(new Uint8Array(32))): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function normalizarCodigo(codigo: string): string {
  return codigo.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export interface Convite { papel: Papel; nome: string; expiraEm: string; usadoEm: string | null }

/** Um convite só serve uma vez e dentro do prazo. */
export function conviteUtilizavel(c: Convite | null, agora: Date): { ok: true } | { ok: false; erro: string } {
  if (!c) return { ok: false, erro: 'Código inválido.' };
  if (c.usadoEm) return { ok: false, erro: 'Este código já foi usado.' };
  if (new Date(c.expiraEm).getTime() <= agora.getTime()) return { ok: false, erro: 'Este código expirou.' };
  return { ok: true };
}

/**
 * `base` é o `seq` da versão em que a app se baseou (null = registo novo). Se o servidor
 * já tiver outra versão, recusa-se a gravação e devolve-se a atual: nada se perde em silêncio.
 * `atualizado` é só informação para mostrar; não decide nada.
 */
export interface RegistoEnviado { tabela: string; id: string; dados: unknown; atualizado: string; base: number | null }

/**
 * Verifica o que a app quer gravar. Recusa tabelas de fora da lista, registos sem id
 * ou sem data, e payloads grandes de mais para não gastar o plano gratuito à toa.
 */
export function validarEnvio(corpo: unknown): { ok: true; registos: RegistoEnviado[] } | { ok: false; erro: string } {
  if (!Array.isArray(corpo)) return { ok: false, erro: 'Esperava uma lista de registos.' };
  if (corpo.length > MAX_REGISTOS_POR_ENVIO) return { ok: false, erro: `No máximo ${MAX_REGISTOS_POR_ENVIO} registos de cada vez.` };
  const permitidas = new Set<string>(TABELAS_SINCRONIZADAS);
  const registos: RegistoEnviado[] = [];
  const vistos = new Set<string>();
  for (const linha of corpo) {
    const r = linha as Partial<RegistoEnviado>;
    if (!r || typeof r !== 'object') return { ok: false, erro: 'Registo inválido.' };
    if (typeof r.tabela !== 'string' || !permitidas.has(r.tabela)) return { ok: false, erro: `Tabela não sincronizada: ${String(r.tabela)}.` };
    if (typeof r.id !== 'string' || !r.id) return { ok: false, erro: 'Registo sem id.' };
    if (vistos.has(`${r.tabela}/${r.id}`)) return { ok: false, erro: `Registo ${r.id} repetido no mesmo envio.` };
    vistos.add(`${r.tabela}/${r.id}`);
    if (typeof r.atualizado !== 'string' || !r.atualizado) return { ok: false, erro: `Registo ${r.id} sem data de alteração.` };
    if (r.base !== null && !(Number.isSafeInteger(r.base) && (r.base as number) > 0)) return { ok: false, erro: `Registo ${r.id} sem versão de base válida.` };
    const json = JSON.stringify(r.dados ?? null);
    if (json.length > MAX_BYTES_POR_REGISTO) return { ok: false, erro: `Registo ${r.id} é grande de mais.` };
    registos.push({ tabela: r.tabela, id: r.id, dados: r.dados, atualizado: r.atualizado, base: r.base as number | null });
  }
  return { ok: true, registos };
}

/** `desde` é o relógio do servidor que o telemóvel já tem. Qualquer coisa estranha vale zero. */
export function desdeDe(valor: string | null): number {
  const n = Number(valor);
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
}
