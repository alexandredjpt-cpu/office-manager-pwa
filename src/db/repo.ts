import type { Base, OfficeDB, Equipamento, Localizacao } from './schema';

export const agora = () => new Date().toISOString();
export const novoId = () => crypto.randomUUID();

/**
 * Próximo código legível (ex.: EQ-000001). Corre numa transação com o contador,
 * por isso dois registos nunca recebem o mesmo número, e um registo eliminado
 * nunca devolve o seu número.
 */
export async function proximoCodigo(db: OfficeDB, prefixo: string): Promise<string> {
  return db.transaction('rw', db.contadores, async () => {
    const atual = await db.contadores.get(prefixo);
    const ultimo = (atual?.ultimo ?? 0) + 1;
    await db.contadores.put({ prefixo, ultimo });
    return `${prefixo}-${String(ultimo).padStart(6, '0')}`;
  });
}

function base(): Base {
  const t = agora();
  return { id: novoId(), createdAt: t, updatedAt: t, deletedAt: null };
}

export async function criarLocalizacao(
  db: OfficeDB,
  dados: Pick<Localizacao, 'nome' | 'tipo'> & Partial<Pick<Localizacao, 'notas'>>
): Promise<Localizacao> {
  const nome = dados.nome.trim();
  if (!nome) throw new Error('O nome é obrigatório.');
  const reg: Localizacao = { ...base(), nome, tipo: dados.tipo, notas: dados.notas ?? '' };
  await db.localizacoes.add(reg);
  return reg;
}

export type NovoEquipamento = Pick<Equipamento, 'nome'> &
  Partial<Omit<Equipamento, keyof Base | 'codigo' | 'nome' | 'estado' | 'dataAbate' | 'motivoAbate'>>;

export async function criarEquipamento(db: OfficeDB, dados: NovoEquipamento): Promise<Equipamento> {
  const nome = dados.nome.trim();
  if (!nome) throw new Error('O nome é obrigatório.');
  return db.transaction('rw', db.equipamentos, db.contadores, async () => {
    const reg: Equipamento = {
      ...base(),
      codigo: await proximoCodigo(db, 'EQ'),
      nome,
      categoria: dados.categoria ?? '',
      marca: dados.marca ?? '',
      modelo: dados.modelo ?? '',
      numeroSerie: dados.numeroSerie ?? '',
      localizacaoId: dados.localizacaoId ?? null,
      estado: 'ativo',
      dataAquisicao: dados.dataAquisicao ?? null,
      fimGarantia: dados.fimGarantia ?? null,
      dataAbate: null,
      motivoAbate: '',
      notas: dados.notas ?? ''
    };
    await db.equipamentos.add(reg);
    return reg;
  });
}

/**
 * Eliminação lógica genérica. Equipamentos não passam por aqui:
 * a regra de negócio é que nunca são eliminados, só abatidos.
 */
export async function eliminarLogico(
  db: OfficeDB,
  tabela: 'localizacoes' | 'fotografias',
  id: string
): Promise<void> {
  const t = agora();
  const n = await db.table(tabela).update(id, { deletedAt: t, updatedAt: t });
  if (n === 0) throw new Error('Registo não encontrado.');
}

export async function abaterEquipamento(db: OfficeDB, id: string, motivo: string): Promise<void> {
  if (!motivo.trim()) throw new Error('Indica o motivo do abate.');
  const t = agora();
  const n = await db.equipamentos.update(id, {
    estado: 'abatido',
    dataAbate: t.slice(0, 10),
    motivoAbate: motivo.trim(),
    updatedAt: t
  });
  if (n === 0) throw new Error('Equipamento não encontrado.');
}

export const ativos = <T extends Base>(lista: T[]) => lista.filter((r) => r.deletedAt === null);
