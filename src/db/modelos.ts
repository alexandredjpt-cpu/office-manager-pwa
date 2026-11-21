import type { ModeloEmail, OfficeDB } from './schema';
import { agora, novoId } from './repo';

export async function guardarModelo(db: OfficeDB, id: string | null, d: { nome: string; assunto: string; corpo: string; canal?: 'email' | 'whatsapp' }): Promise<ModeloEmail> {
  const nome = d.nome.trim();
  if (!nome) throw new Error('O modelo precisa de um nome.');
  if (!d.assunto.trim() && !d.corpo.trim()) throw new Error('Escreve o assunto ou o texto.');
  const canal = d.canal ?? 'email';
  const t = agora();
  if (id) {
    const m = await db.modelosEmail.get(id);
    if (!m || m.deletedAt) throw new Error('O modelo não existe.');
    await db.modelosEmail.update(id, { nome, assunto: d.assunto, corpo: d.corpo, canal, updatedAt: t });
    return { ...m, nome, assunto: d.assunto, corpo: d.corpo, canal, updatedAt: t };
  }
  const m: ModeloEmail = { id: novoId(), createdAt: t, updatedAt: t, deletedAt: null, nome, assunto: d.assunto, corpo: d.corpo, canal };
  await db.modelosEmail.add(m);
  return m;
}

export async function removerModelo(db: OfficeDB, id: string): Promise<void> {
  const n = await db.modelosEmail.update(id, { deletedAt: agora(), updatedAt: agora() });
  if (!n) throw new Error('O modelo não existe.');
}
