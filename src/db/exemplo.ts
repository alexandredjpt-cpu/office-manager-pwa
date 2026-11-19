import type { OfficeDB } from './schema';
import { criarEquipamento, criarLocalizacao } from './repo';

/** Dados 100% fictícios, só para testar a app. Nunca usar dados reais aqui. */
export async function criarDadosExemplo(db: OfficeDB): Promise<void> {
  const sala = await criarLocalizacao(db, { nome: 'Sala (exemplo)', tipo: 'divisao' });
  const arrumos = await criarLocalizacao(db, { nome: 'Arrumos (exemplo)', tipo: 'armazenamento' });
  await criarEquipamento(db, { nome: 'Router (exemplo)', categoria: 'Rede', marca: 'Marca Exemplo', modelo: 'R-100', localizacaoId: sala.id });
  await criarEquipamento(db, { nome: 'Aspirador (exemplo)', categoria: 'Limpeza', marca: 'Marca Exemplo', modelo: 'A-1', localizacaoId: arrumos.id });
}
