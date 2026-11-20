import type { Artigo, ContagemStock, Kit, KitArtigo, KitLocal, OfficeDB } from './schema';
import { agora, novoId } from './repo';

function nomeValido(nome: string): string {
  const n = nome.trim();
  if (!n) throw new Error('O nome do kit é obrigatório.');
  if (n.length > 60) throw new Error('O nome do kit é demasiado longo (máx. 60).');
  return n;
}

function alvoValido(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) throw new Error('A quantidade-alvo tem de ser um número igual ou superior a 0.');
  return Math.round(n * 100) / 100;
}

async function kitAtivo(db: OfficeDB, id: string): Promise<Kit> {
  const k = await db.kits.get(id);
  if (!k || k.deletedAt) throw new Error('O kit não existe.');
  return k;
}

export async function criarKit(db: OfficeDB, d: { nome: string; notas?: string }): Promise<Kit> {
  const nome = nomeValido(d.nome);
  const ativos = await db.kits.filter((k) => !k.deletedAt).toArray();
  if (ativos.some((k) => k.nome.toLowerCase() === nome.toLowerCase())) throw new Error('Já existe um kit com este nome.');
  const t = agora();
  const k: Kit = { id: novoId(), createdAt: t, updatedAt: t, deletedAt: null, nome, notas: (d.notas ?? '').trim(), artigos: [] };
  await db.kits.add(k);
  return k;
}

export async function atualizarKit(db: OfficeDB, id: string, d: { nome: string; notas?: string }): Promise<void> {
  await kitAtivo(db, id);
  const nome = nomeValido(d.nome);
  const outros = await db.kits.filter((k) => !k.deletedAt && k.id !== id).toArray();
  if (outros.some((k) => k.nome.toLowerCase() === nome.toLowerCase())) throw new Error('Já existe um kit com este nome.');
  await db.kits.update(id, { nome, notas: (d.notas ?? '').trim(), updatedAt: agora() });
}

/** Arquiva o kit e desliga-o dos locais. Nenhuma contagem é tocada. */
export async function arquivarKit(db: OfficeDB, id: string): Promise<void> {
  await kitAtivo(db, id);
  const t = agora();
  await db.transaction('rw', db.kits, db.kitLocais, async () => {
    await db.kits.update(id, { deletedAt: t, updatedAt: t });
    const lig = await db.kitLocais.where('kitId').equals(id).filter((x) => !x.deletedAt).toArray();
    for (const l of lig) await db.kitLocais.update(l.id, { deletedAt: t, updatedAt: t });
  });
}

export async function adicionarArtigoAoKit(db: OfficeDB, kitId: string, artigoId: string, alvo: number | string | null = null): Promise<void> {
  const k = await kitAtivo(db, kitId);
  const a = await db.artigos.get(artigoId);
  if (!a || a.deletedAt) throw new Error('O artigo não existe.');
  if (k.artigos.some((x) => x.artigoId === artigoId)) throw new Error('Este artigo já está no kit.');
  await db.kits.update(kitId, { artigos: [...k.artigos, { artigoId, alvo: alvoValido(alvo) }], updatedAt: agora() });
}

export async function removerArtigoDoKit(db: OfficeDB, kitId: string, artigoId: string): Promise<void> {
  const k = await kitAtivo(db, kitId);
  await db.kits.update(kitId, { artigos: k.artigos.filter((x) => x.artigoId !== artigoId), updatedAt: agora() });
}

export async function definirAlvoKit(db: OfficeDB, kitId: string, artigoId: string, alvo: number | string | null): Promise<void> {
  const k = await kitAtivo(db, kitId);
  if (!k.artigos.some((x) => x.artigoId === artigoId)) throw new Error('Este artigo não está no kit.');
  const v = alvoValido(alvo);
  await db.kits.update(kitId, { artigos: k.artigos.map((x) => (x.artigoId === artigoId ? { ...x, alvo: v } : x)), updatedAt: agora() });
}

/**
 * Define exatamente em que locais o kit está aplicado: acrescenta os novos e retira os que saíram.
 * Idempotente; não cria contagens (os artigos ficam «por contar» até os contares).
 */
export async function definirLocaisDoKit(db: OfficeDB, kitId: string, localIds: string[]): Promise<void> {
  await kitAtivo(db, kitId);
  const quer = new Set(localIds);
  const locais = await db.localizacoes.bulkGet([...quer]);
  if (locais.some((l) => !l || l.deletedAt)) throw new Error('Escolhe apenas locais válidos.');
  const t = agora();
  await db.transaction('rw', db.kitLocais, async () => {
    const existentes = await db.kitLocais.where('kitId').equals(kitId).toArray();
    const ativos = new Map(existentes.filter((x) => !x.deletedAt).map((x) => [x.localizacaoId, x]));
    for (const [loc, x] of ativos) if (!quer.has(loc)) await db.kitLocais.update(x.id, { deletedAt: t, updatedAt: t });
    for (const loc of quer) {
      if (ativos.has(loc)) continue;
      const antigo = existentes.find((x) => x.localizacaoId === loc && x.deletedAt);
      if (antigo) await db.kitLocais.update(antigo.id, { deletedAt: null, updatedAt: t });
      else await db.kitLocais.add({ id: novoId(), createdAt: t, updatedAt: t, deletedAt: null, kitId, localizacaoId: loc } satisfies KitLocal);
    }
  });
}

// ───────────── cálculo (funções puras) ─────────────

export interface LinhaKitLocal {
  artigo: Artigo;
  alvo: number | null;
  /** null = ainda por contar neste local. */
  quantidade: number | null;
  abaixoAlvo: boolean;
}

function ultimaPorLocal(contagens: ContagemStock[], artigoId: string, localId: string): ContagemStock | null {
  let r: ContagemStock | null = null;
  for (const c of contagens) {
    if (c.deletedAt || c.artigoId !== artigoId || c.localizacaoId !== localId) continue;
    if (!r || c.createdAt > r.createdAt) r = c;
  }
  return r;
}

/** Linhas de um kit num local. Artigos arquivados ficam de fora. */
export function linhasKitNoLocal(kit: Kit, artigos: Artigo[], contagens: ContagemStock[], localId: string): LinhaKitLocal[] {
  const porId = new Map(artigos.filter((a) => !a.deletedAt).map((a) => [a.id, a]));
  return kit.artigos.flatMap((ka: KitArtigo) => {
    const artigo = porId.get(ka.artigoId);
    if (!artigo) return [];
    const c = ultimaPorLocal(contagens, ka.artigoId, localId);
    const quantidade = c ? c.quantidade : null;
    return [{ artigo, alvo: ka.alvo, quantidade, abaixoAlvo: quantidade !== null && ka.alvo !== null && quantidade < ka.alvo }];
  }).sort((a, b) => a.artigo.nome.localeCompare(b.artigo.nome, 'pt'));
}

/** Nº de locais onde o artigo está num kit aplicado mas ainda não foi contado (o total pode estar subavaliado). */
export function locaisPorContar(artigoId: string, kits: Kit[], ligacoes: KitLocal[], contagens: ContagemStock[]): number {
  const kitsAtivos = new Map(kits.filter((k) => !k.deletedAt).map((k) => [k.id, k]));
  const locais = new Set<string>();
  for (const l of ligacoes) {
    if (l.deletedAt) continue;
    const k = kitsAtivos.get(l.kitId);
    if (k && k.artigos.some((x) => x.artigoId === artigoId)) locais.add(l.localizacaoId);
  }
  let n = 0;
  for (const loc of locais) if (!ultimaPorLocal(contagens, artigoId, loc)) n++;
  return n;
}
