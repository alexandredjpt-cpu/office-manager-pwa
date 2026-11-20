import type { Anomalia, Atividade, Artigo, ContagemStock, Encomenda, EncomendaEvento, Execucao, Inspecao, Localizacao, Manutencao, MovimentoStock } from './schema';
import { TIPOS_MOVIMENTO } from './movimentos';

export interface ItemAtividade { quando: string; texto: string; rota: string }

export interface DadosAtividade {
  anomalias: Anomalia[]; atividades: Atividade[]; contagens: ContagemStock[]; movimentos: MovimentoStock[];
  encomendas: Encomenda[]; encomendaEventos: EncomendaEvento[]; execucoes: Execucao[]; inspecoes: Inspecao[];
  artigos: Artigo[]; locais: Localizacao[]; manutencoes: Manutencao[];
}

/** As últimas ações registadas (de todas as áreas), mais recentes primeiro. Nada é inventado: só o que está nos registos. */
export function atividadeRecente(d: DadosAtividade, limite = 8): ItemAtividade[] {
  const art = (id: string) => d.artigos.find((a) => a.id === id)?.nome ?? '?';
  const loc = (id: string) => d.locais.find((l) => l.id === id)?.nome ?? '?';
  const anom = (id: string) => d.anomalias.find((a) => a.id === id);
  const enc = (id: string) => d.encomendas.find((e) => e.id === id);
  const man = (id: string) => d.manutencoes.find((m) => m.id === id);
  const itens: ItemAtividade[] = [];

  for (const a of d.anomalias) if (!a.deletedAt) itens.push({ quando: a.createdAt, texto: `Anomalia ${a.codigo} registada: ${a.titulo}`, rota: `/anomalias/${a.id}` });
  for (const x of d.atividades) {
    const a = anom(x.anomaliaId);
    if (x.deletedAt || !a || a.deletedAt || x.tipo !== 'estado') continue;
    itens.push({ quando: x.createdAt, texto: `${a.codigo}: ${x.texto}`, rota: `/anomalias/${a.id}` });
  }
  for (const c of d.contagens) {
    if (c.deletedAt || c.movimentoId) continue;
    itens.push({ quando: c.createdAt, texto: `Contagem de ${art(c.artigoId)} em ${loc(c.localizacaoId)}: ${c.quantidade}`, rota: `/stock/${c.artigoId}` });
  }
  for (const m of d.movimentos) {
    if (m.deletedAt) continue;
    const sinal = m.tipo === 'ajuste' && m.quantidade > 0 ? '+' : '';
    itens.push({ quando: m.createdAt, texto: `${TIPOS_MOVIMENTO[m.tipo]}: ${art(m.artigoId)} ${sinal}${m.quantidade}`, rota: `/stock/${m.artigoId}` });
  }
  for (const v of d.encomendaEventos) {
    const e = enc(v.encomendaId);
    if (v.deletedAt || !e || e.deletedAt || v.tipo === 'nota') continue;
    itens.push({ quando: v.createdAt, texto: `${e.codigo}: ${v.texto}`, rota: `/encomendas/${e.id}` });
  }
  for (const x of d.execucoes) {
    const m = man(x.manutencaoId);
    if (!x.deletedAt && m) itens.push({ quando: x.createdAt, texto: `Manutenção feita: ${m.titulo}`, rota: `/equipamentos/${x.equipamentoId}` });
  }
  for (const i of d.inspecoes) {
    if (!i.deletedAt && i.estado === 'concluida' && i.concluidaEm) itens.push({ quando: i.concluidaEm, texto: `Inspeção ${i.codigo} concluída em ${loc(i.localizacaoId)}`, rota: `/inspecoes/${i.id}` });
  }
  return itens.sort((a, b) => (a.quando < b.quando ? 1 : a.quando > b.quando ? -1 : 0)).slice(0, limite);
}
