import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Anomalia, type EstadoAnomalia, type Prioridade, type TipoAtividade } from '../db/schema';
import {
  ESTADOS_ANOMALIA, PRIORIDADES, adicionarAtividade, anularAnomalia, atualizarAnomalia, criarAnomalia, estaAberta, mudarEstadoAnomalia
} from '../db/anomalias';
import { normalizar } from '../db/consultas';
import { vincularAnomalia } from '../db/inspecoes';
import { exportarAnomaliasXlsx } from '../export/anomalias';
import { partilharOuDescarregar } from '../backup/partilha';
import { ir, substituir, voltar } from './router';
import { Aviso, Campo, Modal, SeGestor, SeletorOrdem, dataPt, useOrdem } from './comuns';
import { ordenarListaAnomalias } from '../db/ordenar';
import { dividirDitado, marcarNotaTratada } from '../db/notas';
import { sugerirLocal } from '../db/consultas';
import { BotaoDitar, ditadoSuportado } from './Ditar';
import { ESTADOS_ENCOMENDA } from '../db/encomendas';
import { ContactarAnomalia } from './Contactar';
import { lerPartilha, limparPartilha } from '../db/partilha';
import { adicionarFoto } from '../db/repo';
import { comprimirImagem } from '../fotos/comprimir';
import { useUrlDoBlob } from './comuns';
import { Fotos } from './Fotos';
import { colocarMarcador, ondeEsta } from '../db/plantas';
import { entregarPdf } from './Relatorios';
import { lerResponsavel, pdfAnomalia } from '../export/gerar';
import { EmailPreparar } from './EmailPreparar';
import { camposVazios } from '../db/emails';
import { hojeIso } from '../db/agenda';
import { diaPt } from './comuns';

const COR_PRIORIDADE: Record<Prioridade, string> = { alta: 'bg-red-100 text-red-800', media: 'bg-amber-100 text-amber-900', baixa: 'bg-slate-200 text-slate-700' };
const COR_ESTADO: Record<EstadoAnomalia, string> = {
  por_resolver: 'bg-slate-200 text-slate-700', em_intervencao: 'bg-sky-100 text-sky-800',
  aguarda_verificacao: 'bg-violet-100 text-violet-800', resolvida: 'bg-teal-100 text-teal-800'
};

export const BadgePrioridade = ({ p }: { p: Prioridade }) => <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${COR_PRIORIDADE[p]}`}>{PRIORIDADES[p]}</span>;
export const BadgeEstadoAnomalia = ({ e }: { e: EstadoAnomalia }) => <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${COR_ESTADO[e]}`}>{ESTADOS_ANOMALIA[e]}</span>;

/** Dados simples; as funções de nome são montadas fora da consulta. */
function useDados() {
  const anomalias = useLiveQuery(() => db.anomalias.filter((a) => !a.deletedAt).toArray(), []);
  const locais = useLiveQuery(() => db.localizacoes.toArray(), []);
  const equips = useLiveQuery(() => db.equipamentos.toArray(), []);
  if (!anomalias || !locais || !equips) return undefined;
  return {
    anomalias,
    locaisAtivos: locais.filter((l) => !l.deletedAt).sort((a, b) => a.nome.localeCompare(b.nome, 'pt')),
    equipsLigaveis: equips.filter((e) => !e.deletedAt && e.estado !== 'abatido').sort((a, b) => a.nome.localeCompare(b.nome, 'pt')),
    todosEquips: equips,
    nomeLocal: (id: string) => locais.find((l) => l.id === id)?.nome ?? '?',
    nomeEquip: (id: string | null) => (id ? equips.find((e) => e.id === id)?.nome ?? '?' : '')
  };
}

type Vista = 'abertas' | 'resolvidas' | 'todas';
let vistaGuardada: Vista = 'abertas';

