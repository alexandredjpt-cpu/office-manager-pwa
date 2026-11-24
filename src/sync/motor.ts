import { guardarPapel, type Papel } from '../db/papel';
import { OfficeDB, sincronizandoComServidor, type SincConflito } from '../db/schema';
import { ErroServidor, entrarComCodigo, enviar, eu, puxar, type RegistoEnvio, type RegistoServidor, type VersaoServidor } from './cliente';

/** Tabelas que o servidor guarda. Têm de bater com TABELAS_SINCRONIZADAS em servidor/src/logica.ts (há um teste). */
export const TABELAS_SINCRONIZADAS = ['localizacoes', 'equipamentos', 'artigos', 'contagensStock', 'movimentosStock', 'anomalias', 'atividades'] as const;

const MAX_REGISTOS_POR_ENVIO = 500;
/** Acima disto o servidor recusa o registo; é melhor saltá-lo e dizê-lo do que bloquear tudo. */
const MAX_BYTES_POR_REGISTO = 256 * 1024;

const chave = (tabela: string, id: string) => `${tabela}/${id}`;
const agora = () => new Date().toISOString();

export interface ResumoSincronizacao { enviados: number; recebidos: number; conflitos: number; saltados: number }

export interface EstadoLigacao {
  ligado: boolean;
  nome: string | null;
  ultimaSincronizacao: string | null;
  aviso: string | null;
}

export async function lerEstado(db: OfficeDB): Promise<EstadoLigacao> {
  const valor = async (k: string) => (await db.meta.get(k))?.valor ?? null;
  return {
    ligado: (await valor('servidor.token')) !== null,
    nome: await valor('servidor.nome'),
    ultimaSincronizacao: await valor('servidor.ultimaSincronizacao'),
    aviso: await valor('servidor.aviso')
  };
}

/** Guarda a ligação depois de um convite aceite (ou de um token do arranque). */
export async function guardarLigacao(db: OfficeDB, token: string, nome: string, papel: Papel): Promise<void> {
  await db.meta.bulkPut([
    { chave: 'servidor.token', valor: token },
    { chave: 'servidor.nome', valor: nome },
    { chave: 'servidor.aviso', valor: '' }
  ]);
  await guardarPapel(db, papel);
}

/** Entra com um convite e sincroniza à primeira. */
export async function ligarComConvite(db: OfficeDB, codigo: string): Promise<ResumoSincronizacao> {
  const dispositivo = (typeof navigator !== 'undefined' && navigator.platform) || 'Telemóvel';
  const r = await entrarComCodigo(codigo, dispositivo);
  await guardarLigacao(db, r.token, r.nome, r.papel);
  return sincronizar(db);
}

/**
 * Liga com o token que o arranque devolveu (só para o primeiro gestor). Confirma o token com o
 * servidor antes de o guardar: um token errado não deixa nada gravado.
 */
export async function ligarComToken(db: OfficeDB, token: string): Promise<ResumoSincronizacao> {
  const quem = await eu(token.trim());
  await guardarLigacao(db, token.trim(), quem.nome, quem.papel);
  return sincronizar(db);
}

/** Este telemóvel deixa de falar com o servidor. Os dados locais ficam como estão. */
export async function desligar(db: OfficeDB): Promise<void> {
  await db.meta.bulkDelete(['servidor.token', 'servidor.nome', 'servidor.seq', 'servidor.aviso']);
}

async function desligarPorCorte(db: OfficeDB): Promise<void> {
  await db.meta.bulkDelete(['servidor.token', 'servidor.nome', 'servidor.seq']);
  await db.meta.put({ chave: 'servidor.aviso', valor: 'O acesso a este telemóvel foi cortado. Pede um convite novo ao gestor.' });
  // Sem acesso, o telemóvel fica só para consulta: o que lá está não se altera mais.
  await guardarPapel(db, 'consulta');
}

let emCurso: Promise<ResumoSincronizacao> | null = null;

/** Envia o que mudou aqui e recebe o que mudou lá. Só corre uma de cada vez. */
export function sincronizar(db: OfficeDB): Promise<ResumoSincronizacao> {
  if (emCurso) return emCurso;
  emCurso = sincronizandoComServidor(() => correr(db)).finally(() => { emCurso = null; });
  return emCurso;
}

async function correr(db: OfficeDB): Promise<ResumoSincronizacao> {
  const token = (await db.meta.get('servidor.token'))?.valor;
  if (!token) throw new Error('Este telemóvel não está ligado ao servidor.');

  let quem: { nome: string; papel: Papel };
  try {
    quem = await eu(token);
  } catch (e) {
    if (e instanceof ErroServidor && e.estado === 401) await desligarPorCorte(db);
    throw e;
  }
  await guardarPapel(db, quem.papel);
  await db.meta.put({ chave: 'servidor.nome', valor: quem.nome });
  await db.meta.put({ chave: 'servidor.aviso', valor: '' });

  // Quem só consulta não envia nada: as escritas já estariam travadas aqui.
  const envio = quem.papel === 'consulta' ? { enviados: 0, conflitos: 0, saltados: 0 } : await enviarPendentes(db, token);
  const recebidos = await receber(db, token);
  await db.meta.put({ chave: 'servidor.ultimaSincronizacao', valor: agora() });
  return { ...envio, recebidos };
}

