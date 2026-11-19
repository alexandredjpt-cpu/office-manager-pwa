import { TABELAS, type OfficeDB } from './schema';
import { criarEquipamento, criarLocalizacao } from './repo';

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
}

/** Há registos e todos os de localizações/equipamentos são de exemplo. */
export async function soTemDadosExemplo(db: OfficeDB): Promise<boolean> {
  const [locais, equips] = await Promise.all([db.localizacoes.toArray(), db.equipamentos.toArray()]);
  if (locais.length + equips.length === 0) return false;
  return locais.every((l) => ehExemplo(l.nome)) && equips.every((e) => ehExemplo(e.nome));
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
    for (const t of ['localizacoes', 'equipamentos', 'fotografias', 'contadores'] as const) await db.table(t).clear();
  });
}
