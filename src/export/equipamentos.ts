import type { Equipamento } from '../db/schema';
import { estadoGarantia } from '../db/garantia';
import { criarXlsx, type Celula } from './xlsx';

export const CABECALHO_EQUIPAMENTOS = [
  'Código', 'Nome', 'Categoria', 'Marca', 'Modelo', 'Nº série', 'Localização', 'Estado',
  'Data aquisição', 'Fim garantia', 'Garantia', 'Data abate', 'Motivo abate', 'Notas'
];

const ESTADO = { ativo: 'Ativo', desativado: 'Desativado', abatido: 'Abatido' } as const;
const GARANTIA = { sem: '', ativa: 'Ativa', a_terminar: 'A terminar', expirada: 'Expirada' } as const;

export function linhasEquipamentos(lista: Equipamento[], nomeLocal: (id: string | null) => string, hoje = new Date()): Celula[][] {
  return lista.map((e) => [
    e.codigo, e.nome, e.categoria, e.marca, e.modelo, e.numeroSerie, nomeLocal(e.localizacaoId), ESTADO[e.estado],
    e.dataAquisicao, e.fimGarantia, e.estado === 'abatido' ? '' : GARANTIA[estadoGarantia(e.fimGarantia, hoje).estado], e.dataAbate, e.motivoAbate, e.notas
  ]);
}

export function nomeFicheiroEquipamentos(hoje = new Date()): string {
  const d = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
  return `equipamentos-${d}.xlsx`;
}

export async function exportarEquipamentosXlsx(lista: Equipamento[], nomeLocal: (id: string | null) => string) {
  return { blob: await criarXlsx('Equipamentos', CABECALHO_EQUIPAMENTOS, linhasEquipamentos(lista, nomeLocal)), nome: nomeFicheiroEquipamentos() };
}
