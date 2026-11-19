import type { Equipamento, Lembrete, OfficeDB } from './schema';
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
}

export function eventosAgenda(equips: Equipamento[], lembretes: Lembrete[], nomeEquip: (id: string | null) => string): Evento[] {
  const ev: Evento[] = [];
  for (const e of equips) {
    if (e.deletedAt || e.estado === 'abatido' || !e.fimGarantia) continue;
    ev.push({
      chave: `g-${e.id}`, tipo: 'garantia', data: e.fimGarantia, alertaDesde: somarDias(e.fimGarantia, -DIAS_AVISO_GARANTIA),
      titulo: `Fim da garantia: ${e.nome}`, detalhe: e.codigo, rota: `/equipamentos/${e.id}`
    });
  }
  for (const l of lembretes) {
    if (l.deletedAt || l.estado !== 'pendente') continue;
    ev.push({
      chave: `l-${l.id}`, tipo: 'lembrete', data: l.data, alertaDesde: somarDias(l.data, -l.antecedenciaDias),
      titulo: l.titulo, detalhe: nomeEquip(l.equipamentoId), rota: `/agenda/${l.id}`
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
