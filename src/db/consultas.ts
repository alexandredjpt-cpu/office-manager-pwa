import type { Equipamento, EstadoEquipamento } from './schema';

export interface Filtros {
  texto: string;
  estado: EstadoEquipamento | 'todos';
  categoria: string; // '' = todas
  localizacaoId: string; // '' = todas; '-' = sem localização
}

export const FILTROS_INICIAIS: Filtros = { texto: '', estado: 'ativo', categoria: '', localizacaoId: '' };

/** Minúsculas e sem acentos, para pesquisar «camara» e encontrar «Câmara». */
export const normalizar = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export function filtrarEquipamentos(
  lista: Equipamento[],
  f: Filtros,
  nomeLocal: (id: string | null) => string
): Equipamento[] {
  const termos = normalizar(f.texto).split(/\s+/).filter(Boolean);
  return lista
    .filter((e) => !e.deletedAt)
    .filter((e) => f.estado === 'todos' || e.estado === f.estado)
    .filter((e) => !f.categoria || e.categoria === f.categoria)
    .filter((e) => !f.localizacaoId || (f.localizacaoId === '-' ? !e.localizacaoId : e.localizacaoId === f.localizacaoId))
    .filter((e) => {
      if (!termos.length) return true;
      const palheiro = normalizar(
        [e.codigo, e.nome, e.categoria, e.marca, e.modelo, e.numeroSerie, e.notas, nomeLocal(e.localizacaoId)].join(' ')
      );
      return termos.every((t) => palheiro.includes(t));
    })
    .sort((a, b) => a.codigo.localeCompare(b.codigo));
}

export const categoriasDe = (lista: Equipamento[]) =>
  [...new Set(lista.filter((e) => !e.deletedAt && e.categoria).map((e) => e.categoria))].sort((a, b) => a.localeCompare(b, 'pt'));

/** Um «modelo» de equipamento: os dados que se repetem entre equipamentos iguais (ex.: 10 cadeiras). */
export interface ModeloEquipamento { chave: string; nome: string; categoria: string; marca: string; modelo: string; quantos: number }

/** Equipamentos iguais agrupados por nome, categoria, marca e modelo (sem acentos nem maiúsculas). Abatidos contam. */
export function modelosDeEquipamento(lista: Equipamento[]): ModeloEquipamento[] {
  const mapa = new Map<string, ModeloEquipamento & { ref: string }>();
  // A grafia copiada é a do equipamento mais recente do grupo (determinística).
  const ref = (e: Equipamento) => `${e.createdAt}|${e.codigo}`;
  for (const e of lista) {
    if (e.deletedAt || !e.nome.trim()) continue;
    const chave = [e.nome, e.categoria, e.marca, e.modelo].map((x) => normalizar(x.trim())).join('|');
    const m = mapa.get(chave);
    const dados = { nome: e.nome.trim(), categoria: e.categoria.trim(), marca: e.marca.trim(), modelo: e.modelo.trim(), ref: ref(e) };
    if (!m) mapa.set(chave, { chave, quantos: 1, ...dados });
    else { m.quantos++; if (dados.ref > m.ref) Object.assign(m, dados); }
  }
  return [...mapa.values()]
    .map(({ ref: _ref, ...m }) => m)
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt', { numeric: true }) || a.marca.localeCompare(b.marca, 'pt') || a.modelo.localeCompare(b.modelo, 'pt', { numeric: true }));
}
