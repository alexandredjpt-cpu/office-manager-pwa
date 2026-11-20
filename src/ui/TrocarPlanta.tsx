import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Documento, type PontoZona } from '../db/schema';
import { preverTroca, proximoZoom, trocarImagemPlanta, ZOOM_MAX, type Dimensoes, type ParesAlinhamento } from '../db/zonas';
import { Aviso, Campo } from './comuns';
import { COR_PONTO, PlantaImagem } from './Planta';

type Passo = 'antiga' | 'nova' | 'previsao';

/**
 * Trocar a imagem da planta mantendo pontos e zonas: tocar em 2 cantos na antiga e nos mesmos 2 na nova.
 * Nada é gravado antes de confirmar na pré-visualização.
 */
export function TrocarPlanta({ antiga, imagens, aoFechar }: { antiga: Documento; imagens: Documento[]; aoFechar: (mensagem?: string) => void }) {
  const dados = useLiveQuery(async () => {
    const todos = (await db.marcadores.toArray()).filter((m) => !m.deletedAt);
    const zs = (await db.zonas.toArray()).filter((z) => !z.deletedAt);
    const usadas = new Set([...todos.map((m) => m.documentoId), ...zs.map((z) => z.documentoId)]);
    return { marcadores: todos.filter((m) => m.documentoId === antiga.id), zonas: zs.filter((z) => z.documentoId === antiga.id), usadas };
  }, [antiga.id]);
  const [novaId, setNovaId] = useState('');
  const [passo, setPasso] = useState<Passo>('antiga');
  const [pA, setPA] = useState<PontoZona[]>([]);
  const [pN, setPN] = useState<PontoZona[]>([]);
  const [dA, setDA] = useState<Dimensoes | null>(null);
  const [dN, setDN] = useState<Dimensoes | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aGravar, setAGravar] = useState(false);

  if (!dados) return null;
  const candidatas = imagens.filter((d) => d.id !== antiga.id && !dados.usadas.has(d.id));
  const nova = imagens.find((d) => d.id === novaId);

  let previsao: ReturnType<typeof preverTroca> | null = null;
  let erroPrev: string | null = null;
  if (passo === 'previsao' && dA && dN && pA.length === 2 && pN.length === 2) {
    try {
      previsao = preverTroca(dados.marcadores, dados.zonas, { antigo: [pA[0], pA[1]], novo: [pN[0], pN[1]] }, dA, dN);
    } catch (e) {
      erroPrev = (e as Error).message;
    }
  }

  async function confirmar() {
    if (!nova || !dA || !dN) return;
    setAGravar(true);
    setErro(null);
    try {
      const pares: ParesAlinhamento = { antigo: [pA[0], pA[1]], novo: [pN[0], pN[1]] };
      const r = await trocarImagemPlanta(db, antiga.id, nova.id, pares, dA, dN);
      aoFechar(`Imagem trocada: ${r.marcadores} ponto(s) e ${r.zonas} zona(s) passaram para «${nova.nome}». A imagem antiga saiu da planta (continua nas cópias de segurança).`);
    } catch (e) {
      setErro((e as Error).message);
      setAGravar(false);
    }
  }

  return (
    <div className="cartao space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">Trocar imagem da planta</h3>
        <button className="btn-secundario px-3 py-1" onClick={() => aoFechar()}>Cancelar</button>
      </div>
      <p className="text-sm text-slate-600">
        Os {dados.marcadores.length} ponto(s) e {dados.zonas.length} zona(s) de «{antiga.nome}» passam para a imagem nova, no mesmo sítio do edifício.
        Toca em <strong>2 cantos do edifício bem afastados</strong> (ex.: canto de cima à esquerda e canto de baixo à direita) na planta atual e depois nos <strong>mesmos 2 cantos, pela mesma ordem</strong>, na nova.
      </p>
      {candidatas.length === 0 ? (
        <Aviso tipo="erro">Não há outra imagem livre neste local. Anexa primeiro a planta nova em «Documentos» (abaixo); tem de ser uma imagem sem pontos nem zonas.</Aviso>
      ) : (
        <Campo rotulo="Imagem nova">
          <select className="campo" value={novaId} onChange={(e) => { setNovaId(e.target.value); setPN([]); setDN(null); if (passo !== 'antiga') setPasso('nova'); }}>
            <option value="">Escolher…</option>
            {candidatas.map((d) => <option key={d.id} value={d.id}>{d.nome}</option>)}
          </select>
        </Campo>
      )}

      {passo === 'antiga' && (
        <>
          <p className="text-sm font-medium">1. Planta atual: toca no canto {pA.length < 2 ? pA.length + 1 : '—'} de 2</p>
          <EscolherDoisPontos doc={antiga} pontos={pA} aoMudar={setPA} aoCarregar={setDA} />
          <button className="btn-primario w-full" disabled={pA.length < 2 || !nova} onClick={() => setPasso('nova')}>Seguinte: imagem nova</button>
        </>
      )}
      {passo === 'nova' && nova && (
        <>
          <p className="text-sm font-medium">2. Imagem nova: toca nos mesmos cantos, pela mesma ordem ({pN.length < 2 ? `canto ${pN.length + 1} de 2` : 'feito'})</p>
          <EscolherDoisPontos key={nova.id} doc={nova} pontos={pN} aoMudar={setPN} aoCarregar={setDN} />
          <div className="flex gap-2">
            <button className="btn-secundario" onClick={() => setPasso('antiga')}>Voltar</button>
            <button className="btn-primario flex-1" disabled={pN.length < 2 || !dN} onClick={() => setPasso('previsao')}>Ver como fica</button>
          </div>
        </>
      )}
      {passo === 'previsao' && nova && (
        <>
          <p className="text-sm font-medium">3. Confere: os pontos e zonas já estão sobre a imagem nova</p>
          {erroPrev && <Aviso tipo="erro">{erroPrev}</Aviso>}
          {previsao && (
            <>
              <Previsao doc={nova} previsao={previsao} />
              <p className="text-xs text-slate-600">Escala ×{previsao.escala.toFixed(2)} · rotação {previsao.rotacaoGraus.toFixed(1)}°</p>
              {Math.abs(previsao.rotacaoGraus) > 3 && <Aviso tipo="erro">A imagem nova parece rodada {previsao.rotacaoGraus.toFixed(0)}°. Se as plantas estão direitas, tocaste em cantos diferentes ou noutra ordem.</Aviso>}
              {previsao.fora > 0 && <Aviso tipo="erro">{previsao.fora} ponto(s) ou zona(s) ficariam fora da imagem nova. Volta e toca nos mesmos cantos.</Aviso>}
            </>
          )}
          <div className="flex gap-2">
            <button className="btn-secundario" onClick={() => setPasso('nova')}>Voltar</button>
            <button className="btn-primario flex-1" disabled={!previsao || previsao.fora > 0 || aGravar} onClick={() => void confirmar()}>{aGravar ? 'A trocar…' : 'Confirmar troca'}</button>
          </div>
        </>
      )}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
    </div>
  );
}

