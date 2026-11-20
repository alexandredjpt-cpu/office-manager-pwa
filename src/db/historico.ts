import type { Anomalia, Equipamento, Execucao, Inspecao, InspecaoLinha, Manutencao } from './schema';
import { ESTADOS_ANOMALIA } from './anomalias';
import { RESULTADOS } from './inspecoes';

export interface EventoHistorico { quando: string; tipo: 'criado' | 'anomalia' | 'inspecao' | 'manutencao' | 'abate'; texto: string; detalhe: string; rota: string }

/** Tudo o que aconteceu a um equipamento, do mais recente para o mais antigo. Só leitura: junta registos que já existem. */
export function historicoEquipamento(e: Equipamento, d: {
  anomalias: Anomalia[]; inspecoes: Inspecao[]; linhas: InspecaoLinha[]; execucoes: Execucao[]; manutencoes: Manutencao[]; nomeLocal: (id: string) => string;
}): EventoHistorico[] {
  const ev: EventoHistorico[] = [{ quando: e.createdAt, tipo: 'criado', texto: 'Registado na app', detalhe: e.codigo, rota: '' }];
  for (const a of d.anomalias) {
    if (a.deletedAt || a.equipamentoId !== e.id) continue;
    ev.push({ quando: a.createdAt, tipo: 'anomalia', texto: `Anomalia: ${a.titulo}`, detalhe: `${a.codigo} · ${ESTADOS_ANOMALIA[a.estado]}${a.dataResolucao ? ` em ${a.dataResolucao.split('-').reverse().join('/')}` : ''}`, rota: `/anomalias/${a.id}` });
  }
  for (const l of d.linhas) {
    if (l.equipamentoId !== e.id) continue;
    const i = d.inspecoes.find((x) => x.id === l.inspecaoId);
    if (!i || i.deletedAt || i.estado === 'cancelada') continue;
    ev.push({ quando: i.concluidaEm ?? i.createdAt, tipo: 'inspecao', texto: `Inspeção: ${l.resultado ? RESULTADOS[l.resultado] : 'por avaliar'}`, detalhe: [i.codigo, d.nomeLocal(i.localizacaoId), l.observacoes].filter(Boolean).join(' · '), rota: `/inspecoes/${i.id}` });
  }
  for (const x of d.execucoes) {
    if (x.deletedAt || x.equipamentoId !== e.id) continue;
    const m = d.manutencoes.find((k) => k.id === x.manutencaoId);
    ev.push({ quando: `${x.data}T12:00:00.000Z`, tipo: 'manutencao', texto: `Manutenção: ${m?.titulo ?? '?'}`, detalhe: [x.responsavel, x.notas].filter(Boolean).join(' · '), rota: '' });
  }
  if (e.estado === 'abatido' && e.dataAbate) ev.push({ quando: `${e.dataAbate}T23:59:59.000Z`, tipo: 'abate', texto: 'Abatido', detalhe: e.motivoAbate, rota: '' });
  return ev.sort((a, b) => b.quando.localeCompare(a.quando));
}
