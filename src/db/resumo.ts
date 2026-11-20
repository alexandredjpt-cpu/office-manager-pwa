import type { Anomalia, Inspecao } from './schema';
import { hojeIso, type Evento } from './agenda';

export interface LinhaResumo {
  chave: 'agenda' | 'anomalias' | 'inspecoes' | 'compras' | 'notas';
  texto: string;
  detalhe: string;
  /** Vazio = está no próprio Início (notas). */
  rota: string;
  /** Pede atenção hoje (atrasos ou prioridade alta). */
  urgente: boolean;
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/**
 * O que está pendente hoje, numa linha por área. Só entram áreas com alguma coisa.
 * Agenda: lembretes e manutenções com data até hoje (atrasados à parte) e garantias que terminam hoje.
 */
export function resumoHoje(d: { eventos: Evento[]; anomalias: Anomalia[]; inspecoes: Inspecao[]; aComprar: number; notas: number }, hoje = new Date()): LinhaResumo[] {
  const h = hojeIso(hoje);
  const linhas: LinhaResumo[] = [];

  const tarefas = d.eventos.filter((e) => e.tipo !== 'garantia' && e.data <= h);
  const atrasadas = tarefas.filter((e) => e.data < h).length;
  const deHoje = tarefas.length - atrasadas + d.eventos.filter((e) => e.tipo === 'garantia' && e.data === h).length;
  if (atrasadas + deHoje > 0) {
    linhas.push({
      chave: 'agenda', rota: '/agenda', urgente: atrasadas > 0,
      texto: plural(atrasadas + deHoje, 'tarefa na agenda', 'tarefas na agenda'),
      detalhe: [deHoje ? `${deHoje} para hoje` : '', atrasadas ? plural(atrasadas, 'atrasada', 'atrasadas') : ''].filter(Boolean).join(' · ')
    });
  }

  const abertas = d.anomalias.filter((a) => !a.deletedAt && a.estado !== 'resolvida');
  if (abertas.length) {
    const altas = abertas.filter((a) => a.prioridade === 'alta').length;
    const verificar = abertas.filter((a) => a.estado === 'aguarda_verificacao').length;
    linhas.push({
      chave: 'anomalias', rota: '/anomalias', urgente: altas > 0,
      texto: plural(abertas.length, 'anomalia aberta', 'anomalias abertas'),
      detalhe: [altas ? `${altas} de prioridade alta` : 'nenhuma de prioridade alta', verificar ? `${verificar} a aguardar verificação` : ''].filter(Boolean).join(' · ')
    });
  }

  const emCurso = d.inspecoes.filter((i) => !i.deletedAt && i.estado === 'em_curso').length;
  if (emCurso) linhas.push({ chave: 'inspecoes', rota: '/inspecoes', urgente: false, texto: plural(emCurso, 'inspeção em curso', 'inspeções em curso'), detalhe: 'por concluir' });

  if (d.aComprar) linhas.push({ chave: 'compras', rota: '/stock?ver=compras', urgente: false, texto: plural(d.aComprar, 'artigo a comprar', 'artigos a comprar'), detalhe: 'abaixo do stock mínimo' });

  if (d.notas) linhas.push({ chave: 'notas', rota: '', urgente: false, texto: plural(d.notas, 'nota por tratar', 'notas por tratar'), detalhe: 'passa-as a anomalia ou lembrete, ou arquiva' });

  return linhas;
}
