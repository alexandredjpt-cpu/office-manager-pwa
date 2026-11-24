import type { Contacto, OfficeDB } from './schema';
import { agora, novoId } from './repo';
import { numeroWhatsApp } from './emails';

export interface DadosContacto { nome: string; funcao?: string; email?: string; telefone?: string; aprovador?: boolean; fornecedorId?: string | null; email2?: string; telefone2?: string }

async function validar(db: OfficeDB, d: DadosContacto) {
  const nome = d.nome.trim();
  if (!nome) throw new Error('O nome é obrigatório.');
  const email = (d.email ?? '').trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('E-mail inválido.');
  const telefone = (d.telefone ?? '').trim();
  if (telefone && !numeroWhatsApp(telefone)) throw new Error('Telefone inválido. Usa 9 dígitos ou o formato +351…');
  const email2 = (d.email2 ?? '').trim();
  if (email2 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email2)) throw new Error('Segundo e-mail inválido.');
  if (email2 && email2.toLowerCase() === email.toLowerCase()) throw new Error('O segundo e-mail é igual ao primeiro.');
  const telefone2 = (d.telefone2 ?? '').trim();
  if (telefone2 && !numeroWhatsApp(telefone2)) throw new Error('Segundo telefone inválido. Usa 9 dígitos ou o formato +351…');
  if (telefone2 && telefone && numeroWhatsApp(telefone2) === numeroWhatsApp(telefone)) throw new Error('O segundo telefone é igual ao primeiro.');
  const fornecedorId = d.fornecedorId || null;
  if (fornecedorId) {
    const f = await db.fornecedores.get(fornecedorId);
    if (!f || f.deletedAt) throw new Error('O fornecedor não existe.');
  }
  return { nome, funcao: (d.funcao ?? '').trim(), email, telefone, aprovador: d.aprovador === true, fornecedorId, email2, telefone2 };
}

export async function criarContacto(db: OfficeDB, d: DadosContacto): Promise<Contacto> {
  const v = await validar(db, d);
  const ativos = await db.contactos.filter((c) => !c.deletedAt && (c.fornecedorId ?? null) === v.fornecedorId).toArray();
  if (ativos.some((c) => c.nome.toLowerCase() === v.nome.toLowerCase())) throw new Error('Já existe um contacto com este nome nesta empresa.');
  const t = agora();
  const c: Contacto = { id: novoId(), createdAt: t, updatedAt: t, deletedAt: null, ...v };
  await db.contactos.add(c);
  return c;
}

export async function atualizarContacto(db: OfficeDB, id: string, d: DadosContacto): Promise<void> {
  const c = await db.contactos.get(id);
  if (!c || c.deletedAt) throw new Error('O contacto não existe.');
  const v = await validar(db, d);
  const outros = await db.contactos.filter((x) => !x.deletedAt && x.id !== id && (x.fornecedorId ?? null) === v.fornecedorId).toArray();
  if (outros.some((x) => x.nome.toLowerCase() === v.nome.toLowerCase())) throw new Error('Já existe um contacto com este nome nesta empresa.');
  await db.contactos.update(id, { ...v, updatedAt: agora() });
}

/** Arquiva (lógico). As encomendas que o referem mantêm o registo no histórico. */
export async function arquivarContacto(db: OfficeDB, id: string): Promise<void> {
  const n = await db.contactos.update(id, { deletedAt: agora(), updatedAt: agora() });
  if (!n) throw new Error('O contacto não existe.');
}
