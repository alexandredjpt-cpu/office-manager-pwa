import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Inspecao, type InspecaoLinha, type ModalidadeInspecao, type ResultadoInspecao } from '../db/schema';
import { ESTADOS_INSPECAO, MODALIDADES, avaliarLinha, cancelarInspecao, concluirInspecao, iniciarInspecao, resumir } from '../db/inspecoes';
import { pdfInspecao } from '../export/gerar';
import { ir, substituir, voltar } from './router';
import { Aviso, Campo, Modal, dataPt } from './comuns';
import { Fotos } from './Fotos';
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

export function FichaInspecao({ id }: { id: string }) {
  const dados = useDados();
  if (!dados) return null;
  const i = dados.inspecoes.find((x) => x.id === id);
  if (!i) {
    return (<><p className="cartao">Esta inspeção não existe.</p><button className="btn-secundario w-full" onClick={() => voltar('/inspecoes')}>Voltar</button></>);
  }
  return <Corpo key={i.id} i={i} dados={dados} />;
}

function Corpo({ i, dados }: { i: Inspecao; dados: NonNullable<ReturnType<typeof useDados>> }) {
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [obs, setObs] = useState(i.observacoes);
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

      <ul className="space-y-3">
        {itens.map(({ l, e }) => (
          <LinhaCartao key={l.id} l={l} codigo={e?.codigo ?? '?'} nome={e?.nome ?? '?'} editavel={emCurso}
            codigoAnomalia={dados.anomalias.find((a) => a.id === l.anomaliaId)?.codigo ?? ''} anomaliaId={l.anomaliaId}
            aoAvaliar={(res, o) => exec(() => avaliarLinha(db, l.id, res, o))} />
        ))}
      </ul>

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
