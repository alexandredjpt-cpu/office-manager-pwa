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
  /** Fornecedor habitual associado à ficha (opcional; o texto livre antigo mantém-se). */
  fornecedorId?: string | null;
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
  /** Preenchido quando a contagem foi gerada por um movimento (transferência, perda…). */
  movimentoId?: string | null;
}

export type TipoMovimento = 'transferencia' | 'perda' | 'dano' | 'ajuste' | 'entrada';

/** Movimento extraordinário de stock. Gera contagens ligadas (`movimentoId`); nunca é apagado fisicamente. */
export interface MovimentoStock extends Base {
  artigoId: string;
  tipo: TipoMovimento;
  /** Sempre > 0, exceto «ajuste» (≠ 0; negativo retira). */
  quantidade: number;
  origemId: string | null;
  destinoId: string | null;
  motivo: string;
  responsavel: string;
  data: string; // AAAA-MM-DD
  /** Entrada gerada por uma receção de encomenda (não se anula como movimento). */
  rececaoId?: string | null;
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

export type EstadoLembrete = 'pendente' | 'feito' | 'cancelado';

/** Lembrete pessoal. As datas (tarefa e antecedência do aviso) são sempre escolhidas pelo utilizador. */
export interface Lembrete extends Base {
  titulo: string;
  data: string; // AAAA-MM-DD
  antecedenciaDias: number; // o aviso aparece desde `data − antecedência`
  notas: string;
  equipamentoId: string | null;
  estado: EstadoLembrete;
}

export type EstadoManutencao = 'ativa' | 'concluida' | 'cancelada';

/** Tarefa de manutenção preventiva de um equipamento. Datas e avisos são escolhidos pelo utilizador. */
export interface Manutencao extends Base {
  equipamentoId: string;
  titulo: string;
  descricao: string;
  responsavel: string;
  proximaData: string; // AAAA-MM-DD
  antecedenciaDias: number;
  /** Repetição opcional (dias). Só é aplicada se o utilizador confirmar ao concluir. */
  frequenciaDias: number | null;
  estado: EstadoManutencao;
}

/** Registo (imutável) de uma execução de manutenção. */
export interface Execucao extends Base {
  manutencaoId: string;
  equipamentoId: string;
  data: string; // AAAA-MM-DD
  responsavel: string;
  notas: string;
}

export interface Fornecedor extends Base {
  nome: string;
  contacto: string;
  email: string;
  telefone: string;
  notas: string;
}

export type EstadoEncomenda = 'rascunho' | 'pendente' | 'aprovada' | 'encomendada' | 'parcial' | 'entregue' | 'cancelada';

export interface Encomenda extends Base {
  codigo: string; // EN-
  fornecedorId: string;
  estado: EstadoEncomenda;
  notas: string;
  /** Quem foi pedido para aprovar (opcional). */
  aprovadorId?: string | null;
}

export interface EncomendaLinha extends Base {
  encomendaId: string;
  artigoId: string;
  quantidade: number; // pedida
  /** Totais acumulados das receções. Só a aceite entra no stock. */
  aceite: number;
  danificada: number;
  rejeitada: number;
}

export interface EncomendaEvento extends Base {
  encomendaId: string;
  tipo: 'estado' | 'rececao' | 'nota';
  texto: string;
}

export interface RececaoLinha { artigoId: string; aceite: number; danificada: number; rejeitada: number }
export interface Rececao extends Base {
  encomendaId: string;
  data: string; // AAAA-MM-DD
  localizacaoId: string | null; // armazém onde entrou o aceite
  responsavel: string;
  notas: string;
  linhas: RececaoLinha[];
}

export type EntidadeDocumento = 'equipamento' | 'fornecedor' | 'encomenda' | 'localizacao';

/** Documento anexo (PDF ou imagem) guardado só neste telemóvel. */
export interface Documento extends Base {
  entidade: EntidadeDocumento;
  entidadeId: string;
  nome: string;
  descricao: string;
  mime: string;
  tamanho: number;
  blob: Blob;
}

/** Modelo de e-mail do utilizador. Campos automáticos: {{fornecedor}}, {{contacto}}, {{encomenda}}, {{artigos}}, {{responsavel}}, {{data}}. */
export interface ModeloEmail extends Base {
  nome: string;
  assunto: string;
  corpo: string;
}

/** Pessoa com quem o utilizador trabalha (superior, colega…). Só dados mínimos, só neste telemóvel. */
export interface Contacto extends Base {
  nome: string;
  funcao: string;
  email: string;
  telefone: string;
  aprovador: boolean;
}

/** Marcador numa planta (um Documento de imagem de um local). x e y são frações 0–1 da imagem. */
export interface Marcador extends Base {
  documentoId: string;
  tipo: 'equipamento' | 'artigo';
  refId: string;
  x: number;
  y: number;
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
  lembretes!: EntityTable<Lembrete, 'id'>;
  movimentosStock!: EntityTable<MovimentoStock, 'id'>;
  manutencoes!: EntityTable<Manutencao, 'id'>;
  execucoes!: EntityTable<Execucao, 'id'>;
  fornecedores!: EntityTable<Fornecedor, 'id'>;
  encomendas!: EntityTable<Encomenda, 'id'>;
  encomendaLinhas!: EntityTable<EncomendaLinha, 'id'>;
  encomendaEventos!: EntityTable<EncomendaEvento, 'id'>;
  rececoes!: EntityTable<Rececao, 'id'>;
  documentos!: EntityTable<Documento, 'id'>;
  modelosEmail!: EntityTable<ModeloEmail, 'id'>;
  contactos!: EntityTable<Contacto, 'id'>;
  marcadores!: EntityTable<Marcador, 'id'>;
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
    // v5 (Fase A): lembretes.
    this.version(5).stores({ lembretes: 'id, data, estado, equipamentoId, updatedAt' });
    // v6 (Fase B): movimentos de stock.
    this.version(6).stores({ movimentosStock: 'id, artigoId, tipo, data, updatedAt' });
    // v7 (Fase C): manutenção preventiva.
    this.version(7).stores({ manutencoes: 'id, equipamentoId, estado, proximaData, updatedAt', execucoes: 'id, manutencaoId, equipamentoId, data, updatedAt' });
    // v8 (Fase D): fornecedores, encomendas, receções.
    this.version(8).stores({
      fornecedores: 'id, nome, deletedAt, updatedAt',
      encomendas: 'id, &codigo, fornecedorId, estado, updatedAt',
      encomendaLinhas: 'id, encomendaId, artigoId, updatedAt',
      encomendaEventos: 'id, encomendaId, createdAt',
      rececoes: 'id, encomendaId, updatedAt'
    });
    // v9 (Fase E): documentos anexos e modelos de e-mail.
    this.version(9).stores({
      documentos: 'id, [entidade+entidadeId], deletedAt, updatedAt',
      modelosEmail: 'id, nome, deletedAt, updatedAt'
    });
    // v10: contactos (aprovadores e outras pessoas).
    this.version(10).stores({ contactos: 'id, nome, aprovador, deletedAt, updatedAt' });
    // v11 (Fase F): marcadores em plantas.
    this.version(11).stores({ marcadores: 'id, documentoId, [tipo+refId], deletedAt, updatedAt' });
  }
}

/** Tabelas que entram na cópia de segurança (todas, por ordem estável). */
export const TABELAS = ['localizacoes', 'equipamentos', 'fotografias', 'artigos', 'contagensStock', 'anomalias', 'atividades', 'inspecoes', 'inspecaoLinhas', 'lembretes', 'movimentosStock', 'manutencoes', 'execucoes', 'fornecedores', 'encomendas', 'encomendaLinhas', 'encomendaEventos', 'rececoes', 'documentos', 'modelosEmail', 'contactos', 'marcadores', 'contadores', 'meta'] as const;
/** Tabelas com `updatedAt` (para o aviso de cópia). */
export const TABELAS_COM_DATA = ['localizacoes', 'equipamentos', 'fotografias', 'artigos', 'contagensStock', 'anomalias', 'atividades', 'inspecoes', 'inspecaoLinhas', 'lembretes', 'movimentosStock', 'manutencoes', 'execucoes', 'fornecedores', 'encomendas', 'encomendaLinhas', 'encomendaEventos', 'rececoes', 'documentos', 'modelosEmail', 'contactos', 'marcadores'] as const;
export type NomeTabela = (typeof TABELAS)[number];

export const db = new OfficeDB();
