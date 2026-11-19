import type { Anomalia } from '../db/schema';
import { ESTADOS_ANOMALIA, PRIORIDADES } from '../db/anomalias';
import { criarXlsx, type Celula } from './xlsx';

export const CABECALHO_ANOMALIAS = ['Código', 'Descrição curta', 'Prioridade', 'Estado', 'Localização', 'Equipamento', 'Aberta em', 'Resolvida em', 'Descrição'];

export function linhasAnomalias(lista: Anomalia[], nomeLocal: (id: string) => string, nomeEquip: (id: string | null) => string): Celula[][] {
  return lista.map((a) => [
    a.codigo, a.titulo, PRIORIDADES[a.prioridade], ESTADOS_ANOMALIA[a.estado], nomeLocal(a.localizacaoId), nomeEquip(a.equipamentoId),
    a.createdAt.slice(0, 10), a.dataResolucao ?? '', a.descricao
  ]);
}

export async function exportarAnomaliasXlsx(lista: Anomalia[], nomeLocal: (id: string) => string, nomeEquip: (id: string | null) => string) {
  const d = new Date();
  const dia = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { blob: await criarXlsx('Anomalias', CABECALHO_ANOMALIAS, linhasAnomalias(lista, nomeLocal, nomeEquip)), nome: `anomalias-${dia}.xlsx` };
}
