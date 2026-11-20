import type { Equipamento, Lembrete, Manutencao, OfficeDB } from './schema';
import { diasAte, DIAS_AVISO_GARANTIA } from './garantia';
import { agora, novoId } from './repo';
import { normalizarData } from './repo';

const dataIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const hojeIso = (hoje = new Date()) => dataIso(hoje);

/** Soma dias a uma data AAAA-MM-DD (negativo = antes). */
export function somarDias(data: string, dias: number): string {
  const [y, m, d] = data.split('-').map(Number);
  return dataIso(new Date(y, m - 1, d + dias));
}

export interface DadosLembrete { titulo: string; data: string; antecedenciaDias?: number | string; notas?: string; equipamentoId?: string | null }

function validar(d: DadosLembrete) {
  const titulo = d.titulo.trim();
  if (!titulo) throw new Error('O título é obrigatório.');
  const data = normalizarData(d.data, 'Data');
  if (!data) throw new Error('Escolhe a data.');
  const ant = d.antecedenciaDias === '' || d.antecedenciaDias === undefined ? 0 : Number(d.antecedenciaDias);
  if (!Number.isInteger(ant) || ant < 0 || ant > 365) throw new Error('Antecedência: indica um número de dias entre 0 e 365.');
  return { titulo, data, antecedenciaDias: ant, notas: d.notas ?? '', equipamentoId: d.equipamentoId || null };
}

export async function criarLembrete(db: OfficeDB, dados: DadosLembrete): Promise<Lembrete> {
  const v = validar(dados);
  if (v.equipamentoId && !(await db.equipamentos.get(v.equipamentoId))) throw new Error('O equipamento não existe.');
  const t = agora();
  const reg: Lembrete = { id: novoId(), createdAt: t, updatedAt: t, deletedAt: null, ...v, estado: 'pendente' };
  await db.lembretes.add(reg);
  return reg;
}

async function pendente(db: OfficeDB, id: string): Promise<Lembrete> {
  const l = await db.lembretes.get(id);
  if (!l || l.deletedAt) throw new Error('O lembrete não existe.');
  if (l.estado !== 'pendente') throw new Error('O lembrete já foi concluído ou cancelado.');
  return l;
}

export async function atualizarLembrete(db: OfficeDB, id: string, dados: DadosLembrete): Promise<void> {
  await pendente(db, id);
  await db.lembretes.update(id, { ...validar(dados), updatedAt: agora() });
}
export async function concluirLembrete(db: OfficeDB, id: string): Promise<void> {
  await pendente(db, id);
  await db.lembretes.update(id, { estado: 'feito', updatedAt: agora() });
}
export async function cancelarLembrete(db: OfficeDB, id: string): Promise<void> {
  await pendente(db, id);
  await db.lembretes.update(id, { estado: 'cancelado', updatedAt: agora() });
}
/** Adiar = mudar a data; o aviso acompanha-a (mesma antecedência). */
export async function adiarLembrete(db: OfficeDB, id: string, novaData: string): Promise<void> {
  const l = await pendente(db, id);
  const data = normalizarData(novaData, 'Data');
  if (!data) throw new Error('Escolhe a data.');
  await db.lembretes.update(id, { data, updatedAt: agora(), notas: l.notas });
}

export type TipoEvento = 'garantia' | 'lembrete' | 'manutencao';

export interface Evento {
  chave: string;
  tipo: TipoEvento;
  data: string;
  /** A partir deste dia aparece nos alertas do Início. */
  alertaDesde: string;
  titulo: string;
  detalhe: string;
  rota: string;
  /** Equipamento ligado (para filtrar). */
  equipamentoId?: string | null;
}

export function eventosAgenda(equips: Equipamento[], lembretes: Lembrete[], nomeEquip: (id: string | null) => string, manutencoes: Manutencao[] = []): Evento[] {
  const ev: Evento[] = [];
  for (const e of equips) {
    if (e.deletedAt || e.estado === 'abatido' || !e.fimGarantia) continue;
    ev.push({
      chave: `g-${e.id}`, tipo: 'garantia', data: e.fimGarantia, alertaDesde: somarDias(e.fimGarantia, -DIAS_AVISO_GARANTIA),
      titulo: `Fim da garantia: ${e.nome}`, detalhe: e.codigo, rota: `/equipamentos/${e.id}`, equipamentoId: e.id
    });
  }
  for (const l of lembretes) {
    if (l.deletedAt || l.estado !== 'pendente') continue;
    ev.push({
      chave: `l-${l.id}`, tipo: 'lembrete', data: l.data, alertaDesde: somarDias(l.data, -l.antecedenciaDias),
      titulo: l.titulo, detalhe: nomeEquip(l.equipamentoId), rota: `/agenda/${l.id}`, equipamentoId: l.equipamentoId
    });
  }
  for (const m of manutencoes) {
    if (m.deletedAt || m.estado !== 'ativa') continue;
    ev.push({
      chave: `m-${m.id}`, tipo: 'manutencao', data: m.proximaData, alertaDesde: somarDias(m.proximaData, -m.antecedenciaDias),
      titulo: m.titulo, detalhe: nomeEquip(m.equipamentoId), rota: `/equipamentos/${m.equipamentoId}`, equipamentoId: m.equipamentoId
    });
  }
  return ev.sort((a, b) => a.data.localeCompare(b.data));
}

/** Eventos cujo aviso já começou. Garantias muito antigas (> 30 dias de expiradas) deixam de avisar. */
export function alertasAtivos(eventos: Evento[], hoje = new Date()): Evento[] {
  const h = hojeIso(hoje);
  return eventos.filter((e) => h >= e.alertaDesde && !(e.tipo === 'garantia' && diasAte(e.data, hoje) < -30));
}

export type Grupo = 'atrasado' | 'semana' | 'mes' | 'depois';
export function grupoDe(data: string, hoje = new Date()): Grupo {
  const d = diasAte(data, hoje);
  return d < 0 ? 'atrasado' : d <= 7 ? 'semana' : d <= 31 ? 'mes' : 'depois';
}

const pad = (n: number) => String(n).padStart(2, '0');
const isoDe = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** Grelha do mês (semanas de segunda a domingo); dias de fora do mês incluídos para completar as semanas. */
export function grelhaMes(ano: number, mes: number): { data: string; doMes: boolean }[][] {
  const primeiro = new Date(Date.UTC(ano, mes - 1, 1));
  const desloc = (primeiro.getUTCDay() + 6) % 7; // segunda = 0
  const inicio = new Date(Date.UTC(ano, mes - 1, 1 - desloc));
  const semanas: { data: string; doMes: boolean }[][] = [];
  const d = new Date(inicio);
  do {
    const semana: { data: string; doMes: boolean }[] = [];
    for (let i = 0; i < 7; i++) { semana.push({ data: isoDe(d), doMes: d.getUTCMonth() === mes - 1 }); d.setUTCDate(d.getUTCDate() + 1); }
    semanas.push(semana);
  } while (d.getUTCMonth() === mes - 1);
  return semanas;
}

/** Os 7 dias (segunda a domingo) da semana que contém `data` (AAAA-MM-DD). */
export function diasDaSemana(data: string): string[] {
  const d = new Date(`${data}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => { const x = new Date(d); x.setUTCDate(d.getUTCDate() + i); return isoDe(x); });
}
