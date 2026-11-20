import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Documento, type Marcador } from '../db/schema';
import { colocarMarcador, moverMarcador, removerMarcador } from '../db/plantas';
import { criarArtigo } from '../db/stock';
import { estaAberta } from '../db/anomalias';
import { ir, substituir } from './router';
import { Aviso, Campo, useUrlDoBlob } from './comuns';

/** Planta do local: uma imagem anexada, com marcadores de equipamentos e artigos. */
export function PlantaLocal({ localId, destaque }: { localId: string; destaque: string | null }) {
  const docs = useLiveQuery(
    () => db.documentos.where('[entidade+entidadeId]').equals(['localizacao', localId]).filter((d) => !d.deletedAt && d.mime.startsWith('image/')).sortBy('createdAt'),
    [localId]
  );
  const equips = useLiveQuery(() => db.equipamentos.filter((e) => !e.deletedAt && e.estado !== 'abatido').toArray(), []);
  const artigos = useLiveQuery(() => db.artigos.filter((a) => !a.deletedAt).toArray(), []);
  const anomalias = useLiveQuery(() => db.anomalias.toArray(), []);
  const [escolhida, setEscolhida] = useState<string>('');
  const marcs = useLiveQuery(
    async (): Promise<Marcador[]> => (escolhida ? (await db.marcadores.where('documentoId').equals(escolhida).toArray()).filter((m) => !m.deletedAt) : []),
    [escolhida]
  );
  const [reportar, setReportar] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [mover, setMover] = useState<string | null>(null);
  const [novoArtigo, setNovoArtigo] = useState<string | null>(null);
  const [colocar, setColocar] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const caixa = useRef<HTMLDivElement>(null);

  const doc: Documento | undefined = docs?.find((d) => d.id === escolhida) ?? docs?.[0];
  useEffect(() => { if (doc && doc.id !== escolhida) setEscolhida(doc.id); }, [doc, escolhida]);
  useEffect(() => { if (destaque && marcs?.some((m) => m.refId === destaque)) caixa.current?.scrollIntoView({ block: 'center' }); }, [destaque, marcs]);

  if (!docs || !equips || !artigos || !anomalias) return null;
  if (!doc) {
    return (
      <div className="cartao space-y-1">
        <h3 className="font-semibold">Planta</h3>
        <p className="text-sm text-slate-500">Anexa uma imagem da planta em «Documentos» (abaixo) e ela aparece aqui para marcares equipamentos e artigos.</p>
      </div>
    );
  }

  const nome = (m: Marcador) => (m.tipo === 'equipamento' ? equips.find((e) => e.id === m.refId)?.nome : m.tipo === 'anomalia' ? (() => { const a = anomalias.find((x) => x.id === m.refId); return a ? `${a.codigo} · ${a.titulo}` : undefined; })() : artigos.find((a) => a.id === m.refId)?.nome) ?? '(removido)';
  // Pontos de anomalia só enquanto a anomalia está aberta (resolvida/anulada sai da planta; o histórico mantém-se).
  const visiveis = (marcs ?? []).filter((m) => m.tipo !== 'anomalia' || anomalias.some((a) => a.id === m.refId && estaAberta(a)));
  const selecionado = visiveis.find((m) => m.id === sel);

  async function toque(e: React.MouseEvent<HTMLDivElement>) {
    if ((!colocar && !mover && !reportar) || !caixa.current || !doc) return;
    const r = caixa.current.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    if (reportar) {
      setReportar(false);
      ir(`/anomalias/nova?local=${localId}&planta=${doc.id}&x=${x.toFixed(4)}&y=${y.toFixed(4)}`);
      return;
    }
    if (mover) {
      try { await moverMarcador(db, mover, x, y); setMover(null); setMsg(null); } catch (err) { setMsg({ tipo: 'erro', texto: (err as Error).message }); }
      return;
    }
    const [tipo, refId] = colocar.split(':') as [Marcador['tipo'], string];
    try {
      const m = await colocarMarcador(db, doc.id, tipo, refId, x, y);
      setSel(m.id);
      setColocar('');
      setMsg(null);
    } catch (err) {
      setMsg({ tipo: 'erro', texto: (err as Error).message });
    }
  }

  async function criarEscolher() {
    const nome = (novoArtigo ?? '').trim();
    try {
      const a = await criarArtigo(db, { nome });
      setNovoArtigo(null);
      setColocar(`artigo:${a.id}`);
      setMsg({ tipo: 'ok', texto: `Artigo «${a.nome}» criado. Toca na planta onde fica.` });
    } catch (err) {
      setMsg({ tipo: 'erro', texto: (err as Error).message });
    }
  }

  return (
    <div className="cartao space-y-3">
      <h3 className="font-semibold">Planta</h3>
      {docs.length > 1 && (
        <Campo rotulo="Imagem">
          <select className="campo" value={doc.id} onChange={(e) => { setEscolhida(e.target.value); setSel(null); }}>
            {docs.map((d) => <option key={d.id} value={d.id}>{d.nome}</option>)}
          </select>
        </Campo>
      )}
      <Campo rotulo="Colocar na planta" dica={mover ? 'A mover: toca na planta para o novo sítio.' : colocar ? 'Toca na planta onde fica.' : 'Escolhe um item e toca na planta. Um equipamento tem um só ponto (voltar a colocar muda de posição); um artigo pode ter vários pontos.'}>
        <select className="campo" value={colocar} onChange={(e) => { setColocar(e.target.value); setMover(null); setReportar(false); }}>
          <option value="">—</option>
          <optgroup label="Equipamentos">{equips.sort((a, b) => a.nome.localeCompare(b.nome, 'pt')).map((e) => <option key={e.id} value={`equipamento:${e.id}`}>{e.codigo} · {e.nome}</option>)}</optgroup>
          <optgroup label="Artigos">{artigos.sort((a, b) => a.nome.localeCompare(b.nome, 'pt')).map((a) => <option key={a.id} value={`artigo:${a.id}`}>{a.codigo} · {a.nome}</option>)}</optgroup>
        </select>
      </Campo>
      <button className={reportar ? 'btn-perigo w-full' : 'btn-secundario w-full'} onClick={() => { setReportar((v) => !v); setColocar(''); setMover(null); }}>
        {reportar ? 'Toca na planta onde está o problema (toca aqui para cancelar)' : '⚠ Reportar anomalia aqui'}
      </button>
      {novoArtigo === null ? (
        <button className="btn-secundario w-full" onClick={() => { setNovoArtigo(''); setColocar(''); setMover(null); }}>+ Novo artigo</button>
      ) : (
        <div className="space-y-2 rounded-xl bg-slate-50 p-3">
          <Campo rotulo="Nome do artigo novo" dica="Cria o artigo no Stock (sem quantidade) e já o podes colocar na planta."><input className="campo" value={novoArtigo} onChange={(e) => setNovoArtigo(e.target.value)} autoComplete="off" /></Campo>
          <div className="flex gap-2">
            <button className="btn-primario flex-1" disabled={!novoArtigo.trim()} onClick={() => void criarEscolher()}>Criar e escolher</button>
            <button className="btn-secundario" onClick={() => setNovoArtigo(null)}>Cancelar</button>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-slate-500">Ampliar: {Math.round(zoom * 100)}%</span>
        <div className="flex gap-2">
          <button className="btn-secundario px-4 py-1" aria-label="Reduzir planta" disabled={zoom <= 1} onClick={() => setZoom((z) => Math.max(1, z - 0.5))}>−</button>
          <button className="btn-secundario px-4 py-1" aria-label="Ampliar planta" disabled={zoom >= 4} onClick={() => setZoom((z) => Math.min(4, z + 0.5))}>+</button>
        </div>
      </div>
      <PlantaImagem doc={doc} caixa={caixa} aoToque={toque} aPlacar={!!colocar || !!mover || reportar} zoom={zoom}>
        {visiveis.map((m) => (
          <button
            key={m.id}
            aria-label={`Marcador ${nome(m)}`}
            onClick={(e) => { e.stopPropagation(); setSel(m.id === sel ? null : m.id); }}
            style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }}
            className="absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
          >
            <span className={`block rounded-full border border-white shadow ${m.id === sel ? 'h-4 w-4' : 'h-2.5 w-2.5'} ${m.tipo === 'equipamento' ? 'bg-teal-700' : m.tipo === 'anomalia' ? 'bg-red-600' : 'bg-amber-600'} ${m.refId === destaque ? 'animate-pulse ring-4 ring-red-500' : ''} ${m.id === sel ? 'ring-2 ring-sky-400' : ''}`} />
          </button>
        ))}
      </PlantaImagem>
      {selecionado && (
        <div className="space-y-2 rounded-xl bg-slate-50 p-3 text-sm">
          <p className="font-medium">{nome(selecionado)}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <button className="text-teal-700 underline" onClick={() => ir(selecionado.tipo === 'equipamento' ? `/equipamentos/${selecionado.refId}` : selecionado.tipo === 'anomalia' ? `/anomalias/${selecionado.refId}` : `/stock/${selecionado.refId}`)}>{selecionado.tipo === 'anomalia' ? 'Abrir anomalia' : 'Abrir ficha'}</button>
            <button className="text-teal-700 underline" onClick={() => { setMover(selecionado.id); setColocar(''); }}>Mover</button>
            {selecionado.tipo === 'artigo' && <button className="text-teal-700 underline" onClick={() => { setColocar(`artigo:${selecionado.refId}`); setMover(null); }}>Pôr outro igual</button>}
            {selecionado.tipo !== 'anomalia' && <button className="font-medium text-amber-800 underline" onClick={() => ir(selecionado.tipo === 'equipamento' ? `/anomalias/nova?equip=${selecionado.refId}` : `/anomalias/nova?local=${localId}&titulo=${encodeURIComponent(nome(selecionado))}`)}>Registar anomalia</button>}
            <button className="text-red-700 underline" onClick={async () => { await removerMarcador(db, selecionado.id); setSel(null); }}>Tirar da planta</button>
          </div>
        </div>
      )}
      <p className="text-xs text-slate-500">Ponto verde = equipamento · laranja = artigo · vermelho = anomalia aberta. Usa + para ampliar quando houver pontos juntos. A posição é a que tu marcas; a app não deteta nada sozinha.</p>
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
    </div>
  );
}

