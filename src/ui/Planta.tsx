import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Documento, type Marcador } from '../db/schema';
import { colocarMarcador, moverMarcador, removerMarcador } from '../db/plantas';
import { criarArtigo } from '../db/stock';
import { criarEquipamento } from '../db/repo';
import { estaAberta } from '../db/anomalias';
import { BotaoInspecaoLocal } from './Inspecoes';
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
  const todosLocais = useLiveQuery(() => db.localizacoes.toArray(), []);
  const contagens = useLiveQuery(() => db.contagensStock.toArray(), []);
  const [zoom, setZoom] = useState(1);
  const [mover, setMover] = useState<string | null>(null);
  const [novo, setNovo] = useState<{ tipo: 'artigo' | 'equipamento'; nome: string } | null>(null);
  const [colocar, setColocar] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const caixa = useRef<HTMLDivElement>(null);
  // Com destaque, abre a imagem onde esse item está marcado.
  const docDestaque = useLiveQuery(async () => (destaque ? ((await db.marcadores.filter((m) => !m.deletedAt && m.refId === destaque).first())?.documentoId ?? '') : ''), [destaque]);

  const doc: Documento | undefined = docs?.find((d) => d.id === escolhida) ?? docs?.find((d) => d.id === docDestaque) ?? docs?.[0];
  useEffect(() => { if (doc && doc.id !== escolhida) setEscolhida(doc.id); }, [doc, escolhida]);
  useEffect(() => { if (destaque && marcs?.some((m) => m.refId === destaque)) caixa.current?.scrollIntoView({ block: 'center' }); }, [destaque, marcs]);

  if (!docs || !equips || !artigos || !anomalias || !todosLocais || !contagens) return null;
  if (!doc) {
    return (
      <div className="cartao space-y-1">
        <h3 className="font-semibold">Planta</h3>
        <p className="text-sm text-slate-500">Anexa uma imagem da planta em «Documentos» (abaixo) e ela aparece aqui para marcares equipamentos e artigos.</p>
      </div>
    );
  }

  const nome = (m: Marcador) => (m.tipo === 'local' ? todosLocais.find((l) => l.id === m.refId)?.nome : m.tipo === 'equipamento' ? equips.find((e) => e.id === m.refId)?.nome : m.tipo === 'anomalia' ? (() => { const a = anomalias.find((x) => x.id === m.refId); return a ? `${a.codigo} · ${a.titulo}` : undefined; })() : artigos.find((a) => a.id === m.refId)?.nome) ?? '(removido)';
  // Pontos de anomalia só enquanto a anomalia está aberta (resolvida/anulada sai da planta; o histórico mantém-se).
  const visiveis = (marcs ?? []).filter((m) => m.tipo !== 'anomalia' || m.refId === destaque || anomalias.some((a) => a.id === m.refId && estaAberta(a)));
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
    if (!novo) return;
    try {
      if (novo.tipo === 'artigo') {
        const a = await criarArtigo(db, { nome: novo.nome });
        setColocar(`artigo:${a.id}`);
        setMsg({ tipo: 'ok', texto: `Artigo «${a.nome}» criado. Toca na planta onde fica.` });
      } else {
        const e = await criarEquipamento(db, { nome: novo.nome, localizacaoId: localId });
        setColocar(`equipamento:${e.id}`);
        setMsg({ tipo: 'ok', texto: `Equipamento ${e.codigo} «${e.nome}» criado neste local. Toca na planta onde fica.` });
      }
      setNovo(null);
    } catch (err) {
      setMsg({ tipo: 'erro', texto: (err as Error).message });
    }
  }

  const listaEquips = [...equips].sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
  const listaLocais = todosLocais.filter((l) => !l.deletedAt && l.id !== localId).sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
  const listaArtigos = [...artigos].sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
  const semItens = listaEquips.length + listaLocais.length + listaArtigos.length === 0;

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
        {semItens ? (
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Ainda não há equipamentos, artigos nem outros locais para colocar. Cria um com os botões abaixo.</p>
        ) : (
          <select className="campo" value={colocar} onChange={(e) => { setColocar(e.target.value); setMover(null); setReportar(false); }}>
            <option value="">Escolher…</option>
            {listaEquips.length > 0 && <optgroup label="Equipamentos">{listaEquips.map((e) => <option key={e.id} value={`equipamento:${e.id}`}>{e.codigo} · {e.nome}</option>)}</optgroup>}
            {listaLocais.length > 0 && <optgroup label="Locais (armários, prateleiras…)">{listaLocais.map((l) => <option key={l.id} value={`local:${l.id}`}>{l.nome}</option>)}</optgroup>}
            {listaArtigos.length > 0 && <optgroup label="Artigos">{listaArtigos.map((a) => <option key={a.id} value={`artigo:${a.id}`}>{a.codigo} · {a.nome}</option>)}</optgroup>}
          </select>
        )}
      </Campo>
      <button className={reportar ? 'btn-perigo w-full' : 'btn-secundario w-full'} onClick={() => { setReportar((v) => !v); setColocar(''); setMover(null); }}>
        {reportar ? 'Toca na planta onde está o problema (toca aqui para cancelar)' : '⚠ Reportar anomalia aqui'}
      </button>
      {novo === null ? (
        <div className="grid grid-cols-2 gap-2">
          <button className="btn-secundario" onClick={() => { setNovo({ tipo: 'artigo', nome: '' }); setColocar(''); setMover(null); }}>+ Novo artigo</button>
          <button className="btn-secundario" onClick={() => { setNovo({ tipo: 'equipamento', nome: '' }); setColocar(''); setMover(null); }}>+ Novo equipamento</button>
        </div>
      ) : (
        <div className="space-y-2 rounded-xl bg-slate-50 p-3">
          <Campo rotulo={novo.tipo === 'artigo' ? 'Nome do artigo novo' : 'Nome do equipamento novo'} dica={novo.tipo === 'artigo' ? 'Cria o artigo no Stock (sem quantidade) e já o podes colocar na planta.' : 'Cria o equipamento neste local; os outros dados (marca, nº de imobilizado…) completas depois na ficha.'}>
            <input className="campo" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} autoComplete="off" />
          </Campo>
          <div className="flex gap-2">
            <button className="btn-primario flex-1" disabled={!novo.nome.trim()} onClick={() => void criarEscolher()}>Criar e escolher</button>
            <button className="btn-secundario" onClick={() => setNovo(null)}>Cancelar</button>
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
            className={`absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center ${colocar || mover || reportar ? 'pointer-events-none' : ''} ${m.id === sel ? 'z-20' : sel ? 'z-0 opacity-30' : 'z-10'}`}
          >
            {m.id === sel && (
              <span className="pointer-events-none absolute bottom-full mb-1 max-w-40 truncate whitespace-nowrap rounded-md bg-slate-900 px-2 py-0.5 text-xs font-medium text-white shadow">{nome(m)}</span>
            )}
            <span className={`block rounded-full border border-white shadow ${m.id === sel ? 'h-5 w-5 border-2' : 'h-2.5 w-2.5'} ${COR_PONTO[m.tipo]} ${m.refId === destaque ? 'animate-pulse ring-4 ring-red-500' : ''} ${m.id === sel ? 'ring-4 ring-sky-400' : ''}`} />
          </button>
        ))}
      </PlantaImagem>
      {visiveis.length > 0 && (
        <details className="rounded-xl bg-slate-50 p-3 text-sm">
          <summary className="cursor-pointer font-medium">Pontos nesta planta ({visiveis.length})</summary>
          <ul className="mt-2 space-y-1">
            {[...visiveis].sort((a, b) => nome(a).localeCompare(nome(b), 'pt')).map((m) => (
              <li key={m.id}>
                <button className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left ${m.id === sel ? 'bg-sky-100 font-medium' : ''}`} onClick={() => { setSel(m.id === sel ? null : m.id); caixa.current?.scrollIntoView({ block: 'center' }); }}>
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${COR_PONTO[m.tipo]}`} />
                  <span className="truncate">{nome(m)}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {selecionado && (
        <div className="space-y-2 rounded-xl bg-slate-50 p-3 text-sm">
          <p className="font-medium">{nome(selecionado)}</p>
          {selecionado.tipo === 'local' && <InventarioLocal localId={selecionado.refId} artigos={artigos} contagens={contagens} />}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <button className="text-teal-700 underline" onClick={() => ir(selecionado.tipo === 'local' ? `/locais/${selecionado.refId}` : selecionado.tipo === 'equipamento' ? `/equipamentos/${selecionado.refId}` : selecionado.tipo === 'anomalia' ? `/anomalias/${selecionado.refId}` : `/stock/${selecionado.refId}`)}>{selecionado.tipo === 'anomalia' ? 'Abrir anomalia' : selecionado.tipo === 'local' ? 'Abrir local' : 'Abrir ficha'}</button>
            <button className="text-teal-700 underline" onClick={() => { setMover(selecionado.id); setColocar(''); }}>Mover</button>
            {selecionado.tipo === 'artigo' && <button className="text-teal-700 underline" onClick={() => { setColocar(`artigo:${selecionado.refId}`); setMover(null); }}>Pôr outro igual</button>}
            {selecionado.tipo !== 'anomalia' && <button className="font-medium text-amber-800 underline" onClick={() => ir(selecionado.tipo === 'equipamento' ? `/anomalias/nova?equip=${selecionado.refId}` : selecionado.tipo === 'local' ? `/anomalias/nova?local=${selecionado.refId}` : `/anomalias/nova?local=${localId}&titulo=${encodeURIComponent(nome(selecionado))}`)}>Registar anomalia</button>}
            <button className="text-red-700 underline" onClick={async () => { await removerMarcador(db, selecionado.id); setSel(null); }}>Tirar da planta</button>
          </div>
        </div>
      )}
      <p className="text-xs text-slate-500">Ponto verde = equipamento · laranja = artigo · azul = local (armário, prateleira) · vermelho = anomalia aberta. Usa + para ampliar quando houver pontos juntos. A posição é a que tu marcas; a app não deteta nada sozinha.</p>
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
    </div>
  );
}

const COR_PONTO: Record<Marcador['tipo'], string> = { equipamento: 'bg-teal-700', artigo: 'bg-amber-600', anomalia: 'bg-red-600', local: 'bg-indigo-600' };

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
          <BotaoInspecaoLocal localId={atual.id} />
          <PlantaLocal key={atual.id} localId={atual.id} destaque={destaque} />
        </>
      )}
    </>
  );
}

