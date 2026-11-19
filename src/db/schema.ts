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

export type EntidadeFoto = 'localizacao' | 'equipamento' | 'anomalia';

export interface Fotografia extends Base {
  entidade: EntidadeFoto;
  entidadeId: string;
  blob: Blob;
  mime: string;
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
  }
}

/** Tabelas que entram na cópia de segurança (todas, por ordem estável). */
export const TABELAS = ['localizacoes', 'equipamentos', 'fotografias', 'contadores', 'meta'] as const;
export type NomeTabela = (typeof TABELAS)[number];

export const db = new OfficeDB();
