import type { Base, OfficeDB, Equipamento, EntidadeFoto, Fotografia, Localizacao } from './schema';

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
  const atual = await db.equipamentos.get(id);
  if (atual?.estado === 'abatido') throw new Error('Este equipamento já está abatido.');
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

// ───────────── edição ─────────────

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

/** '' → null; valida formato e existência (ex.: 2026-02-31 é recusado). */
export function normalizarData(valor: string | null | undefined, rotulo: string): string | null {
  const v = (valor ?? '').trim();
  if (!v) return null;
  const d = new Date(`${v}T00:00:00Z`);
  if (!DATA_RE.test(v) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
    throw new Error(`${rotulo}: data inválida.`);
  }
  return v;
}

export type DadosEquipamento = Partial<
  Pick<Equipamento, 'nome' | 'categoria' | 'marca' | 'modelo' | 'numeroSerie' | 'localizacaoId' | 'dataAquisicao' | 'fimGarantia' | 'notas'>
>;

async function validarLocalizacao(db: OfficeDB, id: string | null | undefined) {
  if (!id) return;
  const l = await db.localizacoes.get(id);
  if (!l || l.deletedAt) throw new Error('A localização escolhida não existe.');
}

function validarIntervalo(aquisicao: string | null, fim: string | null) {
  if (aquisicao && fim && fim < aquisicao) throw new Error('O fim da garantia não pode ser anterior à aquisição.');
}

/** Atualiza campos descritivos. O estado muda só por desativar/reativar/abater. */
export async function atualizarEquipamento(db: OfficeDB, id: string, dados: DadosEquipamento): Promise<Equipamento> {
  return db.transaction('rw', db.equipamentos, db.localizacoes, async () => {
    const atual = await db.equipamentos.get(id);
    if (!atual) throw new Error('Equipamento não encontrado.');
    if (atual.estado === 'abatido') throw new Error('Equipamento abatido não pode ser alterado.');

    const mudancas: Partial<Equipamento> = {};
    if (dados.nome !== undefined) {
      const nome = dados.nome.trim();
      if (!nome) throw new Error('O nome é obrigatório.');
      mudancas.nome = nome;
    }
    for (const k of ['categoria', 'marca', 'modelo', 'numeroSerie', 'notas'] as const) {
      if (dados[k] !== undefined) mudancas[k] = dados[k]!.trim();
    }
    if (dados.localizacaoId !== undefined) {
      await validarLocalizacao(db, dados.localizacaoId);
      mudancas.localizacaoId = dados.localizacaoId || null;
    }
    if (dados.dataAquisicao !== undefined) mudancas.dataAquisicao = normalizarData(dados.dataAquisicao, 'Aquisição');
    if (dados.fimGarantia !== undefined) mudancas.fimGarantia = normalizarData(dados.fimGarantia, 'Fim da garantia');

    const novo = { ...atual, ...mudancas, updatedAt: agora() };
    validarIntervalo(novo.dataAquisicao, novo.fimGarantia);
    await db.equipamentos.put(novo);
    return novo;
  });
}

async function mudarEstado(db: OfficeDB, id: string, de: Equipamento['estado'], para: Equipamento['estado']) {
  const atual = await db.equipamentos.get(id);
  if (!atual) throw new Error('Equipamento não encontrado.');
  if (atual.estado !== de) throw new Error(`Só é possível passar de ${de} para ${para}.`);
  await db.equipamentos.update(id, { estado: para, updatedAt: agora() });
}

export const desativarEquipamento = (db: OfficeDB, id: string) => mudarEstado(db, id, 'ativo', 'desativado');
export const reativarEquipamento = (db: OfficeDB, id: string) => mudarEstado(db, id, 'desativado', 'ativo');

export async function atualizarLocalizacao(
  db: OfficeDB,
  id: string,
  dados: Partial<Pick<Localizacao, 'nome' | 'tipo' | 'notas'>>
): Promise<Localizacao> {
  const atual = await db.localizacoes.get(id);
  if (!atual || atual.deletedAt) throw new Error('Localização não encontrada.');
  const nome = dados.nome === undefined ? atual.nome : dados.nome.trim();
  if (!nome) throw new Error('O nome é obrigatório.');
  const novo: Localizacao = {
    ...atual,
    nome,
    tipo: dados.tipo ?? atual.tipo,
    notas: dados.notas === undefined ? atual.notas : dados.notas.trim(),
    updatedAt: agora()
  };
  await db.localizacoes.put(novo);
  return novo;
}

/** Só elimina (logicamente) se nenhum equipamento não abatido estiver lá. */
export async function eliminarLocalizacao(db: OfficeDB, id: string): Promise<void> {
  await db.transaction('rw', db.localizacoes, db.equipamentos, async () => {
    const n = await db.equipamentos.where('localizacaoId').equals(id).filter((e) => e.estado !== 'abatido').count();
    if (n > 0) throw new Error(`Há ${n} equipamento(s) nesta localização. Muda-os para outra primeiro.`);
    await eliminarLogico(db, 'localizacoes', id);
  });
}

// ───────────── fotografias ─────────────

export async function adicionarFoto(db: OfficeDB, entidade: EntidadeFoto, entidadeId: string, blob: Blob): Promise<Fotografia> {
  if (!blob.type.startsWith('image/')) throw new Error('O ficheiro não é uma imagem.');
  const tabela = entidade === 'equipamento' ? db.equipamentos : entidade === 'localizacao' ? db.localizacoes : null;
  if (!tabela) throw new Error('Fotografias de anomalias ainda não existem.');
  const dono = await tabela.get(entidadeId);
  if (!dono || dono.deletedAt) throw new Error('O registo a que a fotografia pertence não existe.');
  const reg: Fotografia = { ...base(), entidade, entidadeId, blob, mime: blob.type };
  await db.fotografias.add(reg);
  return reg;
}
