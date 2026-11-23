import type { Marcador, OfficeDB, PontoZona, Zona } from './schema';
import { agora, novoId } from './repo';

export const MIN_PONTOS = 3;
export const MAX_PONTOS = 60;
export const MAX_NOME_ZONA = 40;
/** Zoom máximo da planta (16 = 1600%). */
export const ZOOM_MAX = 16;
/** Degraus dos botões + e −. */
export const DEGRAUS_ZOOM = [1, 1.5, 2, 3, 4, 6, 8, 12, 16] as const;
/** Plantas acima disto pesam no telemóvel (cada megapíxel ≈ 4 MB de memória quando aberta). */
export const MP_AVISO = 40;
export const MP_RECUSA = 100;

const dentroDe01 = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;

// ---------- Geometria (pura) ----------

/** Área (em frações²) pelo método do laço. */
export function areaZona(p: PontoZona[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length;
    a += p[i].x * p[j].y - p[j].x * p[i].y;
  }
  return Math.abs(a) / 2;
}

export function caixaZona(p: PontoZona[]): { x0: number; y0: number; x1: number; y1: number; cx: number; cy: number } {
  const xs = p.map((q) => q.x), ys = p.map((q) => q.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

/** Ponto dentro do contorno (raio para a direita). */
export function pontoNaZona(q: PontoZona, p: PontoZona[]): boolean {
  let dentro = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i], b = p[j];
    if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) dentro = !dentro;
  }
  return dentro;
}

function orient(a: PontoZona, b: PontoZona, c: PontoZona): number {
  const v = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return Math.abs(v) < 1e-12 ? 0 : Math.sign(v);
}
function noSegmento(a: PontoZona, b: PontoZona, c: PontoZona): boolean {
  return Math.min(a.x, b.x) - 1e-12 <= c.x && c.x <= Math.max(a.x, b.x) + 1e-12 && Math.min(a.y, b.y) - 1e-12 <= c.y && c.y <= Math.max(a.y, b.y) + 1e-12;
}
function segmentosCruzam(p1: PontoZona, p2: PontoZona, p3: PontoZona, p4: PontoZona): boolean {
  const d1 = orient(p3, p4, p1), d2 = orient(p3, p4, p2), d3 = orient(p1, p2, p3), d4 = orient(p1, p2, p4);
  if (d1 !== d2 && d3 !== d4) return true;
  return (d1 === 0 && noSegmento(p3, p4, p1)) || (d2 === 0 && noSegmento(p3, p4, p2)) || (d3 === 0 && noSegmento(p1, p2, p3)) || (d4 === 0 && noSegmento(p1, p2, p4));
}

/** O contorno cruza-se a si próprio? (lados não vizinhos que se tocam) */
export function contornoCruzado(p: PontoZona[]): boolean {
  const n = p.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue; // lados vizinhos partilham um ponto
      if (segmentosCruzam(p[i], p[(i + 1) % n], p[j], p[(j + 1) % n])) return true;
    }
  }
  return false;
}

/** Valida e devolve uma cópia limpa dos pontos (só x e y). */
export function validarPontos(pontos: PontoZona[]): PontoZona[] {
  if (!Array.isArray(pontos) || pontos.length < MIN_PONTOS) throw new Error(`Uma zona precisa de pelo menos ${MIN_PONTOS} pontos.`);
  if (pontos.length > MAX_PONTOS) throw new Error(`Uma zona pode ter no máximo ${MAX_PONTOS} pontos.`);
  const limpos = pontos.map((q) => ({ x: q.x, y: q.y }));
  if (!limpos.every((q) => dentroDe01(q.x) && dentroDe01(q.y))) throw new Error('Há pontos fora da planta.');
  if (contornoCruzado(limpos)) throw new Error('O contorno cruza-se a si próprio. Arrasta os pontos para que as linhas não se cruzem.');
  if (areaZona(limpos) < 1e-6) throw new Error('A zona é demasiado pequena (os pontos estão quase em linha).');
  return limpos;
}

/** Zona tocada: a mais pequena que contém o ponto (zonas podem sobrepor-se). */
export function zonaEm<T extends { pontos: PontoZona[] }>(zonas: T[], q: PontoZona): T | undefined {
  return zonas.filter((z) => pontoNaZona(q, z.pontos)).sort((a, b) => areaZona(a.pontos) - areaZona(b.pontos))[0];
}

/**
 * Zoom para a zona ocupar ~85% da caixa. A imagem é mostrada com a largura da caixa × zoom.
 * `larguraCaixa`/`alturaCaixa` em px de ecrã; `imgL`/`imgA` em px da imagem (só a proporção conta).
 */