/** O que está guardado num local (última contagem de cada artigo, só quantidades > 0). */
function InventarioLocal({ localId, artigos, contagens }: { localId: string; artigos: { id: string; nome: string; unidade: string; deletedAt: string | null }[]; contagens: { artigoId: string; localizacaoId: string; quantidade: number; createdAt: string; deletedAt: string | null }[] }) {
  const ultima = new Map<string, { quantidade: number; createdAt: string }>();
  for (const c of contagens) {
    if (c.deletedAt || c.localizacaoId !== localId) continue;
    const u = ultima.get(c.artigoId);
    if (!u || c.createdAt > u.createdAt) ultima.set(c.artigoId, c);
  }
  const linhas = artigos
    .filter((a) => !a.deletedAt && (ultima.get(a.id)?.quantidade ?? 0) > 0)
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt'))
    .map((a) => ({ a, q: ultima.get(a.id)!.quantidade }));
  if (linhas.length === 0) return <p className="text-xs text-slate-500">Sem artigos contados neste local.</p>;
  return (
    <ul className="max-h-48 overflow-auto rounded-lg bg-white p-2 text-xs">
      {linhas.map(({ a, q }) => (
        <li key={a.id} className="flex justify-between gap-2 py-0.5"><span className="truncate">{a.nome}</span><span className="shrink-0 font-medium">{q.toLocaleString('pt-PT', { maximumFractionDigits: 3 })} {a.unidade}</span></li>
      ))}
    </ul>
  );
}
