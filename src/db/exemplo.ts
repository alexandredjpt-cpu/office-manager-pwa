import { TABELAS, type OfficeDB } from './schema';
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
  const papel = await criarArtigo(db, { nome: `Papel A4 ${SUFIXO_EXEMPLO}`, categoria: 'Papelaria', unidade: 'resmas', stockMinimo: 5, fornecedor: 'Loja Exemplo', preco: 4.5 });
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
  return locais.every((l) => ehExemplo(l.nome)) && equips.every((e) => ehExemplo(e.nome)) && artigos.every((a) => ehExemplo(a.nome)) && anomalias.every((a) => ehExemplo(a.titulo));
}

/**
 * Apaga tudo (incluindo contadores) para os registos reais começarem em EQ-000001.
 * Só é permitido quando TUDO é de exemplo — assim nunca se reutiliza um código real.
 * Mantém a data da última cópia de segurança.
 */
export async function apagarDadosExemplo(db: OfficeDB): Promise<void> {
  await db.transaction('rw', TABELAS.map((t) => db.table(t)), async () => {
    if (!(await soTemDadosExemplo(db))) {
      throw new Error('Há dados reais: não é possível apagar só os de exemplo.');
    }
    for (const t of ['localizacoes', 'equipamentos', 'fotografias', 'artigos', 'contagensStock', 'anomalias', 'atividades', 'inspecoes', 'inspecaoLinhas', 'lembretes', 'movimentosStock', 'manutencoes', 'execucoes', 'fornecedores', 'encomendas', 'encomendaLinhas', 'encomendaEventos', 'rececoes', 'documentos', 'modelosEmail', 'contactos', 'contadores'] as const) await db.table(t).clear();
  });
}