export function zoomParaZona(p: PontoZona[], larguraCaixa: number, alturaCaixa: number, imgL: number, imgA: number, max = ZOOM_MAX): number {
  const c = caixaZona(p);
  const bw = Math.max(c.x1 - c.x0, 1e-4), bh = Math.max(c.y1 - c.y0, 1e-4);
  const proporcao = imgA / imgL; // altura mostrada = largura mostrada × proporção
  const z = 0.85 * Math.min(1 / bw, alturaCaixa / (larguraCaixa * proporcao * bh));
  return Math.min(max, Math.max(1, z));
}

export type Nitidez = 'boa' | 'aceitavel' | 'baixa';
/** Píxeis da imagem por píxel físico do ecrã. ≥0,75 nítido; ≥0,4 aceitável; abaixo, desfocado. */
export function nitidez(imgL: number, larguraCaixa: number, zoom: number, dpr: number): { nivel: Nitidez; razao: number } {
  const razao = imgL / (larguraCaixa * zoom * Math.max(1, dpr));
  return { nivel: razao >= 0.75 ? 'boa' : razao >= 0.4 ? 'aceitavel' : 'baixa', razao };
}

/** Planta demasiado grande para o telemóvel? */
export function avaliarTamanhoPlanta(l: number, a: number): { nivel: 'ok' | 'aviso' | 'recusa'; mp: number } {
  const mp = (l * a) / 1e6;
  return { nivel: mp > MP_RECUSA ? 'recusa' : mp > MP_AVISO ? 'aviso' : 'ok', mp };
}

export function proximoZoom(z: number, sentido: 1 | -1): number {
  if (sentido > 0) return DEGRAUS_ZOOM.find((d) => d > z + 1e-6) ?? ZOOM_MAX;
  return [...DEGRAUS_ZOOM].reverse().find((d) => d < z - 1e-6) ?? 1;
}

// ---------- Registos ----------

function limparNome(nome: string): string {
  const n = nome.trim().replace(/\s+/g, ' ');
  if (!n) throw new Error('Dá um nome à zona.');
  if (n.length > MAX_NOME_ZONA) throw new Error(`O nome da zona pode ter no máximo ${MAX_NOME_ZONA} caracteres.`);
  return n;
}

async function plantaValida(db: OfficeDB, documentoId: string) {
  const doc = await db.documentos.get(documentoId);
  if (!doc || doc.deletedAt) throw new Error('A planta não existe.');
  if (!doc.mime.startsWith('image/')) throw new Error('A planta tem de ser uma imagem (não PDF).');
  return doc;
}

/** Valida o local a ligar a uma zona: existe, não é o próprio local da planta e não está já noutra zona. '' / null = sem local. */
async function localParaZona(db: OfficeDB, documentoId: string, localizacaoId: string | null | undefined, zonaId: string | null): Promise<string | null> {
  if (!localizacaoId) return null;
  const doc = await plantaValida(db, documentoId);
  const l = await db.localizacoes.get(localizacaoId);
  if (!l || l.deletedAt) throw new Error('O local escolhido não existe.');
  if (doc.entidade === 'localizacao' && doc.entidadeId === localizacaoId) throw new Error('Escolhe outro local (um armário ou centro dentro deste).');
  const outra = (await db.zonas.toArray()).find((z) => !z.deletedAt && z.id !== zonaId && z.localizacaoId === localizacaoId);
  if (outra) throw new Error(`«${l.nome}» já está ligado à zona «${outra.nome}».`);
  return localizacaoId;
}

export async function criarZona(db: OfficeDB, documentoId: string, nome: string, pontos: PontoZona[], localizacaoId: string | null = null): Promise<Zona> {
  const n = limparNome(nome);
  const ps = validarPontos(pontos);
  return db.transaction('rw', [db.documentos, db.zonas, db.localizacoes], async () => {
    await plantaValida(db, documentoId);
    const loc = await localParaZona(db, documentoId, localizacaoId, null);
    const t = agora();
    const z: Zona = { id: novoId(), createdAt: t, updatedAt: t, deletedAt: null, documentoId, nome: n, pontos: ps, ...(loc ? { localizacaoId: loc } : {}) };
    await db.zonas.add(z);
    return z;
  });
}