function EscolherDoisPontos({ doc, pontos, aoMudar, aoCarregar }: { doc: Documento; pontos: PontoZona[]; aoMudar: React.Dispatch<React.SetStateAction<PontoZona[]>>; aoCarregar: (d: Dimensoes) => void }) {
  const caixa = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  function toque(e: React.MouseEvent<HTMLDivElement>) {
    if (!caixa.current) return;
    const r = caixa.current.getBoundingClientRect();
    const p = { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
    aoMudar((ps) => (ps.length >= 2 ? ps : [...ps, p]));
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-sm">
        <button className="text-teal-700 underline disabled:text-slate-400 disabled:no-underline" disabled={pontos.length === 0} onClick={() => aoMudar([])}>Recomeçar cantos</button>
        <div className="flex items-center gap-2">
          <span className="text-slate-500">{Math.round(zoom * 100)}%</span>
          <button className="btn-secundario px-4 py-1" aria-label="Reduzir" disabled={zoom <= 1} onClick={() => setZoom(proximoZoom(zoom, -1))}>−</button>
          <button className="btn-secundario px-4 py-1" aria-label="Ampliar" disabled={zoom >= ZOOM_MAX} onClick={() => setZoom(proximoZoom(zoom, 1))}>+</button>
        </div>
      </div>
      <PlantaImagem doc={doc} caixa={caixa} aoToque={toque} aPlacar={pontos.length < 2} zoom={zoom} aoCarregar={aoCarregar}>
        {pontos.map((p, i) => (
          <span key={i} style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }} className="pointer-events-none absolute z-20 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-fuchsia-600 text-xs font-bold text-white shadow">{i + 1}</span>
        ))}
      </PlantaImagem>
    </div>
  );
}

function Previsao({ doc, previsao }: { doc: Documento; previsao: ReturnType<typeof preverTroca> }) {
  const caixa = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  return (
    <div className="space-y-2">
      <div className="flex justify-end gap-2 text-sm">
        <span className="self-center text-slate-500">{Math.round(zoom * 100)}%</span>
        <button className="btn-secundario px-4 py-1" aria-label="Reduzir" disabled={zoom <= 1} onClick={() => setZoom(proximoZoom(zoom, -1))}>−</button>
        <button className="btn-secundario px-4 py-1" aria-label="Ampliar" disabled={zoom >= ZOOM_MAX} onClick={() => setZoom(proximoZoom(zoom, 1))}>+</button>
      </div>
      <PlantaImagem doc={doc} caixa={caixa} aoToque={() => undefined} aPlacar={false} zoom={zoom}>
        <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
          {previsao.zonas.map((z) => <polygon key={z.id} points={z.novos.map((p) => `${p.x},${p.y}`).join(' ')} fill="rgb(14 165 233 / 0.12)" stroke="#0284c7" strokeWidth={2} vectorEffect="non-scaling-stroke" />)}
        </svg>
        {previsao.marcadores.map((m) => (
          <span key={m.id} style={{ left: `${m.novo.x * 100}%`, top: `${m.novo.y * 100}%` }} className={`pointer-events-none absolute z-10 block h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white shadow ${COR_PONTO[m.tipo]}`} />
        ))}
      </PlantaImagem>
    </div>
  );
}
