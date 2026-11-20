import type { Nota, OfficeDB } from './schema';
import { agora, novoId } from './repo';

export const MAX_NOTA = 2000;
const MAX_TITULO = 80;

export async function criarNota(db: OfficeDB, texto: string): Promise<Nota> {
  const t = texto.trim();
  if (!t) throw new Error('Escreve a nota primeiro.');
  if (t.length > MAX_NOTA) throw new Error(`A nota é demasiado longa (máx. ${MAX_NOTA} caracteres).`);
  const h = agora();
  const n: Nota = { id: novoId(), createdAt: h, updatedAt: h, deletedAt: null, texto: t, estado: 'aberta', destinoTipo: null, destinoId: null };
  await db.notas.add(n);
  return n;
}

async function aberta(db: OfficeDB, id: string): Promise<Nota> {
  const n = await db.notas.get(id);
  if (!n || n.deletedAt) throw new Error('A nota não existe.');
  if (n.estado !== 'aberta') throw new Error('Esta nota já foi tratada.');
  return n;
}

/** Liga a nota ao registo que nasceu dela. Só uma vez. */
export async function marcarNotaTratada(db: OfficeDB, id: string, destinoTipo: 'anomalia' | 'lembrete', destinoId: string): Promise<void> {
  await aberta(db, id);
  await db.notas.update(id, { estado: 'tratada', destinoTipo, destinoId, updatedAt: agora() });
}

/** Arquivar = já não interessa (fica guardada, sai do Início). */
export async function arquivarNota(db: OfficeDB, id: string): Promise<void> {
  await aberta(db, id);
  await db.notas.update(id, { estado: 'arquivada', updatedAt: agora() });
}

export async function notasAbertas(db: OfficeDB): Promise<Nota[]> {
  return (await db.notas.where('estado').equals('aberta').filter((n) => !n.deletedAt).toArray()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Título curto (1.ª linha, até 80 caracteres) e o texto completo como descrição quando não cabe no título. */
export function dividirNota(texto: string): { titulo: string; descricao: string } {
  const t = texto.trim();
  const primeira = t.split('\n')[0].trim();
  const titulo = primeira.length > MAX_TITULO ? `${primeira.slice(0, MAX_TITULO - 1).trimEnd()}…` : primeira;
  return { titulo, descricao: titulo === t ? '' : t };
}

/** Caminho do formulário já preenchido a partir da nota. O utilizador completa e confirma (ex.: prioridade). */
export function rotaConverter(n: Nota, destino: 'anomalia' | 'lembrete'): string {
  const { titulo, descricao } = dividirNota(n.texto);
  const q = new URLSearchParams({ nota: n.id, titulo });
  if (descricao) q.set('descricao', descricao);
  return destino === 'anomalia' ? `/anomalias/nova?${q}` : `/agenda/novo?${q}`;
}

/** Divide um ditado em título (1.ª frase, até 80) e descrição (o texto todo, se não couber no título). */
export function dividirDitado(texto: string): { titulo: string; descricao: string } {
  const t = texto.trim().replace(/\s+/g, ' ');
  const frase = (t.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? t).trim();
  const titulo = dividirNota(frase).titulo;
  return { titulo, descricao: titulo === t ? '' : t };
}