/** `localizacaoId`: undefined = não mexe; null ou '' = desliga do local. */
export async function atualizarZona(db: OfficeDB, id: string, d: { nome?: string; pontos?: PontoZona[]; localizacaoId?: string | null }): Promise<void> {
  await db.transaction('rw', [db.documentos, db.zonas, db.localizacoes], async () => {
    const z = await db.zonas.get(id);
    if (!z || z.deletedAt) throw new Error('A zona não existe.');
    const mud: Partial<Zona> = { updatedAt: agora() };
    if (d.nome !== undefined) mud.nome = limparNome(d.nome);
    if (d.pontos !== undefined) mud.pontos = validarPontos(d.pontos);
    if (d.localizacaoId !== undefined) mud.localizacaoId = await localParaZona(db, z.documentoId, d.localizacaoId, z.id);
    await db.zonas.update(id, mud);
  });
}

// ---------- O que se vê na planta (puro) ----------

export type Camada = 'zonas' | Marcador['tipo'];
export const CAMADAS: readonly Camada[] = ['zonas', 'local', 'equipamento', 'artigo', 'anomalia'];
/** A partir deste zoom os pontos mostram o nome (abaixo, só o selecionado e os da zona aberta). */
export const ZOOM_ETIQUETAS = 2;

/** Camadas guardadas (JSON). Valor estragado ou ausente = todas ligadas. */
export function lerCamadas(texto: string | null | undefined): Set<Camada> {
  try {
    const v: unknown = texto ? JSON.parse(texto) : null;
    if (Array.isArray(v)) return new Set(v.filter((c): c is Camada => (CAMADAS as readonly string[]).includes(c)));
  } catch { /* fica tudo ligado */ }
  return new Set(CAMADAS);
}

/** Pontos a desenhar: tira os pontos de locais que já são uma zona nesta planta e os das camadas desligadas.
 *  O ponto selecionado e o destacado aparecem sempre. */
export function pontosVisiveis(marcadores: Marcador[], zonas: Zona[], camadas: Set<Camada>, sempre: { sel?: string | null; destaque?: string | null } = {}): Marcador[] {
  const ligados = new Set(zonas.filter((z) => !z.deletedAt && z.localizacaoId).map((z) => z.localizacaoId as string));
  return marcadores.filter((m) => {
    if (m.id === sempre.sel || (sempre.destaque && m.refId === sempre.destaque)) return true;
    if (m.tipo === 'local' && ligados.has(m.refId)) return false;
    return camadas.has(m.tipo);
  });
}

/** Mostra o nome do ponto? Selecionado sempre; com zona aberta, só os de dentro; sem zona aberta, só com zoom ≥ ZOOM_ETIQUETAS. */
export function etiquetaVisivel(o: { selecionado: boolean; zonaAberta: boolean; dentro: boolean; zoom: number }): boolean {
  if (o.selecionado) return true;
  if (o.zonaAberta) return o.dentro;
  return o.zoom >= ZOOM_ETIQUETAS;
}

/** Anulação lógica (a zona continua nas cópias de segurança). Os pontos lá dentro não mudam. */
export async function removerZona(db: OfficeDB, id: string): Promise<void> {
  const n = await db.zonas.update(id, { deletedAt: agora(), updatedAt: agora() });
  if (!n) throw new Error('A zona não existe.');
}

// ---------- Trocar a imagem da planta com alinhamento ----------

export interface Dimensoes { l: number; a: number }
/** Dois pontos de referência (frações) na planta antiga e os mesmos dois na nova. */
export interface ParesAlinhamento { antigo: [PontoZona, PontoZona]; novo: [PontoZona, PontoZona] }

/**
 * Semelhança (escala + rotação + deslocação) que leva os 2 pontos da planta antiga aos 2 da nova,
 * calculada em píxeis para respeitar proporções diferentes. Devolve uma função fração → fração.
 */
export function transformacaoAlinhamento(pares: ParesAlinhamento, antiga: Dimensoes, nova: Dimensoes) {
  const P = pares.antigo.map((p) => ({ x: p.x * antiga.l, y: p.y * antiga.a }));
  const Q = pares.novo.map((p) => ({ x: p.x * nova.l, y: p.y * nova.a }));
  const dp = { x: P[1].x - P[0].x, y: P[1].y - P[0].y };
  const dq = { x: Q[1].x - Q[0].x, y: Q[1].y - Q[0].y };
  const np = Math.hypot(dp.x, dp.y), nq = Math.hypot(dq.x, dq.y);
  if (np < 0.05 * Math.hypot(antiga.l, antiga.a) || nq < 0.05 * Math.hypot(nova.l, nova.a)) {
    throw new Error('Os dois pontos estão muito perto um do outro. Escolhe cantos afastados (por ex. dois cantos opostos do edifício).');
  }
  // a = dq / dp (números complexos); b = Q0 − a·P0
  const den = dp.x * dp.x + dp.y * dp.y;
  const a = { re: (dq.x * dp.x + dq.y * dp.y) / den, im: (dq.y * dp.x - dq.x * dp.y) / den };
  const b = { x: Q[0].x - (a.re * P[0].x - a.im * P[0].y), y: Q[0].y - (a.im * P[0].x + a.re * P[0].y) };
  const escala = Math.hypot(a.re, a.im);
  const rotacaoGraus = (Math.atan2(a.im, a.re) * 180) / Math.PI;
  const aplicar = (p: PontoZona): PontoZona => {
    const X = p.x * antiga.l, Y = p.y * antiga.a;
    return { x: (a.re * X - a.im * Y + b.x) / nova.l, y: (a.im * X + a.re * Y + b.y) / nova.a };
  };
  return { aplicar, escala, rotacaoGraus };
}

