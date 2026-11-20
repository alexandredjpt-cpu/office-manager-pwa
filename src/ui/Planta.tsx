import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Documento, type Marcador } from '../db/schema';
import { colocarMarcador, removerMarcador } from '../db/plantas';
import { ir } from './router';
import { Aviso, Campo, useUrlDoBlob } from './comuns';

/** Planta do local: uma imagem anexada, com marcadores de equipamentos e artigos. */
export function PlantaLocal({ localId, destaque }: { localId: string; destaque: string | null }) {
  const docs = useLiveQuery(
    () => db.documentos.where('[entidade+entidadeId]').equals(['localizacao', localId]).filter((d) => !d.deletedAt && d.mime.startsWith('image/')).sortBy('createdAt'),
    [localId]
  );
  const equips = useLiveQuery(() => db.equipamentos.filter((e) => !e.deletedAt && e.estado !== 'abatido').toArray(), []);
  const artigos = useLiveQuery(() => db.artigos.filter((a) => !a.deletedAt).toArray(), []);
  const [escolhida, setEscolhida] = useState<string>('');
  const marcs = useLiveQuery(
    async (): Promise<Marcador[]> => (escolhida ? (await db.marcadores.where('documentoId').equals(escolhida).toArray()).filter((m) => !m.deletedAt) : []),
    [escolhida]
  );
  const [zoom, setZoom] = useState(1);
  const [colocar, setColocar] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const caixa = useRef<HTMLDivElement>(null);

  const doc: Documento | undefined = docs?.find((d) => d.id === escolhida) ?? docs?.[0];
  useEffect(() => { if (doc && doc.id !== escolhida) setEscolhida(doc.id); }, [doc, escolhida]);
  useEffect(() => { if (destaque && marcs?.some((m) => m.refId === destaque)) caixa.current?.scrollIntoView({ block: 'center' }); }, [destaque, marcs]);

  if (!docs || !equips || !artigos) return null;
  if (!doc) {
    return (
      <div className="cartao space-y-1">
        <h3 className="font-semibold">Planta</h3>
        <p className="text-sm text-slate-500">Anexa uma imagem da planta em «Documentos» (abaixo) e ela aparece aqui para marcares equipamentos e artigos.</p>
      </div>
    );
  }

  const nome = (m: Marcador) => (m.tipo === 'equipamento' ? equips.find((e) => e.id === m.refId)?.nome : artigos.find((a) => a.id === m.refId)?.nome) ?? '(removido)';
  const selecionado = marcs?.find((m) => m.id === sel);

  async function toque(e: React.MouseEvent<HTMLDivElement>) {
    if (!colocar || !caixa.current || !doc) return;
    const r = caixa.current.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
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
      <Campo rotulo="Colocar na planta" dica={colocar ? 'Toca na planta onde fica.' : 'Escolhe um item e toca na planta. Se já estiver marcado, muda de posição.'}>
        <select className="campo" value={colocar} onChange={(e) => setColocar(e.target.value)}>
          <option value="">—</option>
          <optgroup label="Equipamentos">{equips.sort((a, b) => a.nome.localeCompare(b.nome, 'pt')).map((e) => <option key={e.id} value={`equipamento:${e.id}`}>{e.codigo} · {e.nome}</option>)}</optgroup>
          <optgroup label="Artigos">{artigos.sort((a, b) => a.nome.localeCompare(b.nome, 'pt')).map((a) => <option key={a.id} value={`artigo:${a.id}`}>{a.codigo} · {a.nome}</option>)}</optgroup>
        </select>
      </Campo>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-slate-500">Ampliar: {Math.round(zoom * 100)}%</span>
        <div className="flex gap-2">
          <button className="btn-secundario px-4 py-1" aria-label="Reduzir planta" disabled={zoom <= 1} onClick={() => setZoom((z) => Math.max(1, z - 0.5))}>−</button>
          <button className="btn-secundario px-4 py-1" aria-label="Ampliar planta" disabled={zoom >= 4} onClick={() => setZoom((z) => Math.min(4, z + 0.5))}>+</button>
        </div>
      </div>
      <PlantaImagem doc={doc} caixa={caixa} aoToque={toque} aPlacar={!!colocar} zoom={zoom}>
        {(marcs ?? []).map((m) => (
          <button
            key={m.id}
            aria-label={`Marcador ${nome(m)}`}
            onClick={(e) => { e.stopPropagation(); setSel(m.id === sel ? null : m.id); }}
            style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }}
            className="absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
          >
            <span className={`block rounded-full border border-white shadow ${m.id === sel ? 'h-4 w-4' : 'h-2.5 w-2.5'} ${m.tipo === 'equipamento' ? 'bg-teal-700' : 'bg-amber-600'} ${m.refId === destaque ? 'animate-pulse ring-4 ring-red-500' : ''} ${m.id === sel ? 'ring-2 ring-sky-400' : ''}`} />
          </button>
        ))}
      </PlantaImagem>
      {selecionado && (
        <div className="space-y-2 rounded-xl bg-slate-50 p-3 text-sm">
          <p className="font-medium">{nome(selecionado)}</p>
          <div className="flex gap-4 text-xs">
            <button className="text-teal-700 underline" onClick={() => ir(selecionado.tipo === 'equipamento' ? `/equipamentos/${selecionado.refId}` : `/stock/${selecionado.refId}`)}>Abrir ficha</button>
            <button className="text-red-700 underline" onClick={async () => { await removerMarcador(db, selecionado.id); setSel(null); }}>Tirar da planta</button>
          </div>
        </div>
      )}
      <p className="text-xs text-slate-500">Ponto verde = equipamento · ponto laranja = artigo. Usa + para ampliar quando houver pontos juntos. A posição é a que tu marcas; a app não deteta nada sozinha.</p>
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