/** Registos com alterações por enviar. Os que estão em conflito ficam à espera de uma decisão. */
async function pendentesDeEnvio(db: OfficeDB): Promise<{ registos: RegistoEnvio[]; saltados: number }> {
  const emConflito = new Set((await db.sincConflitos.toCollection().primaryKeys()) as string[]);
  const registos: RegistoEnvio[] = [];
  let saltados = 0;
  for (const tabela of TABELAS_SINCRONIZADAS) {
    const linhas = (await db.table(tabela).toArray()) as { id: string; updatedAt: string }[];
    for (const linha of linhas) {
      const k = chave(tabela, linha.id);
      if (emConflito.has(k)) continue;
      const s = await db.sincronia.get(k);
      if (s && s.enviadoAtualizado === linha.updatedAt) continue;
      if (JSON.stringify(linha).length > MAX_BYTES_POR_REGISTO) { saltados++; continue; }
      registos.push({ tabela, id: linha.id, dados: linha, atualizado: linha.updatedAt, base: s?.base ?? null });
    }
  }
  return { registos, saltados };
}

async function enviarPendentes(db: OfficeDB, token: string) {
  const { registos, saltados } = await pendentesDeEnvio(db);
  let enviados = 0;
  let conflitos = 0;
  for (let i = 0; i < registos.length; i += MAX_REGISTOS_POR_ENVIO) {
    const lote = registos.slice(i, i + MAX_REGISTOS_POR_ENVIO);
    const r = await enviar(token, lote);
    // O servidor dá a cada registo o número base+1, base+2, …: o do registo j é r.seq - n + j + 1.
    const perdidos = new Set(r.conflitos.map((c) => chave(c.tabela, c.id)));
    await db.transaction('rw', [db.sincronia, db.sincConflitos], async () => {
      for (const [j, reg] of lote.entries()) {
        const k = chave(reg.tabela, reg.id);
        if (perdidos.has(k)) continue;
        await db.sincronia.put({ chave: k, base: r.seq - lote.length + j + 1, enviadoAtualizado: reg.atualizado });
      }
      for (const c of r.conflitos) {
        await db.sincConflitos.put({ chave: chave(c.tabela, c.id), tabela: c.tabela, id: c.id, atual: c.atual, criadoEm: agora() });
      }
    });
    enviados += r.gravados;
    conflitos += r.conflitos.length;
  }
  return { enviados, conflitos, saltados };
}

/** Recebe tudo o que mudou desde a última vez, uma página de cada vez. */
async function receber(db: OfficeDB, token: string): Promise<number> {
  let desde = Number((await db.meta.get('servidor.seq'))?.valor ?? 0);
  let recebidos = 0;
  const tabelas = [...TABELAS_SINCRONIZADAS.map((t) => db.table(t)), db.sincronia, db.sincConflitos, db.meta];
  for (;;) {
    const pagina = await puxar(token, desde);
    await db.transaction('rw', tabelas, async () => {
      for (const r of pagina.registos) if (await aplicar(db, r)) recebidos++;
      await db.meta.put({ chave: 'servidor.seq', valor: String(pagina.seq) });
    });
    desde = pagina.seq;
    if (pagina.fim) return recebidos;
  }
}

/**
 * Aplica uma versão do servidor. Se o registo tem uma alteração local por enviar, o local fica:
 * a próxima gravação encontra a versão nova do servidor e aparece como conflito, em vez de a apagar.
 */
async function aplicar(db: OfficeDB, r: RegistoServidor): Promise<boolean> {
  if (!(TABELAS_SINCRONIZADAS as readonly string[]).includes(r.tabela) || r.dados === null) return false;
  const k = chave(r.tabela, r.id);
  const s = await db.sincronia.get(k);
  if (s?.base != null && s.base >= r.seq) return false; // esta versão ou uma mais nova já cá estão
  if (await db.sincConflitos.get(k)) return false;
  const tabela = db.table(r.tabela);
  const local = (await tabela.get(r.id)) as { updatedAt?: string } | undefined;
  const alteracoesPorEnviar = !!local && (!s || local.updatedAt !== s.enviadoAtualizado);
  if (alteracoesPorEnviar) return false;
  await tabela.put(r.dados);
  await db.sincronia.put({ chave: k, base: r.seq, enviadoAtualizado: (r.dados as { updatedAt?: string }).updatedAt ?? r.atualizado });
  return true;
}

/** Fica com a versão deste telemóvel: a próxima sincronização envia-a por cima da do servidor. */
export async function manterMinha(db: OfficeDB, conflito: SincConflito): Promise<void> {
  await sincronizandoComServidor(async () => {
    await db.transaction('rw', [db.sincronia, db.sincConflitos], async () => {
      await db.sincronia.put({ chave: conflito.chave, base: conflito.atual?.seq ?? null, enviadoAtualizado: conflito.atual?.atualizado ?? null });
      await db.sincConflitos.delete(conflito.chave);
    });
  });
}

/** Fica com a versão do servidor: substitui a alteração local deste telemóvel. */
export async function usarDoServidor(db: OfficeDB, conflito: SincConflito): Promise<void> {
  const atual = conflito.atual as VersaoServidor | null;
  if (!atual || atual.dados === null) return manterMinha(db, conflito);
  await sincronizandoComServidor(async () => {
    await db.transaction('rw', [db.table(conflito.tabela), db.sincronia, db.sincConflitos], async () => {
      await db.table(conflito.tabela).put(atual.dados as object);
      await db.sincronia.put({ chave: conflito.chave, base: atual.seq, enviadoAtualizado: (atual.dados as { updatedAt?: string }).updatedAt ?? atual.atualizado });
      await db.sincConflitos.delete(conflito.chave);
    });
  });
}

/** Sincroniza ao voltar a ter rede, ao voltar à app e de cinco em cinco minutos. Sem ligação, não faz nada. */
export function iniciarSincronizacaoAutomatica(db: OfficeDB): void {
  const tentar = () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    sincronizar(db).catch(() => undefined);
  };
  window.addEventListener('online', tentar);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tentar(); });
  setInterval(tentar, 5 * 60_000);
  tentar();
}