function PlantaImagem({ doc, caixa, aoToque, aPlacar, zoom, children }: { doc: Documento; caixa: React.RefObject<HTMLDivElement | null>; aoToque: (e: React.MouseEvent<HTMLDivElement>) => void; aPlacar: boolean; zoom: number; children: React.ReactNode }) {
  const url = useUrlDoBlob(doc.id, doc.blob);
  return (
    <div className={`${zoom > 1 ? "max-h-[70dvh]" : ""} overflow-auto rounded-xl border border-slate-200 ${aPlacar ? 'ring-2 ring-teal-500' : ''}`}>
      <div ref={caixa} onClick={aoToque} style={{ width: `${zoom * 100}%` }} className={`relative ${aPlacar ? 'cursor-crosshair' : ''}`}>
        {url && <img src={url} alt="Planta" draggable={false} className="block w-full select-none" />}
        {children}
      </div>
    </div>
  );
}

/** Ecrã «Plantas» (atalho no Início): escolhe o local e trabalha logo na planta. */
export function EcraPlantas({ id, destaque }: { id: string | null | undefined; destaque: string | null }) {
  const dados = useLiveQuery(async () => {
    const docs = (await db.documentos.toArray()).filter((d) => d.entidade === 'localizacao' && !d.deletedAt && d.mime.startsWith('image/'));
    const ids = new Set(docs.map((d) => d.entidadeId));
    const locais = (await db.localizacoes.toArray()).filter((l) => !l.deletedAt && ids.has(l.id)).sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
    return { locais };
  }, []);
  if (!dados) return null;
  const { locais } = dados;
  const atual = locais.find((l) => l.id === id) ?? locais[0];
  return (
    <>
      <h2 className="text-xl font-semibold">Plantas</h2>
      {locais.length === 0 ? (
        <div className="cartao space-y-2 text-sm text-slate-600">
          <p>Ainda não há plantas. Para criar uma: Mais → Locais → escolhe o local → em «Documentos» toca em «📎 Anexar PDF ou imagem» e escolhe uma imagem.</p>
          <button className="btn-secundario w-full" onClick={() => ir('/locais')}>Ir para Locais</button>
        </div>
      ) : (
        <>
          <Campo rotulo="Local">
            <select className="campo" value={atual.id} onChange={(e) => substituir(`/plantas/${e.target.value}`)}>
              {locais.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
            </select>
          </Campo>
          <PlantaLocal key={atual.id} localId={atual.id} destaque={destaque} />
        </>
      )}
    </>
  );
}
