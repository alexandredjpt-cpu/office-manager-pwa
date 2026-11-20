/**
 * Cópia cifrada: AES-GCM 256 com chave derivada da palavra-passe (PBKDF2-SHA256).
 * Formato: "OMCIFRA1" | iterações (u32 BE) | sal (16) | iv (12) | dados cifrados.
 * A palavra-passe nunca é guardada: se for esquecida, a cópia não se recupera.
 */
const MAGIA = new TextEncoder().encode('OMCIFRA1');
export const ITERACOES = 600_000;
export const MIN_PALAVRA_PASSE = 8;

export class ErroPalavraPasse extends Error {}

async function chave(palavraPasse: string, sal: Uint8Array<ArrayBuffer>, iteracoes: number, uso: KeyUsage): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(palavraPasse), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: iteracoes }, base, { name: 'AES-GCM', length: 256 }, false, [uso]);
}

export function validarPalavraPasse(p: string, confirmacao: string): void {
  if (p.length < MIN_PALAVRA_PASSE) throw new ErroPalavraPasse(`A palavra-passe tem de ter pelo menos ${MIN_PALAVRA_PASSE} caracteres.`);
  if (p !== confirmacao) throw new ErroPalavraPasse('As duas palavras-passe não são iguais.');
}

export async function cifrar(dados: Blob, palavraPasse: string, iteracoes = ITERACOES): Promise<Blob> {
  if (palavraPasse.length < MIN_PALAVRA_PASSE) throw new ErroPalavraPasse(`A palavra-passe tem de ter pelo menos ${MIN_PALAVRA_PASSE} caracteres.`);
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const k = await chave(palavraPasse, sal, iteracoes, 'encrypt');
  const cifrado = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, await dados.arrayBuffer());
  const it = new Uint8Array(4);
  new DataView(it.buffer).setUint32(0, iteracoes);
  return new Blob([MAGIA, it, sal, iv, cifrado], { type: 'application/octet-stream' });
}

export async function eCifrada(f: Blob): Promise<boolean> {
  if (f.size < MAGIA.length) return false;
  const cab = new Uint8Array(await f.slice(0, MAGIA.length).arrayBuffer());
  return cab.every((b, i) => b === MAGIA[i]);
}

export async function decifrar(f: Blob, palavraPasse: string): Promise<Blob> {
  const buf = new Uint8Array(await f.arrayBuffer()) as Uint8Array<ArrayBuffer>;
  const o = MAGIA.length;
  const iteracoes = new DataView(buf.buffer, buf.byteOffset + o, 4).getUint32(0);
  if (iteracoes < 100_000 || iteracoes > 10_000_000) throw new ErroPalavraPasse('Cópia cifrada inválida.');
  const sal = buf.slice(o + 4, o + 20);
  const iv = buf.slice(o + 20, o + 32);
  try {
    const k = await chave(palavraPasse, sal, iteracoes, 'decrypt');
    return new Blob([await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, k, buf.slice(o + 32))], { type: 'application/zip' });
  } catch {
    throw new ErroPalavraPasse('Palavra-passe errada ou ficheiro alterado.');
  }
}