export function ListaAnomalias() {
  const dados = useDados();
  const [vista, setVista] = useState<Vista>(vistaGuardada);
  const [prio, setPrio] = useState<Prioridade | ''>('');
  const [texto, setTexto] = useState('');
  const [ordem, setOrdem] = useOrdem('anomalias');
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  if (!dados) return null;

  const termos = normalizar(texto).split(/\s+/).filter(Boolean);
  const lista = ordenarListaAnomalias(dados.anomalias, ordem, dados.nomeLocal)
    .filter((a) => (vista === 'todas' ? true : vista === 'abertas' ? estaAberta(a) : !estaAberta(a)))
    .filter((a) => !prio || a.prioridade === prio)
    .filter((a) => termos.every((t) => normalizar([a.codigo, a.titulo, a.descricao, dados.nomeLocal(a.localizacaoId), dados.nomeEquip(a.equipamentoId)].join(' ')).includes(t)));
  const abertas = dados.anomalias.filter(estaAberta).length;

  async function exportar() {
    setMsg(null);
    try {
      const { blob, nome } = await exportarAnomaliasXlsx(lista, dados!.nomeLocal, dados!.nomeEquip);
      const r = await partilharOuDescarregar(blob, nome);
      if (r !== 'cancelado') setMsg({ tipo: 'ok', texto: `Guardado em Transferências: ${nome}.` });
    } catch (e) {
      setMsg({ tipo: 'erro', texto: `Falhou: ${(e as Error).message}` });
    }
  }

  return (
    <>
      <div className="flex gap-2">
        <input className="campo" type="search" placeholder="Pesquisar anomalia, local, equipamento…" value={texto} onChange={(e) => setTexto(e.target.value)} />
        <SeGestor><button className="btn-primario shrink-0 px-5" onClick={() => ir('/anomalias/nova')} aria-label="Nova anomalia">+</button></SeGestor>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <select className="campo px-2 text-sm" aria-label="Estado" value={vista} onChange={(e) => { vistaGuardada = e.target.value as Vista; setVista(vistaGuardada); }}>
          <option value="abertas">Abertas ({abertas})</option>
          <option value="resolvidas">Resolvidas</option>
          <option value="todas">Todas</option>
        </select>
        <select className="campo px-2 text-sm" aria-label="Prioridade" value={prio} onChange={(e) => setPrio(e.target.value as Prioridade | '')}>
          <option value="">Todas as prioridades</option>
          {Object.entries(PRIORIDADES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {dados.anomalias.length > 1 && <SeletorOrdem lista="anomalias" ordem={ordem} aoMudar={setOrdem} />}

      {lista.length === 0 ? (
        <p className="cartao text-center text-sm text-slate-500">{dados.anomalias.length === 0 ? 'Sem anomalias. Toca em + para registar a primeira.' : 'Nada com estes filtros.'}</p>
      ) : (
        <ul className="space-y-2">
          {lista.map((a) => (
            <li key={a.id}>
              <button className="cartao w-full text-left active:bg-slate-50" onClick={() => ir(`/anomalias/${a.id}`)}>
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold">{a.titulo}</p>
                  <span className="shrink-0 font-mono text-xs text-slate-500">{a.codigo}</span>
                </div>
                <p className="mt-0.5 text-sm text-slate-500">{[dados.nomeLocal(a.localizacaoId), dados.nomeEquip(a.equipamentoId)].filter(Boolean).join(' · ')}</p>
                <div className="mt-2 flex flex-wrap gap-1.5"><BadgePrioridade p={a.prioridade} /><BadgeEstadoAnomalia e={a.estado} /></div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {lista.length > 0 && <button className="btn-secundario w-full" onClick={exportar}>Exportar {lista.length} para Excel</button>}
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
    </>
  );
}

interface Form { titulo: string; descricao: string; localizacaoId: string; equipamentoId: string; prioridade: Prioridade | '' }

export interface PontoPlanta { documentoId: string; x: number; y: number }

export function FichaAnomalia({ id, local, equipamento, inspecaoLinha, titulo = '', descricao = '', nota = '', partilha = false, ponto = null }: { id: string; local: string; equipamento: string; inspecaoLinha: string; titulo?: string; descricao?: string; nota?: string; partilha?: boolean; ponto?: PontoPlanta | null }) {
  const nova = id === 'nova';
  const anomalia = useLiveQuery(async (): Promise<Anomalia | null | false> => {
    if (nova) return null;
    const a = await db.anomalias.get(id);
    return a && !a.deletedAt ? a : false;
  }, [id]);
  const dados = useDados();
  if (anomalia === undefined || !dados) return null;
  if (anomalia === false) {
    return (<><p className="cartao">Esta anomalia não existe.</p><button className="btn-secundario w-full" onClick={() => voltar('/anomalias')}>Voltar</button></>);
  }
  // Ao vir de um equipamento, o local preenche-se sozinho.
  const eq = equipamento ? dados.todosEquips.find((e) => e.id === equipamento) : undefined;
  const inicial: Form = anomalia
    ? { titulo: anomalia.titulo, descricao: anomalia.descricao, localizacaoId: anomalia.localizacaoId, equipamentoId: anomalia.equipamentoId ?? '', prioridade: anomalia.prioridade }
    : { titulo, descricao, localizacaoId: eq?.localizacaoId ?? local, equipamentoId: eq?.id ?? '', prioridade: '' };
  return <FormAnomalia key={anomalia?.id ?? 'nova'} anomalia={anomalia} inicial={inicial} dados={dados} inspecaoLinha={inspecaoLinha} ponto={ponto} notaOrigem={anomalia ? '' : nota} partilha={!anomalia && partilha} />;
}

function FormAnomalia({ anomalia, inicial, dados, inspecaoLinha, ponto, notaOrigem, partilha }: { anomalia: Anomalia | null; inicial: Form; dados: NonNullable<ReturnType<typeof useDados>>; inspecaoLinha: string; ponto: PontoPlanta | null; notaOrigem: string; partilha: boolean }) {
  const [partilhadas, setPartilhadas] = useState<Blob[]>([]);
  const [sugestao, setSugestao] = useState<{ id: string; nome: string } | null>(null);
  // Fotografias recebidas de outra app (Partilhar → Office Manager).
  useEffect(() => { if (partilha) lerPartilha().then(setPartilhadas).catch(() => setPartilhadas([])); }, [partilha]);
  const [f, setF] = useState<Form>(inicial);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [resolver, setResolver] = useState(false);
  const [nota, setNota] = useState('');
  const [anular, setAnular] = useState(false);
  const [motivo, setMotivo] = useState('');
  const resolvida = anomalia?.estado === 'resolvida';
  // Onde ver na planta: o ponto da anomalia; senão o ponto do equipamento; senão a planta do local.
  const naPlanta = useLiveQuery(async () => {
    if (!anomalia) return null;
    const p = (await ondeEsta(db, 'anomalia', anomalia.id))[0];
    if (p) return { rota: `/plantas/${p.localizacaoId}?destaque=${anomalia.id}`, texto: '📍 Ver localização na planta' };
    if (anomalia.equipamentoId) {
      const e = (await ondeEsta(db, 'equipamento', anomalia.equipamentoId))[0];
      if (e) return { rota: `/plantas/${e.localizacaoId}?destaque=${anomalia.equipamentoId}`, texto: '📍 Ver equipamento na planta' };
    }
    const temPlanta = (await db.documentos.where('[entidade+entidadeId]').equals(['localizacao', anomalia.localizacaoId]).toArray()).some((d) => !d.deletedAt && d.mime.startsWith('image/'));
    return temPlanta ? { rota: `/plantas/${anomalia.localizacaoId}`, texto: '📍 Ver planta do local' } : null;
  }, [anomalia?.id, anomalia?.equipamentoId, anomalia?.localizacaoId]);
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function executar(fn: () => Promise<unknown>, ok?: string) {
    setAviso(null);
    try {
      await fn();
      if (ok) setAviso({ tipo: 'ok', texto: ok });
    } catch (e) {
      setAviso({ tipo: 'erro', texto: (e as Error).message });
    }
  }

  const guardar = () =>
    executar(async () => {
      if (!anomalia) {
        const criada = await criarAnomalia(db, f);
        // Fotografias partilhadas de outra app: juntam-se à anomalia e saem da área temporária.
        if (partilhadas.length) {
          setAviso({ tipo: 'ok', texto: `A juntar ${partilhadas.length} fotografia(s)…` });
          for (const b of partilhadas) { try { await adicionarFoto(db, 'anomalia', criada.id, await comprimirImagem(b)); } catch { /* uma foto ilegível não impede as outras */ } }
          await limparPartilha().catch(() => undefined);
        }
        // Veio de uma nota rápida: a nota fica tratada e ligada a esta anomalia.
        if (notaOrigem) { try { await marcarNotaTratada(db, notaOrigem, 'anomalia', criada.id); } catch { /* nota já tratada: a anomalia fica na mesma */ } }
        // Veio da planta: deixa o ponto marcado (se a planta entretanto desapareceu, a anomalia fica na mesma).
        if (ponto) { try { await colocarMarcador(db, ponto.documentoId, 'anomalia', criada.id, ponto.x, ponto.y); } catch { /* ponto é só posição */ } }
        // Veio de uma inspeção: liga a linha à anomalia e volta à inspeção.
        const linha = inspecaoLinha ? await db.inspecaoLinhas.get(inspecaoLinha) : undefined;
        if (linha) {
          await vincularAnomalia(db, linha.id, criada.id);
          // Veio da inspeção rápida: volta ao mesmo equipamento em ecrã cheio.
          let rapida = false;
          try { rapida = sessionStorage.getItem('om.inspRapida') === linha.inspecaoId; sessionStorage.removeItem('om.inspRapida'); } catch { /* sem armazenamento */ }
          substituir(`/inspecoes/${linha.inspecaoId}${rapida ? '?rapida=1' : ''}`);
        } else {
          substituir(`/anomalias/${criada.id}`);
        }
      } else {
        await atualizarAnomalia(db, anomalia.id, f);
      }
    }, anomalia ? 'Guardado.' : undefined);

  const mudar = (estado: EstadoAnomalia) => executar(() => mudarEstadoAnomalia(db, anomalia!.id, estado));

  // Escolher um equipamento sem local definido herda o local do equipamento
  function escolherEquip(idEq: string) {
    const e = dados.todosEquips.find((x) => x.id === idEq);
    setF((x) => ({ ...x, equipamentoId: idEq, localizacaoId: x.localizacaoId || e?.localizacaoId || '' }));
  }

  const responsavel = useLiveQuery(() => lerResponsavel(db), []) ?? '';
  const opcoesEquip = dados.equipsLigaveis.filter((e) => !f.localizacaoId || e.localizacaoId === f.localizacaoId || e.id === f.equipamentoId);

  return (
    <>
      <button className="text-sm text-teal-700" onClick={() => voltar('/anomalias')}>← Anomalias</button>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">{anomalia ? anomalia.codigo : 'Nova anomalia'}</h2>
        {anomalia && <BadgeEstadoAnomalia e={anomalia.estado} />}
      </div>
      {naPlanta && <button className="btn-secundario w-full" onClick={() => ir(naPlanta.rota)}>{naPlanta.texto}</button>}
      {resolvida && <Aviso tipo="ok">Resolvida em {anomalia?.dataResolucao}. Para alterar os dados, reabre-a.</Aviso>}

      {!anomalia && partilhadas.length > 0 && (
        <div className="cartao space-y-2">
          <p className="font-semibold">Fotografias partilhadas ({partilhadas.length})</p>
          <div className="grid grid-cols-4 gap-2">{partilhadas.map((b, k) => <MiniBlob key={k} blob={b} />)}</div>
          <p className="text-xs text-slate-500">Juntam-se a esta anomalia quando a registares. Escolhe o local e a prioridade.</p>
          <button className="text-sm text-red-700 underline" onClick={async () => { await limparPartilha().catch(() => undefined); setPartilhadas([]); }}>Descartar fotografias</button>
        </div>
      )}

      <div className="cartao space-y-3">
        {!anomalia && ditadoSuportado() && (
          <>
            <BotaoDitar rotulo="🎤 Ditar a anomalia" aoTexto={(t) => {
              setF((x) => {
                if (!x.titulo.trim()) { const d = dividirDitado(t); return { ...x, titulo: d.titulo, descricao: x.descricao ? `${x.descricao}\n${d.descricao}`.trim() : d.descricao }; }
                return { ...x, descricao: x.descricao ? `${x.descricao}\n${t}` : t };
              });
              const l = f.localizacaoId ? null : sugerirLocal(t, dados.locaisAtivos);
              setSugestao(l ? { id: l.id, nome: l.nome } : null);
            }} />
            <p className="text-xs text-slate-500">O Chrome transcreve a voz no serviço da Google (precisa de rede). A app não guarda áudio.</p>
          </>
        )}
        {sugestao && !f.localizacaoId && (
          <div className="flex items-center justify-between gap-2 rounded-xl bg-teal-50 p-3 text-sm">
            <span>📍 Ouvi «{sugestao.nome}». É este o local?</span>
            <span className="flex shrink-0 gap-2">
              <button className="btn-primario px-3 py-2 text-sm" onClick={() => { setF((x) => ({ ...x, localizacaoId: sugestao.id })); setSugestao(null); }}>Sim</button>
              <button className="btn-secundario px-3 py-2 text-sm" onClick={() => setSugestao(null)}>Não</button>
            </span>
          </div>
        )}
        <Campo rotulo="Descrição curta *"><input className="campo" disabled={resolvida} value={f.titulo} onChange={set('titulo')} autoComplete="off" /></Campo>
        <Campo rotulo="Localização *">
          <select className="campo" disabled={resolvida} value={f.localizacaoId} onChange={set('localizacaoId')}>
            <option value="">Escolher…</option>
            {dados.locaisAtivos.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Equipamento (opcional)">
          <select className="campo" disabled={resolvida} value={f.equipamentoId} onChange={(e) => escolherEquip(e.target.value)}>
            <option value="">Nenhum</option>
            {opcoesEquip.map((e) => <option key={e.id} value={e.id}>{e.codigo} · {e.nome}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Prioridade *" dica="Escolhes tu; a app nunca a define sozinha.">
          <select className="campo" disabled={resolvida} value={f.prioridade} onChange={set('prioridade')}>
            <option value="">Escolher…</option>
            {Object.entries(PRIORIDADES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Descrição"><textarea className="campo min-h-24" disabled={resolvida} value={f.descricao} onChange={set('descricao')} /></Campo>
        {!resolvida && <button className="btn-primario w-full" onClick={guardar}>{anomalia ? 'Guardar alterações' : 'Registar anomalia'}</button>}
      </div>
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}

      {anomalia && <div className="cartao"><Fotos entidade="anomalia" entidadeId={anomalia.id} editavel={!resolvida} fase="antes" titulo={anomalia.estado === 'por_resolver' ? 'Fotografias' : 'Fotografias (antes)'} /></div>}
      {anomalia && anomalia.estado !== 'por_resolver' && (
        <div className="cartao space-y-2">
          <Fotos entidade="anomalia" entidadeId={anomalia.id} editavel fase="depois" titulo="Depois da intervenção" />
          <p className="text-xs text-slate-500">Opcional. No PDF aparecem lado a lado com as de antes.</p>
        </div>
      )}
      {anomalia && <ComprasDaAnomalia anomaliaId={anomalia.id} podeCriar={!resolvida} />}
      {anomalia && !resolvida && (
        <ContactarAnomalia anomalia={anomalia} responsavel={responsavel}
          local={dados.locaisAtivos.find((l) => l.id === anomalia.localizacaoId)?.nome ?? ''}
          equipamento={dados.equipsLigaveis.find((e) => e.id === anomalia.equipamentoId)?.nome ?? ''} />
      )}
      {anomalia && (
        <EmailPreparar
          titulo="Preparar e-mail"
          origem="anomalia"
          refId={anomalia.id}
          modeloInicial={resolvida ? 'Intervenção concluída' : 'Comunicação de avaria a fornecedor'}
          campos={{
            ...camposVazios(), anomalia: anomalia.codigo, descricao: anomalia.titulo, prioridade: PRIORIDADES[anomalia.prioridade], estado: ESTADOS_ANOMALIA[anomalia.estado],
            local: dados.locaisAtivos.find((l) => l.id === anomalia.localizacaoId)?.nome ?? '',
            equipamento: dados.equipsLigaveis.find((e) => e.id === anomalia.equipamentoId)?.nome ?? '',
            responsavel, data: diaPt(hojeIso())
          }}
          aoAbrir={async (resumo) => { await adicionarAtividade(db, anomalia.id, 'nota', resumo); }}
        />
      )}

      {anomalia && (
        <div className="cartao space-y-3">
          <h3 className="font-semibold">Estado</h3>
          {resolvida ? (
            <button className="btn-secundario w-full" onClick={() => mudar('por_resolver')}>Reabrir</button>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-2">
                {(['por_resolver', 'em_intervencao', 'aguarda_verificacao'] as const).filter((e) => e !== anomalia.estado).map((e) => (
                  <button key={e} className="btn-secundario" onClick={() => mudar(e)}>Passar a «{ESTADOS_ANOMALIA[e]}»</button>
                ))}
              </div>
              <button className="btn-primario w-full" onClick={() => setResolver(true)}>Confirmar resolvida</button>
              <p className="text-xs text-slate-500">Uma intervenção concluída não resolve a anomalia: só tu confirmas que o problema ficou resolvido.</p>
            </>
          )}
        </div>
      )}
      {anomalia && <Historico id={anomalia.id} />}
      {anomalia && (
        <button className="btn-secundario w-full" onClick={() => executar(async () => { const t = await entregarPdf(() => pdfAnomalia(db, anomalia.id)); if (t) setAviso({ tipo: 'ok', texto: t }); })}>
          Gerar PDF desta anomalia
        </button>
      )}

      {anomalia && <button className="text-center text-sm text-red-700 underline" onClick={() => setAnular(true)}>Anular (registada por engano)</button>}
      <Modal aberto={anular} onFechar={() => setAnular(false)}>
        <p className="font-semibold">Anular {anomalia?.codigo}?</p>
        <p className="text-sm text-slate-600">Desaparece das listas e relatórios. O código não é reutilizado e o motivo fica guardado.</p>
        <Campo rotulo="Motivo *"><input className="campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} autoComplete="off" /></Campo>
        <div className="grid grid-cols-2 gap-3">
          <button className="btn-secundario" onClick={() => setAnular(false)}>Voltar</button>
          <button className="btn-perigo" disabled={!motivo.trim()} onClick={async () => { await executar(async () => { await anularAnomalia(db, anomalia!.id, motivo); substituir('/anomalias'); }); setAnular(false); }}>Anular</button>
        </div>
      </Modal>
      <Modal aberto={resolver} onFechar={() => setResolver(false)}>
        <p className="font-semibold">Confirmas que «{anomalia?.titulo}» ficou resolvida?</p>
        <Campo rotulo="Nota (opcional)"><input className="campo" value={nota} onChange={(e) => setNota(e.target.value)} autoComplete="off" /></Campo>
        <div className="grid grid-cols-2 gap-3">
          <button className="btn-secundario" onClick={() => setResolver(false)}>Ainda não</button>
          <button className="btn-primario" onClick={async () => { await executar(() => mudarEstadoAnomalia(db, anomalia!.id, 'resolvida', nota)); setResolver(false); setNota(''); }}>Sim, resolvida</button>
        </div>
      </Modal>
    </>
  );
}

const TIPOS: Record<TipoAtividade, string> = { estado: 'Estado', intervencao: 'Intervenção', contacto: 'Contacto', nota: 'Nota' };

function Historico({ id }: { id: string }) {
  const itens = useLiveQuery(() => db.atividades.where('anomaliaId').equals(id).sortBy('createdAt'), [id]);
  const [tipo, setTipo] = useState<Exclude<TipoAtividade, 'estado'>>('intervencao');
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  async function adicionar() {
    setErro(null);
    try {
      await adicionarAtividade(db, id, tipo, texto);
      setTexto('');
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  return (
    <div className="cartao space-y-3">
      <h3 className="font-semibold">Histórico</h3>
      <div className="space-y-2">
        <select className="campo" aria-label="Tipo de registo" value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}>
          <option value="intervencao">Intervenção</option>
          <option value="contacto">Contacto relevante</option>
          <option value="nota">Nota</option>
        </select>
        <textarea className="campo min-h-20" aria-label="Texto do registo" placeholder="O que aconteceu? (só contactos com informação útil)" value={texto} onChange={(e) => setTexto(e.target.value)} />
        <button className="btn-secundario w-full" disabled={!texto.trim()} onClick={adicionar}>Acrescentar ao histórico</button>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
      </div>
      {itens && (
        <ul className="divide-y divide-slate-100 text-sm">
          {[...itens].reverse().map((x) => (
            <li key={x.id} className="py-2">
              <p><span className="mr-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{TIPOS[x.tipo]}</span>{x.texto}</p>
              <p className="text-xs text-slate-500">{dataPt(x.createdAt)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MiniBlob({ blob }: { blob: Blob }) {
  const [id] = useState(() => crypto.randomUUID());
  const url = useUrlDoBlob(id, blob);
  return <div className="aspect-square overflow-hidden rounded-xl bg-slate-200">{url && <img src={url} alt="" className="h-full w-full object-cover" />}</div>;
}

/** Encomendas criadas a partir desta anomalia (ex.: a peça que é preciso comprar). */
function ComprasDaAnomalia({ anomaliaId, podeCriar }: { anomaliaId: string; podeCriar: boolean }) {
  const encs = useLiveQuery(() => db.encomendas.filter((e) => !e.deletedAt && e.anomaliaId === anomaliaId).toArray(), [anomaliaId]);
  const forn = useLiveQuery(() => db.fornecedores.toArray(), []);
  if (!encs || !forn || (encs.length === 0 && !podeCriar)) return null;
  return (
    <div className="cartao space-y-2">
      <h3 className="font-semibold">Compras</h3>
      {encs.length > 0 && (
        <ul className="divide-y divide-slate-100 text-sm">
          {encs.map((e) => (
            <li key={e.id}>
              <button className="flex w-full items-center justify-between py-2 text-left" onClick={() => ir(`/encomendas/${e.id}`)}>
                <span><span className="font-medium text-teal-700 underline">{e.codigo}</span> · {forn.find((f) => f.id === e.fornecedorId)?.nome ?? '?'}</span>
                <span className="text-xs text-slate-500">{ESTADOS_ENCOMENDA[e.estado]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {podeCriar && <button className="btn-secundario w-full" onClick={() => ir(`/encomendas?anomalia=${anomaliaId}`)}>🛒 Criar encomenda para isto</button>}
      {podeCriar && <p className="text-xs text-slate-500">Opcional. A encomenda fica ligada a esta anomalia e segue o fluxo normal de aprovação.</p>}
    </div>
  );
}
