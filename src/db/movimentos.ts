import type { MovimentoStock, OfficeDB, TipoMovimento } from './schema';
import { agora, novoId, normalizarData } from './repo';
import { gravarContagem } from './stock';
import { hojeIso } from './agenda';

export const TIPOS_MOVIMENTO: Record<TipoMovimento, string> = { transferencia: 'Transferência', perda: 'Perda', dano: 'Danificado', ajuste: 'Ajuste', entrada: 'Entrada (receção)' };

export interface DadosMovimento {
  artigoId: string;
  tipo: TipoMovimento;
  quantidade: number | string;
  /** Local de onde sai (transferência, perda, dano) ou onde se ajusta. */
  origemId: string;
  destinoId?: string;
  motivo: string;
  responsavel?: string;
  data?: string;
  rececaoId?: string | null;
}

const arred = (n: number) => Math.round(n * 1000) / 1000;

async function atual(db: OfficeDB, artigoId: string, localId: string): Promise<number> {
  const cs = (await db.contagensStock.where('[artigoId+localizacaoId]').equals([artigoId, localId]).toArray()).filter((c) => !c.deletedAt);
  return cs.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)).at(-1)?.quantidade ?? 0;
}

/**
 * Regista um movimento e gera as contagens correspondentes (ligadas por `movimentoId`).
 * Não deixa o stock de um local ficar negativo nem retirar mais do que existe.
 */
export async function registarMovimento(db: OfficeDB, d: DadosMovimento): Promise<MovimentoStock> {
  if (d.tipo === 'entrada') throw new Error('As entradas só se registam através da receção de uma encomenda.');
  return db.transaction('rw', [db.artigos, db.localizacoes, db.contagensStock, db.movimentosStock], () => aplicarMovimento(db, d));
}

/** Corre dentro de uma transação que inclua artigos, localizações, contagens e movimentos. */
export async function aplicarMovimento(db: OfficeDB, d: DadosMovimento): Promise<MovimentoStock> {
  const motivo = d.motivo.trim();
  if (!motivo) throw new Error('Indica o motivo.');
  const q = Number(String(d.quantidade).replace(',', '.'));
  if (!Number.isFinite(q) || q === 0) throw new Error('Quantidade inválida.');
  if (d.tipo !== 'ajuste' && q < 0) throw new Error('A quantidade tem de ser positiva.');
  const data = d.data ? normalizarData(d.data, 'Data') : hojeIso();
  if (!data) throw new Error('Escolhe a data.');
  if (!d.origemId) throw new Error('Escolhe o local.');
  if (d.tipo === 'transferencia') {
    if (!d.destinoId) throw new Error('Escolhe o local de destino.');
    if (d.destinoId === d.origemId) throw new Error('Origem e destino têm de ser diferentes.');
  }

  {
    const t = agora();
    const mov: MovimentoStock = {
      id: novoId(), createdAt: t, updatedAt: t, deletedAt: null,
      artigoId: d.artigoId, tipo: d.tipo, quantidade: arred(q), origemId: d.origemId,
      destinoId: d.tipo === 'transferencia' ? d.destinoId! : null,
      motivo, responsavel: (d.responsavel ?? '').trim(), data, rececaoId: d.rececaoId ?? null
    };
    const nome = async (id: string) => (await db.localizacoes.get(id))?.nome ?? '?';
    const nota = `${TIPOS_MOVIMENTO[d.tipo]}: ${motivo}`;
    const aOrigem = await atual(db, d.artigoId, d.origemId);
    const delta = d.tipo === 'ajuste' || d.tipo === 'entrada' ? q : -q; // efeito na origem
    if (aOrigem + delta < 0) throw new Error(`Só há ${aOrigem} neste local; não dá para retirar ${Math.abs(delta)}.`);
    await gravarContagem(db, d.artigoId, d.origemId, arred(aOrigem + delta), d.tipo === 'transferencia' ? `${nota} → ${await nome(d.destinoId!)}` : nota, mov.id);
    if (d.tipo === 'transferencia') {
      const aDestino = await atual(db, d.artigoId, d.destinoId!);
      await gravarContagem(db, d.artigoId, d.destinoId!, arred(aDestino + q), `${nota} ← ${await nome(d.origemId)}`, mov.id);
    }
    await db.movimentosStock.add(mov);
    return mov;
  }
}

/** Anula um movimento (lógico) e as suas contagens, só se nenhuma contagem posterior as tiver sucedido. */
export async function anularMovimento(db: OfficeDB, id: string): Promise<void> {
  await db.transaction('rw', [db.contagensStock, db.movimentosStock], async () => {
    const m = await db.movimentosStock.get(id);
    if (!m || m.deletedAt) throw new Error('O movimento não existe.');
    if (m.rececaoId) throw new Error('Esta entrada veio de uma receção de encomenda. Para corrigir, regista um ajuste.');
    const geradas = (await db.contagensStock.filter((c) => c.movimentoId === id && !c.deletedAt).toArray());
    for (const g of geradas) {
      const ativas = (await db.contagensStock.where('[artigoId+localizacaoId]').equals([g.artigoId, g.localizacaoId]).toArray()).filter((c) => !c.deletedAt);
      if (ativas.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)).at(-1)?.id !== g.id)
        throw new Error('Já houve contagens ou movimentos posteriores neste artigo/local. Regista um movimento de sentido contrário em vez de anular.');
    }
    const t = agora();
    for (const g of geradas) await db.contagensStock.update(g.id, { deletedAt: t, updatedAt: t });
    await db.movimentosStock.update(id, { deletedAt: t, updatedAt: t });
  });
}
