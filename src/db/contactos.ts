import type { Contacto, OfficeDB } from './schema';
import { agora, novoId } from './repo';
import { numeroWhatsApp } from './emails';

export interface DadosContacto { nome: string; funcao?: string; email?: string; telefone?: string; aprovador?: boolean }

function validar(d: DadosContacto) {
  const nome = d.nome.trim();
  if (!nome) throw new Error('O nome é obrigatório.');
  const email = (d.email ?? '').trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('E-mail inválido.');
  const telefone = (d.telefone ?? '').trim();
  if (telefone && !numeroWhatsApp(telefone)) throw new Error('Telefone inválido. Usa 9 dígitos ou o formato +351…');
  return { nome, funcao: (d.funcao ?? '').trim(), email, telefone, aprovador: d.aprovador === true };
}

export async function criarContacto(db: OfficeDB, d: DadosContacto): Promise<Contacto> {
  const v = validar(d);
  const ativos = await db.contactos.filter((c) => !c.deletedAt).toArray();
  if (ativos.some((c) => c.nome.toLowerCase() === v.nome.toLowerCase())) throw new Error('Já existe um contacto com este nome.');
  const t = agora();
  const c: Contacto = { id: novoId(), createdAt: t, updatedAt: t, deletedAt: null, ...v };
  await db.contactos.add(c);
  return c;
}

export async function atualizarContacto(db: OfficeDB, id: string, d: DadosContacto): Promise<void> {
  const c = await db.contactos.get(id);
  if (!c || c.deletedAt) throw new Error('O contacto não existe.');
  const v = validar(d);
  const outros = await db.contactos.filter((x) => !x.deletedAt && x.id !== id).toArray();
  if (outros.some((x) => x.nome.toLowerCase() === v.nome.toLowerCase())) throw new Error('Já existe um contacto com este nome.');
  await db.contactos.update(id, { ...v, updatedAt: agora() });
}

/** Arquiva (lógico). As encomendas que o referem mantêm o registo no histórico. */
export async function arquivarContacto(db: OfficeDB, id: string): Promise<void> {
  const n = await db.contactos.update(id, { deletedAt: agora(), updatedAt: agora() });
  if (!n) throw new Error('O contacto não existe.');
}
