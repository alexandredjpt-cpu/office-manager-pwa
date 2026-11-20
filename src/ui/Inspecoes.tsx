import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Inspecao, type InspecaoLinha, type ModalidadeInspecao, type ResultadoInspecao } from '../db/schema';
import { ESTADOS_INSPECAO, MODALIDADES, avaliarLinha, cancelarInspecao, concluirInspecao, iniciarInspecao, proximaPorAvaliar, resumir } from '../db/inspecoes';
import { lerResponsavel, pdfInspecao } from '../export/gerar';
import { EmailPreparar } from './EmailPreparar';
import { camposVazios } from '../db/emails';
import { ir, substituir, voltar } from './router';
import { Aviso, Campo, Modal, dataPt, useUrlDoBlob } from './comuns';
import type { Equipamento, Fotografia } from '../db/schema';
import { Fotos } from './Fotos';
import { AssinaturaInspecao } from './Assinatura';
import { entregarPdf } from './Relatorios';

const COR = { em_curso: 'bg-sky-100 text-sky-800', concluida: 'bg-teal-100 text-teal-800', cancelada: 'bg-slate-200 text-slate-700' } as const;
const Badge = ({ i }: { i: Inspecao }) => <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${COR[i.estado]}`}>{ESTADOS_INSPECAO[i.estado]}</span>;

function useDados() {
  const inspecoes = useLiveQuery(() => db.inspecoes.toArray(), []);
  const linhas = useLiveQuery(() => db.inspecaoLinhas.toArray(), []);
  const locais = useLiveQuery(() => db.localizacoes.toArray(), []);
  const equips = useLiveQuery(() => db.equipamentos.toArray(), []);
  const anomalias = useLiveQuery(() => db.anomalias.toArray(), []);
  if (!inspecoes || !linhas || !locais || !equips || !anomalias) return undefined;
  return {
    inspecoes: [...inspecoes].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    linhas, equips, anomalias,
    locaisAtivos: locais.filter((l) => !l.deletedAt).sort((a, b) => a.nome.localeCompare(b.nome, 'pt')),
    nomeLocal: (id: string) => locais.find((l) => l.id === id)?.nome ?? '?'
  };
}

export function ListaInspecoes() {
  const dados = useDados();
  const [local, setLocal] = useState('');
  const [modalidade, setModalidade] = useState<ModalidadeInspecao>('pontual');
  const [erro, setErro] = useState<string | null>(null);
  if (!dados) return null;

  async function iniciar() {
    setErro(null);
    try {
      const i = await iniciarInspecao(db, { localizacaoId: local, modalidade });
      ir(`/inspecoes/${i.id}`);
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  return (
    <>
      <button className="text-sm text-teal-700" onClick={() => voltar('/mais')}>← Mais</button>
      <h2 className="text-xl font-semibold">Inspeções</h2>
      <div className="cartao space-y-3">
        <h3 className="font-semibold">Nova inspeção</h3>
        <Campo rotulo="Local">
          <select className="campo" value={local} onChange={(e) => setLocal(e.target.value)}>
            <option value="">Escolher…</option>
            {dados.locaisAtivos.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Modalidade" dica="É só uma etiqueta: a app não agenda nem avisa.">
          <select className="campo" value={modalidade} onChange={(e) => setModalidade(e.target.value as ModalidadeInspecao)}>
            {Object.entries(MODALIDADES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Campo>
        <button className="btn-primario w-full" disabled={!local} onClick={iniciar}>Iniciar inspeção</button>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
      </div>

      {dados.inspecoes.length === 0 ? (
        <p className="cartao text-center text-sm text-slate-500">Ainda não fizeste inspeções.</p>
      ) : (
        <ul className="space-y-2">
          {dados.inspecoes.map((i) => {
            const r = resumir(dados.linhas.filter((l) => l.inspecaoId === i.id));
            return (
              <li key={i.id}>
                <button className="cartao w-full text-left active:bg-slate-50" onClick={() => ir(`/inspecoes/${i.id}`)}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold">{dados.nomeLocal(i.localizacaoId)}</p>
                    <span className="shrink-0 font-mono text-xs text-slate-500">{i.codigo}</span>
                  </div>
                  <p className="mt-0.5 text-sm text-slate-500">{MODALIDADES[i.modalidade]} · {dataPt(i.concluidaEm ?? i.createdAt)}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                    <Badge i={i} />
                    <span>{r.conformes} conf.</span>
                    <span className={r.comAnomalia ? 'font-medium text-amber-800' : ''}>{r.comAnomalia} c/ anomalia</span>
                    <span>{r.naoVerificados} n/ verif.</span>
                    {r.porAvaliar > 0 && <span>{r.porAvaliar} por avaliar</span>}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

export function FichaInspecao({ id, rapida = false }: { id: string; rapida?: boolean }) {
  const dados = useDados();
  if (!dados) return null;
  const i = dados.inspecoes.find((x) => x.id === id);
  if (!i) {
    return (<><p className="cartao">Esta inspeção não existe.</p><button className="btn-secundario w-full" onClick={() => voltar('/inspecoes')}>Voltar</button></>);
  }
  if (rapida && i.estado === 'em_curso') return <InspecaoRapida key={i.id} i={i} dados={dados} />;
  return <Corpo key={i.id} i={i} dados={dados} />;
}

function Corpo({ i, dados }: { i: Inspecao; dados: NonNullable<ReturnType<typeof useDados>> }) {
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [obs, setObs] = useState(i.observacoes);
  const responsavel = useLiveQuery(() => lerResponsavel(db), []) ?? '';
  const [cancelar, setCancelar] = useState(false);
  const emCurso = i.estado === 'em_curso';
  const linhas = dados.linhas.filter((l) => l.inspecaoId === i.id);
  const r = resumir(linhas);
  const itens = linhas
    .map((l) => ({ l, e: dados.equips.find((x) => x.id === l.equipamentoId) }))
    .sort((a, b) => (a.e?.codigo ?? '').localeCompare(b.e?.codigo ?? ''));

  async function exec(fn: () => Promise<unknown>, ok?: string) {
    setAviso(null);
    try {
      await fn();
      if (ok) setAviso({ tipo: 'ok', texto: ok });
    } catch (e) {
      setAviso({ tipo: 'erro', texto: (e as Error).message });
    }
  }

  return (
    <>
      <button className="text-sm text-teal-700" onClick={() => voltar('/inspecoes')}>← Inspeções</button>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">{i.codigo}</h2>
        <Badge i={i} />
      </div>
      <p className="text-sm text-slate-600">{dados.nomeLocal(i.localizacaoId)} · {MODALIDADES[i.modalidade]} · iniciada {dataPt(i.createdAt)}</p>
      <p className="text-sm">{r.conformes} conforme(s) · {r.comAnomalia} com anomalia · {r.naoVerificados} não verificado(s){r.porAvaliar > 0 && ` · ${r.porAvaliar} por avaliar`}</p>

      {emCurso && itens.length > 0 && (
        <button className="btn-primario w-full py-4 text-base" onClick={() => ir(`/inspecoes/${i.id}?rapida=1`)}>⚡ Inspeção rápida (um de cada vez)</button>
      )}

      <ul className="space-y-3">
        {itens.map(({ l, e }) => (
          <LinhaCartao key={l.id} l={l} codigo={e?.codigo ?? '?'} nome={e?.nome ?? '?'} editavel={emCurso}
            codigoAnomalia={dados.anomalias.find((a) => a.id === l.anomaliaId)?.codigo ?? ''} anomaliaId={l.anomaliaId}
            aoAvaliar={(res, o) => exec(() => avaliarLinha(db, l.id, res, o))} />
        ))}
      </ul>

      <AssinaturaInspecao inspecaoId={i.id} editavel={emCurso} />

      <div className="cartao space-y-3">
        <Campo rotulo="Observações da inspeção"><textarea className="campo min-h-20" disabled={!emCurso} value={obs} onChange={(e) => setObs(e.target.value)} /></Campo>
        {emCurso && (
          <>
            <button className="btn-primario w-full" onClick={() => exec(() => concluirInspecao(db, i.id, obs))}>Concluir inspeção</button>
            <button className="btn-secundario w-full" onClick={() => setCancelar(true)}>Cancelar inspeção</button>
          </>
        )}
      </div>
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}

      <div className="cartao"><Fotos entidade="inspecao" entidadeId={i.id} editavel={emCurso} /></div>

      <button className="btn-secundario w-full" onClick={() => exec(async () => { const t = await entregarPdf(() => pdfInspecao(db, i.id)); if (t) setAviso({ tipo: 'ok', texto: t }); })}>
        Gerar PDF desta inspeção
      </button>
      <EmailPreparar
        titulo="Enviar relatório por e-mail"
        origem="inspecao"
        refId={i.id}
        modeloInicial="Envio de relatório de inspeção"
        campos={{ ...camposVazios(), inspecao: i.codigo, local: dados.nomeLocal(i.localizacaoId), data: dataPt(i.concluidaEm ?? i.createdAt), responsavel }}
      />

      <Modal aberto={cancelar} onFechar={() => setCancelar(false)}>
        <p className="font-semibold">Cancelar {i.codigo}?</p>
        <p className="text-sm text-slate-600">Fica registada como cancelada e não conta como realizada.</p>
        <div className="grid grid-cols-2 gap-3">
          <button className="btn-secundario" onClick={() => setCancelar(false)}>Continuar</button>
          <button className="btn-perigo" onClick={async () => { await exec(() => cancelarInspecao(db, i.id)); setCancelar(false); }}>Cancelar inspeção</button>
        </div>
      </Modal>
    </>
  );
}

const BTN: [ResultadoInspecao, string][] = [['conforme', 'Conforme'], ['com_anomalia', 'Com anomalia'], ['nao_verificado', 'Não verificado']];

function LinhaCartao({ l, codigo, nome, editavel, codigoAnomalia, anomaliaId, aoAvaliar }: {
  l: InspecaoLinha; codigo: string; nome: string; editavel: boolean; codigoAnomalia: string; anomaliaId: string | null;
  aoAvaliar: (r: ResultadoInspecao, obs: string) => void;
}) {
  const [obs, setObs] = useState(l.observacoes);
  return (
    <li className="cartao space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold">{nome}</p>
        <span className="shrink-0 font-mono text-xs text-slate-500">{codigo}</span>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {BTN.map(([r, texto]) => (
          <button key={r} disabled={!editavel} aria-pressed={l.resultado === r} onClick={() => aoAvaliar(r, obs)}
            className={`rounded-xl border px-1 py-2.5 text-xs font-medium ${l.resultado === r ? (r === 'com_anomalia' ? 'border-amber-500 bg-amber-100' : 'border-teal-600 bg-teal-100') : 'border-slate-300 bg-white'} disabled:opacity-60`}>
            {texto}
          </button>
        ))}
      </div>
      {l.resultado === null && <p className="text-xs text-slate-500">Por avaliar</p>}
      <input className="campo py-2 text-sm" disabled={!editavel} placeholder="Observação (opcional)" value={obs} onChange={(e) => setObs(e.target.value)}
        onBlur={() => { if (l.resultado && obs.trim() !== l.observacoes) aoAvaliar(l.resultado, obs); }} />
      {anomaliaId ? (
        <button className="text-sm text-teal-700 underline" onClick={() => ir(`/anomalias/${anomaliaId}`)}>Anomalia {codigoAnomalia}</button>
      ) : (
        editavel && l.resultado === 'com_anomalia' && (
          <button className="btn-secundario w-full py-2 text-sm" onClick={() => ir(`/anomalias/nova?equip=${l.equipamentoId}&insp=${l.id}`)}>Criar anomalia a partir disto</button>
        )
      )}
    </li>
  );
}

export { substituir };

/** Fotografia do equipamento (a primeira), para o reconhecer no local. */
function FotoEquipamento({ equipamentoId }: { equipamentoId: string }) {
  const foto = useLiveQuery(async () => (await db.fotografias.where('[entidade+entidadeId]').equals(['equipamento', equipamentoId]).filter((f) => !f.deletedAt).sortBy('createdAt'))[0] ?? null, [equipamentoId]);
  if (!foto) return null;
  return <Imagem foto={foto} />;
}
function Imagem({ foto }: { foto: Fotografia }) {
  const url = useUrlDoBlob(foto.id, foto.blob);
  return url ? <img src={url} alt="Fotografia do equipamento" className="max-h-[28dvh] w-full rounded-2xl object-contain" /> : null;
}

/** Chave para a ficha da anomalia saber que deve voltar ao modo rápido. */
export const CHAVE_VOLTAR_RAPIDA = 'om.inspRapida';

/**
 * Inspeção rápida: ecrã cheio, um equipamento de cada vez, botões grandes.
 * Conforme e Não vi avançam sozinhos; Com problema fica no equipamento para foto, nota e anomalia.
 */
function InspecaoRapida({ i, dados }: { i: Inspecao; dados: NonNullable<ReturnType<typeof useDados>> }) {
  const itens = dados.linhas
    .filter((l) => l.inspecaoId === i.id)
    .map((l) => ({ l, e: dados.equips.find((x) => x.id === l.equipamentoId) as Equipamento | undefined }))
    .sort((a, b) => (a.e?.codigo ?? '').localeCompare(b.e?.codigo ?? ''));
  const [idx, setIdx] = useState(() => Math.max(0, proximaPorAvaliar(itens.map((x) => x.l.resultado))));
  const [fim, setFim] = useState(() => proximaPorAvaliar(itens.map((x) => x.l.resultado)) === -1);
  const [obs, setObs] = useState(itens[idx]?.l.observacoes ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const r = resumir(itens.map((x) => x.l));
  const atual = itens[idx];

  const ir_ = (k: number) => { setIdx(k); setObs(itens[k]?.l.observacoes ?? ''); setErro(null); setFim(false); window.scrollTo(0, 0); };
  const sair = () => substituir(`/inspecoes/${i.id}`);

  async function avaliar(res: ResultadoInspecao) {
    setErro(null);
    try {
      await avaliarLinha(db, atual.l.id, res, obs);
      if (res === 'com_anomalia') return; // fica para foto, nota e anomalia
      seguinte(res);
    } catch (e) { setErro((e as Error).message); }
  }
  function seguinte(resAtual: ResultadoInspecao | null = atual.l.resultado) {
    const resultados = itens.map((x, k) => (k === idx ? resAtual : x.l.resultado));
    const k = proximaPorAvaliar(resultados, idx + 1);
    if (k === -1) { setFim(true); setErro(null); } else ir_(k);
  }
  async function guardarObs() {
    if (atual.l.resultado && obs.trim() !== atual.l.observacoes) { try { await avaliarLinha(db, atual.l.id, atual.l.resultado, obs); } catch (e) { setErro((e as Error).message); } }
  }

  const cor = (res: ResultadoInspecao, base: string) => `${base} ${atual?.l.resultado === res ? 'ring-4 ring-offset-2 ring-offset-slate-50' : ''}`;

  return (
    <div className="fixed inset-0 z-20 flex flex-col overflow-y-auto bg-slate-50 pb-[env(safe-area-inset-bottom)] pt-[max(env(safe-area-inset-top),8px)]">
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-4 p-4">
        <div className="flex items-center justify-between gap-2">
          <button className="text-sm text-teal-700" onClick={sair}>✕ Sair do modo rápido</button>
          <span className="text-sm text-slate-500">{i.codigo} · {dados.nomeLocal(i.localizacaoId)}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
          <div className="h-full bg-teal-600" style={{ width: `${((r.total - r.porAvaliar) / Math.max(1, r.total)) * 100}%` }} />
        </div>
        <p className="text-sm text-slate-600">{r.total - r.porAvaliar} de {r.total} avaliados{r.porAvaliar ? ` · faltam ${r.porAvaliar}` : ''}</p>

        {fim ? (
          <div className="cartao space-y-3 text-center">
            <p className="text-2xl">✓</p>
            <p className="text-lg font-semibold">Todos avaliados</p>
            <p className="text-sm">{r.conformes} conforme(s) · {r.comAnomalia} com problema · {r.naoVerificados} não visto(s)</p>
            {erro && <Aviso tipo="erro">{erro}</Aviso>}
            <div className="text-left"><AssinaturaInspecao inspecaoId={i.id} editavel /></div>
            <button className="btn-primario w-full py-4 text-base" onClick={async () => { try { await concluirInspecao(db, i.id, i.observacoes); substituir(`/inspecoes/${i.id}`); } catch (e) { setErro((e as Error).message); } }}>Concluir inspeção</button>
            <button className="btn-secundario w-full" onClick={() => ir_(0)}>Rever um a um</button>
            <button className="btn-secundario w-full" onClick={sair}>Ver a lista</button>
          </div>
        ) : atual && (
          <>
            <div className="cartao space-y-2 text-center">
              <p className="font-mono text-xs text-slate-500">{idx + 1} / {itens.length} · {atual.e?.codigo ?? '?'}{atual.e?.numeroImobilizado ? ` · ${atual.e.numeroImobilizado}` : ''}</p>
              <p className="text-2xl font-semibold leading-tight">{atual.e?.nome ?? '?'}</p>
              {atual.e && <p className="text-sm text-slate-500">{[atual.e.categoria, [atual.e.marca, atual.e.modelo].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}</p>}
              {atual.e && <FotoEquipamento equipamentoId={atual.e.id} />}
            </div>

            <div className="grid gap-3">
              <button className={cor('conforme', 'rounded-2xl bg-teal-700 py-5 text-lg font-semibold text-white ring-teal-500 active:scale-[.98]')} aria-pressed={atual.l.resultado === 'conforme'} onClick={() => avaliar('conforme')}>✓ Conforme</button>
              <button className={cor('com_anomalia', 'rounded-2xl bg-amber-600 py-5 text-lg font-semibold text-white ring-amber-400 active:scale-[.98]')} aria-pressed={atual.l.resultado === 'com_anomalia'} onClick={() => avaliar('com_anomalia')}>⚠ Com problema</button>
              <button className={cor('nao_verificado', 'btn-secundario py-5 text-lg ring-slate-400')} aria-pressed={atual.l.resultado === 'nao_verificado'} onClick={() => avaliar('nao_verificado')}>Não vi</button>
            </div>
            {erro && <Aviso tipo="erro">{erro}</Aviso>}

            {atual.l.resultado === 'com_anomalia' && (
              <div className="cartao space-y-3">
                <Campo rotulo="O que se passa?"><input className="campo" value={obs} onChange={(e) => setObs(e.target.value)} onBlur={guardarObs} placeholder="Ex.: ecrã partido" autoComplete="off" /></Campo>
                <Fotos entidade="inspecaoLinha" entidadeId={atual.l.id} editavel />
                {atual.l.anomaliaId ? (
                  <p className="text-sm text-teal-700">Anomalia {dados.anomalias.find((a) => a.id === atual.l.anomaliaId)?.codigo} criada.</p>
                ) : (
                  <button className="btn-secundario w-full" onClick={async () => {
                    await guardarObs();
                    try { sessionStorage.setItem(CHAVE_VOLTAR_RAPIDA, i.id); } catch { /* sem armazenamento: volta à lista */ }
                    const q = new URLSearchParams({ equip: atual.l.equipamentoId, insp: atual.l.id });
                    if (obs.trim()) q.set('titulo', obs.trim().slice(0, 80));
                    ir(`/anomalias/nova?${q}`);
                  }}>Criar anomalia agora (as fotos passam para ela)</button>
                )}
                <button className="btn-primario w-full py-4 text-base" onClick={async () => { await guardarObs(); seguinte(); }}>Seguinte →</button>
              </div>
            )}

            <div className="mt-auto grid grid-cols-2 gap-3 pt-2">
              <button className="btn-secundario" disabled={idx === 0} onClick={() => ir_(idx - 1)}>← Anterior</button>
              <button className="btn-secundario" disabled={idx === itens.length - 1} onClick={() => ir_(idx + 1)}>Saltar →</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Atalho para inspecionar um local a partir da ficha do local ou da planta. */
export function BotaoInspecaoLocal({ localId }: { localId: string }) {
  const emCurso = useLiveQuery(async () => (await db.inspecoes.where('localizacaoId').equals(localId).toArray()).find((i) => !i.deletedAt && i.estado === 'em_curso') ?? null, [localId]);
  const [aberto, setAberto] = useState(false);
  const [modalidade, setModalidade] = useState<ModalidadeInspecao>('pontual');
  const [erro, setErro] = useState<string | null>(null);
  if (emCurso === undefined) return null;
  if (emCurso) return <button className="btn-secundario w-full" onClick={() => ir(`/inspecoes/${emCurso.id}`)}>🔍 Continuar inspeção em curso ({emCurso.codigo})</button>;
  return (
    <>
      <button className="btn-secundario w-full" onClick={() => { setErro(null); setAberto(true); }}>🔍 Iniciar inspeção deste local</button>
      <Modal aberto={aberto} onFechar={() => setAberto(false)}>
        <p className="font-semibold">Iniciar inspeção</p>
        <Campo rotulo="Modalidade" dica="É só uma etiqueta: a app não agenda nem avisa.">
          <select className="campo" value={modalidade} onChange={(e) => setModalidade(e.target.value as ModalidadeInspecao)}>
            {Object.entries(MODALIDADES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Campo>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <button className="btn-primario w-full" onClick={async () => { try { const i = await iniciarInspecao(db, { localizacaoId: localId, modalidade }); setAberto(false); ir(`/inspecoes/${i.id}`); } catch (e) { setErro((e as Error).message); } }}>Iniciar</button>
        <button className="btn-secundario w-full" onClick={() => setAberto(false)}>Cancelar</button>
      </Modal>
    </>
  );
}
