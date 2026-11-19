import Dexie, { type EntityTable } from 'dexie';

/** Campos comuns a todos os registos. Nunca se apaga fisicamente: só `deletedAt`. */
export interface Base {
  id: string;
  createdAt: string; // ISO 8601
  updatedAt: string;
  deletedAt: string | null;
}

export type TipoLocalizacao = 'divisao' | 'armazenamento' | 'zona_comum' | 'exterior' | 'outro';

export interface Localizacao extends Base {
  nome: string;
  tipo: TipoLocalizacao;
  notas: string;
}

export type EstadoEquipamento = 'ativo' | 'desativado' | 'abatido';

export interface Equipamento extends Base {
  codigo: string; // EQ-000001, nunca reutilizado
  nome: string;
  categoria: string;
  marca: string;
  modelo: string;
  numeroSerie: string;
  localizacaoId: string | null;
  estado: EstadoEquipamento;
  dataAquisicao: string | null;
  fimGarantia: string | null;
  dataAbate: string | null;
  motivoAbate: string;
  notas: string;
}

export type EntidadeFoto = 'localizacao' | 'equipamento' | 'anomalia' | 'inspecao';

export interface Fotografia extends Base {
  entidade: EntidadeFoto;
  entidadeId: string;
  blob: Blob;
  mime: string;
}

export type EstadoCompra = 'por_comprar' | 'comprado';

/** Artigo de economato (consumível). O stock não é guardado aqui: vem das contagens. */
export interface Artigo extends Base {
  codigo: string; // AR-000001, nunca reutilizado
  nome: string;
  categoria: string;
  unidade: string; // un, kg, L, …
  stockMinimo: number | null;
  qtdSugerida: number | null; // null = calcular (mínimo − atual)
  fornecedor: string;
  preco: number | null;
  estadoCompra: EstadoCompra;
  notas: string;
}

/**
 * Contagem física de um artigo num local. Imutável: corrigir = nova contagem.
 * A diferença é só variação entre contagens, nunca «consumo» nem «perda».
 */
export interface ContagemStock extends Base {
  artigoId: string;
  localizacaoId: string;
  quantidade: number;
  anterior: number | null;
  diferenca: number | null;
  observacoes: string;
}

export type Prioridade = 'alta' | 'media' | 'baixa';
export type EstadoAnomalia = 'por_resolver' | 'em_intervencao' | 'aguarda_verificacao' | 'resolvida';

export interface Anomalia extends Base {
  codigo: string; // AN-000001, nunca reutilizado
  titulo: string;
  descricao: string;
  localizacaoId: string;
  equipamentoId: string | null;
  prioridade: Prioridade; // sempre escolhida pelo utilizador
  estado: EstadoAnomalia;
  dataResolucao: string | null;
}

export type TipoAtividade = 'estado' | 'intervencao' | 'contacto' | 'nota';

/** Histórico de uma anomalia. Só se acrescenta; nunca se edita nem apaga. */
export interface Atividade extends Base {
  anomaliaId: string;
  tipo: TipoAtividade;
  texto: string;
}

export type ModalidadeInspecao = 'pontual' | 'periodica' | 'extraordinaria';
export type EstadoInspecao = 'em_curso' | 'concluida' | 'cancelada';
export type ResultadoInspecao = 'conforme' | 'com_anomalia' | 'nao_verificado';

/** Inspeção a um local. Concluída ou cancelada, deixa de poder ser alterada. */
export interface Inspecao extends Base {
  codigo: string; // IN-000001, nunca reutilizado
  localizacaoId: string;
  modalidade: ModalidadeInspecao;
  estado: EstadoInspecao;
  concluidaEm: string | null;
  observacoes: string;
}

/** Um equipamento avaliado numa inspeção (lista fixada no início). */
export interface InspecaoLinha extends Base {
  inspecaoId: string;
  equipamentoId: string;
  resultado: ResultadoInspecao | null; // null = ainda por avaliar
  observacoes: string;
  anomaliaId: string | null;
}

/** Contadores de códigos legíveis. Só sobem; nunca descem nem se reutilizam. */
export interface Contador {
  prefixo: string;
  ultimo: number;
}

/** Pares chave/valor da app (ex.: data da última cópia de segurança). */
export interface Meta {
  chave: string;
  valor: string;
}

export const DB_NAME = 'office-manager-pessoal';

export class OfficeDB extends Dexie {
  localizacoes!: EntityTable<Localizacao, 'id'>;
  equipamentos!: EntityTable<Equipamento, 'id'>;
  fotografias!: EntityTable<Fotografia, 'id'>;
  artigos!: EntityTable<Artigo, 'id'>;
  anomalias!: EntityTable<Anomalia, 'id'>;
  inspecoes!: EntityTable<Inspecao, 'id'>;
  inspecaoLinhas!: EntityTable<InspecaoLinha, 'id'>;
  atividades!: EntityTable<Atividade, 'id'>;
  contagensStock!: EntityTable<ContagemStock, 'id'>;
  contadores!: EntityTable<Contador, 'prefixo'>;
  meta!: EntityTable<Meta, 'chave'>;

  constructor(name = DB_NAME) {
    super(name);
    this.version(1).stores({
      localizacoes: 'id, nome, tipo, deletedAt, updatedAt',
      equipamentos: 'id, &codigo, localizacaoId, estado, categoria, deletedAt, updatedAt',
      fotografias: 'id, [entidade+entidadeId], deletedAt',
      contadores: 'prefixo',
      meta: 'chave'
    });
    // v2 (Bloco 3): só acrescenta tabelas; os dados existentes não mudam.
    this.version(2).stores({
      artigos: 'id, &codigo, nome, categoria, deletedAt, updatedAt',
      contagensStock: 'id, artigoId, localizacaoId, [artigoId+localizacaoId], updatedAt'
    });
    // v3 (Bloco 4): anomalias e o seu histórico.
    this.version(3).stores({
      anomalias: 'id, &codigo, localizacaoId, equipamentoId, estado, prioridade, deletedAt, updatedAt',
      atividades: 'id, anomaliaId, updatedAt'
    });
    // v4 (Bloco 6): inspeções por local.
    this.version(4).stores({
      inspecoes: 'id, &codigo, localizacaoId, estado, updatedAt',
      inspecaoLinhas: 'id, inspecaoId, equipamentoId, updatedAt'
    });
  }
}

/** Tabelas que entram na cópia de segurança (todas, por ordem estável). */
export const TABELAS = ['localizacoes', 'equipamentos', 'fotografias', 'artigos', 'contagensStock', 'anomalias', 'atividades', 'inspecoes', 'inspecaoLinhas', 'contadores', 'meta'] as const;
/** Tabelas com `updatedAt` (para o aviso de cópia). */
export const TABELAS_COM_DATA = ['localizacoes', 'equipamentos', 'fotografias', 'artigos', 'contagensStock', 'anomalias', 'atividades', 'inspecoes', 'inspecaoLinhas'] as const;
export type NomeTabela = (typeof TABELAS)[number];

export const db = new OfficeDB();
