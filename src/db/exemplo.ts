import { TABELAS, type OfficeDB } from './schema';
import { limparPartilha } from './partilha';
import { criarEquipamento, criarLocalizacao } from './repo';
import { adicionarAtividade, criarAnomalia } from './anomalias';
import { criarArtigo, registarContagem } from './stock';

/** Todos os dados fictícios acabam assim; é o que os distingue dos reais. */
export const SUFIXO_EXEMPLO = '(exemplo)';
const ehExemplo = (nome: string) => nome.trim().endsWith(SUFIXO_EXEMPLO);

/** Dados 100% fictícios, só para experimentar a app. Nunca usar dados reais aqui. */
export async function criarDadosExemplo(db: OfficeDB): Promise<void> {
  const daqui = (dias: number) => {
    const d = new Date(Date.now() + dias * 86_400_000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const sala = await criarLocalizacao(db, { nome: `Sala ${SUFIXO_EXEMPLO}`, tipo: 'divisao' });
  const arrumos = await criarLocalizacao(db, { nome: `Arrumos ${SUFIXO_EXEMPLO}`, tipo: 'armazenamento' });
  await criarEquipamento(db, {
    nome: `Router ${SUFIXO_EXEMPLO}`, categoria: 'Rede', marca: 'Marca Exemplo', modelo: 'R-100',
    localizacaoId: sala.id, dataAquisicao: daqui(-700), fimGarantia: daqui(30)
  });
  await criarEquipamento(db, {
    nome: `Aspirador ${SUFIXO_EXEMPLO}`, categoria: 'Limpeza', marca: 'Marca Exemplo', modelo: 'A-1',
    localizacaoId: arrumos.id, dataAquisicao: daqui(-100), fimGarantia: daqui(600)
  });
  const papel = await criarArtigo(db, { nome: `Papel A4 ${SUFIXO_EXEMPLO}`, categoria: 'Papelaria', unidade: 'resmas', stockMinimo: 5, preco: 4.5 });
  const pilhas = await criarArtigo(db, { nome: `Pilhas AA ${SUFIXO_EXEMPLO}`, categoria: 'Eletricidade', unidade: 'un', stockMinimo: 4 });
  await registarContagem(db, papel.id, arrumos.id, 3);
  await registarContagem(db, pilhas.id, arrumos.id, 12);
  const router = (await db.equipamentos.toArray()).find((e) => e.nome.startsWith('Router'));
  const anomalia = await criarAnomalia(db, {
    titulo: `Wi-Fi instável ${SUFIXO_EXEMPLO}`, descricao: 'Cai várias vezes ao dia.', localizacaoId: sala.id,
    equipamentoId: router?.id ?? null, prioridade: 'media'
  });
  await adicionarAtividade(db, anomalia.id, 'nota', 'Reiniciei o equipamento; voltou a falhar.');
}

/** Há registos e todos os de localizações/equipamentos são de exemplo. */
export async function soTemDadosExemplo(db: OfficeDB): Promise<boolean> {
  const [locais, equips, artigos, anomalias] = await Promise.all([db.localizacoes.toArray(), db.equipamentos.toArray(), db.artigos.toArray(), db.anomalias.toArray()]);
  if (locais.length + equips.length + artigos.length + anomalias.length === 0) return false;
  if ((await db.notas.count()) > 0) return false; // as notas são sempre do utilizador
  return locais.every((l) => ehExemplo(l.nome)) && equips.every((e) => ehExemplo(e.nome)) && artigos.every((a) => ehExemplo(a.nome)) && anomalias.every((a) => ehExemplo(a.titulo));
}

/** Tabelas de dados (tudo exceto `meta`: data da última cópia e nome do responsável mantêm-se). */
const TABELAS_DADOS = TABELAS.filter((t) => t !== 'meta');

/**
 * Único mecanismo de limpeza: numa só transação, verifica a condição e apaga todas as tabelas de dados
 * (incluindo contadores: os códigos voltam a EQ-000001…). `meta` fica. No fim limpa também as fotografias
 * partilhadas ainda por usar (área temporária).
 */
async function limparDados(db: OfficeDB, verificar: () => Promise<void> | void): Promise<void> {
  await db.transaction('rw', TABELAS_DADOS.map((t) => db.table(t)), async () => {
    await verificar();
    for (const t of TABELAS_DADOS) await db.table(t).clear();
  });
  await limparPartilha().catch(() => undefined);
}

/**
 * Apaga os dados de exemplo para os registos reais começarem em EQ-000001.
 * Só é permitido quando TUDO é de exemplo — assim nunca se reutiliza um código real.
 */
export function apagarDadosExemplo(db: OfficeDB): Promise<void> {
  return limparDados(db, async () => {
    if (!(await soTemDadosExemplo(db))) throw new Error('Há dados reais: não é possível apagar só os de exemplo.');
  });
}

/**
 * Começar do zero: apaga TODOS os dados. Irreversível. A interface exige escrever APAGAR e recomenda uma cópia antes.
 */
export function apagarTudo(db: OfficeDB, confirmacao: string): Promise<void> {
  return limparDados(db, () => {
    if (confirmacao.trim().toUpperCase() !== 'APAGAR') throw new Error('Escreve APAGAR para confirmar.');
  });
}