const arred = (n: number) => Math.round(n * 1e6) / 1e6;
const ajustar = (n: number) => (n < 0 && n > -1e-4 ? 0 : n > 1 && n < 1 + 1e-4 ? 1 : n);
const ajustarPonto = (p: PontoZona) => ({ x: arred(ajustar(p.x)), y: arred(ajustar(p.y)) });

export interface PrevisaoTroca {
  marcadores: (Marcador & { novo: PontoZona })[];
  zonas: (Zona & { novos: PontoZona[] })[];
  fora: number;
  escala: number;
  rotacaoGraus: number;
}

/** Calcula onde ficam os pontos e zonas na imagem nova, sem gravar nada. */
export function preverTroca(marcadores: Marcador[], zonas: Zona[], pares: ParesAlinhamento, antiga: Dimensoes, nova: Dimensoes): PrevisaoTroca {
  const t = transformacaoAlinhamento(pares, antiga, nova);
  const ms = marcadores.filter((m) => !m.deletedAt).map((m) => ({ ...m, novo: ajustarPonto(t.aplicar(m)) }));
  const zs = zonas.filter((z) => !z.deletedAt).map((z) => ({ ...z, novos: z.pontos.map((p) => ajustarPonto(t.aplicar(p))) }));
  const fora = ms.filter((m) => !dentroDe01(m.novo.x) || !dentroDe01(m.novo.y)).length + zs.filter((z) => z.novos.some((p) => !dentroDe01(p.x) || !dentroDe01(p.y))).length;
  return { marcadores: ms, zonas: zs, fora, escala: t.escala, rotacaoGraus: t.rotacaoGraus };
}

/**
 * Passa os pontos e zonas da planta antiga para a nova (mesmo local), já alinhados,
 * e retira a imagem antiga (anulação lógica: continua nas cópias). Tudo ou nada.
 */
export async function trocarImagemPlanta(db: OfficeDB, antigaId: string, novaId: string, pares: ParesAlinhamento, antiga: Dimensoes, nova: Dimensoes): Promise<{ marcadores: number; zonas: number }> {
  if (antigaId === novaId) throw new Error('Escolhe uma imagem diferente da atual.');
  return db.transaction('rw', [db.documentos, db.marcadores, db.zonas], async () => {
    const dA = await plantaValida(db, antigaId);
    const dN = await plantaValida(db, novaId);
    if (dA.entidade !== 'localizacao' || dN.entidade !== 'localizacao' || dA.entidadeId !== dN.entidadeId) throw new Error('As duas imagens têm de ser plantas do mesmo local.');
    const jaNaNova = (await db.marcadores.where('documentoId').equals(novaId).filter((m) => !m.deletedAt).count()) + (await db.zonas.where('documentoId').equals(novaId).filter((z) => !z.deletedAt).count());
    if (jaNaNova > 0) throw new Error('A imagem nova já tem pontos ou zonas. Escolhe uma imagem nova sem nada marcado.');
    const ms = await db.marcadores.where('documentoId').equals(antigaId).toArray();
    const zs = await db.zonas.where('documentoId').equals(antigaId).toArray();
    const prev = preverTroca(ms, zs, pares, antiga, nova);
    if (prev.fora > 0) throw new Error(`${prev.fora} ponto(s) ou zona(s) ficariam fora da imagem nova. Confirma se tocaste nos mesmos dois cantos nas duas plantas.`);
    const t = agora();
    for (const m of prev.marcadores) await db.marcadores.update(m.id, { documentoId: novaId, x: m.novo.x, y: m.novo.y, updatedAt: t });
    for (const z of prev.zonas) await db.zonas.update(z.id, { documentoId: novaId, pontos: validarPontos(z.novos), updatedAt: t });
    await db.documentos.update(antigaId, { deletedAt: t, updatedAt: t });
    return { marcadores: prev.marcadores.length, zonas: prev.zonas.length };
  });
}
