import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Artigo, type ContagemStock, type Documento, type Kit, type Marcador, type PontoZona, type Zona } from '../db/schema';
import { colocarMarcador, moverMarcador, removerMarcador } from '../db/plantas';
import { criarArtigo } from '../db/stock';
import { criarEquipamento } from '../db/repo';
import { estaAberta } from '../db/anomalias';
import {
  atualizarZona, caixaZona, CAMADAS, contornoCruzado, criarZona, etiquetaVisivel, lerCamadas, MAX_NOME_ZONA, MAX_PONTOS, MIN_PONTOS,
  nitidez, pontoNaZona, pontosVisiveis, proximoZoom, removerZona, zonaEm, zoomParaZona, ZOOM_MAX, type Camada
} from '../db/zonas';
import { linhasKitNoLocal } from '../db/kits';
import { BotaoInspecaoLocal } from './Inspecoes';
import { TrocarPlanta } from './TrocarPlanta';
import { ir, substituir } from './router';
import { Aviso, Campo, Modal, useUrlDoBlob } from './comuns';

/** Contorno a ser desenhado (nova zona) ou corrigido (editar). */
interface Contorno { modo: 'novo' | 'editar'; id: string | null; nome: string; pontos: PontoZona[]; sel: number | null; localId: string }

const CHAVE_CAMADAS = 'om.plantaCamadas';
const ROTULO_CAMADA: Record<Camada, string> = { zonas: 'Zonas', local: 'Locais', equipamento: 'Equipamentos', artigo: 'Artigos', anomalia: 'Anomalias' };
function camadasGuardadas(): Set<Camada> {
  try { return lerCamadas(localStorage.getItem(CHAVE_CAMADAS)); } catch { return lerCamadas(null); }
}

const pontosSvg = (ps: PontoZona[]) => ps.map((p) => `${p.x},${p.y}`).join(' ');
const curto = (t: string, n = 18) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const NITIDEZ: Record<string, [string, string]> = {
  boa: ['Nitidez boa', 'bg-teal-100 text-teal-800'],
  aceitavel: ['Nitidez aceitável', 'bg-amber-100 text-amber-900'],
  baixa: ['Nitidez baixa: a planta tem pouca resolução para esta ampliação', 'bg-red-100 text-red-800']
};

/** Planta do local: uma imagem anexada, com zonas e marcadores de equipamentos e artigos. */
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
  const zonas = useLiveQuery(
    async (): Promise<Zona[]> => (escolhida ? (await db.zonas.where('documentoId').equals(escolhida).toArray()).filter((z) => !z.deletedAt).sort((a, b) => a.nome.localeCompare(b.nome, 'pt')) : []),
    [escolhida]
  );
  const [reportar, setReportar] = useState(false);
  const [camadas, setCamadasEstado] = useState<Set<Camada>>(camadasGuardadas);
  const setCamadas = (c: Set<Camada>) => { setCamadasEstado(c); try { localStorage.setItem(CHAVE_CAMADAS, JSON.stringify([...c])); } catch { /* sem armazenamento: fica só nesta visita */ } };
  // Locais já ligados a uma zona (em qualquer planta): não se podem ligar a uma segunda.
  const ligadosNoutras = useLiveQuery(async () => (await db.zonas.toArray()).filter((z) => !z.deletedAt && !!z.localizacaoId).map((z) => ({ zonaId: z.id, localId: z.localizacaoId as string })), []);
  const todosLocais = useLiveQuery(() => db.localizacoes.toArray(), []);
  const contagens = useLiveQuery(() => db.contagensStock.toArray(), []);
  const [zoom, setZoom] = useState(1);
  const [mover, setMover] = useState<string | null>(null);
  const [novo, setNovo] = useState<{ tipo: 'artigo' | 'equipamento'; nome: string } | null>(null);
  const [colocar, setColocar] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [dims, setDims] = useState<{ l: number; a: number } | null>(null);
  const [vista, setVista] = useState<string | null>(null);
  const [contorno, setContorno] = useState<Contorno | null>(null);
  const [aRemover, setARemover] = useState<Zona | null>(null);
  const [trocar, setTrocar] = useState(false);
  const [largura, setLargura] = useState(360);
  const caixa = useRef<HTMLDivElement>(null);
  const janela = useRef<HTMLDivElement>(null);
  const centro = useRef<PontoZona | null>(null);
  const arrastar = useRef<number | null>(null);
  const mostrar = useRef(false);
  // Com destaque, abre a imagem onde esse item está marcado.
  const docDestaque = useLiveQuery(async () => (destaque
    ? ((await db.marcadores.filter((m) => !m.deletedAt && m.refId === destaque).first())?.documentoId
      ?? (await db.zonas.filter((z) => !z.deletedAt && z.localizacaoId === destaque).first())?.documentoId ?? '')
    : ''), [destaque]);

  const doc: Documento | undefined = docs?.find((d) => d.id === escolhida) ?? docs?.find((d) => d.id === docDestaque) ?? docs?.[0];
  useEffect(() => { if (doc && doc.id !== escolhida) { setEscolhida(doc.id); setVista(null); setContorno(null); setZoom(1); } }, [doc, escolhida]);
  useEffect(() => { if (destaque && marcs?.some((m) => m.refId === destaque)) janela.current?.scrollIntoView({ block: 'center' }); }, [destaque, marcs]);
  useEffect(() => {
    const j = janela.current;
    if (!j) return;
    const ro = new ResizeObserver(() => setLargura(j.clientWidth || 360));
    ro.observe(j);
    return () => ro.disconnect();
  }, [doc?.id]);
  // Depois de mudar o zoom, centra a vista no ponto pedido (centro da zona ou o centro anterior).
  useLayoutEffect(() => {
    const c = centro.current, j = janela.current, k = caixa.current;
    if (!c || !j || !k) return;
    centro.current = null;
    j.scrollLeft = c.x * k.offsetWidth - j.clientWidth / 2;
    j.scrollTop = c.y * k.offsetHeight - j.clientHeight / 2;
    // Ao abrir uma zona, a planta ampliada fica a meio do ecrã.
    if (mostrar.current) { mostrar.current = false; j.scrollIntoView({ block: 'center' }); }
  }, [zoom, vista]);

  if (!docs || !equips || !artigos || !anomalias || !todosLocais || !contagens || !zonas || !ligadosNoutras) return null;
  if (!doc) {
    return (
      <div className="cartao space-y-1">
        <h3 className="font-semibold">Planta</h3>
        <p className="text-sm text-slate-500">Anexa uma imagem da planta em «Documentos» (abaixo) e ela aparece aqui para marcares zonas, equipamentos e artigos.</p>
      </div>
    );
  }
  if (trocar) return <TrocarPlanta antiga={doc} imagens={docs} aoFechar={(texto) => { setTrocar(false); setVista(null); setContorno(null); setZoom(1); if (texto) { setEscolhida(''); setMsg({ tipo: 'ok', texto }); } }} />;

  const nome = (m: Marcador) => (m.tipo === 'local' ? todosLocais.find((l) => l.id === m.refId)?.nome : m.tipo === 'equipamento' ? equips.find((e) => e.id === m.refId)?.nome : m.tipo === 'anomalia' ? (() => { const a = anomalias.find((x) => x.id === m.refId); return a ? `${a.codigo} · ${a.titulo}` : undefined; })() : artigos.find((a) => a.id === m.refId)?.nome) ?? '(removido)';
  // Pontos de anomalia só enquanto a anomalia está aberta (resolvida/anulada sai da planta; o histórico mantém-se).
  const abertas = (marcs ?? []).filter((m) => m.tipo !== 'anomalia' || m.refId === destaque || anomalias.some((a) => a.id === m.refId && estaAberta(a)));
  // Sem duplicados (local que já é zona) e só as camadas ligadas; o selecionado e o destacado ficam sempre.
  const visiveis = pontosVisiveis(abertas, zonas, camadas, { sel, destaque });
  const verZonas = camadas.has('zonas');
  const nomeLocal = (id: string | null | undefined) => (id ? todosLocais.find((l) => l.id === id)?.nome : undefined);
  const selecionado = visiveis.find((m) => m.id === sel);
  const zonaAberta = zonas.find((z) => z.id === vista) ?? null;
  const naZona = (m: Marcador) => !!zonaAberta && pontoNaZona(m, zonaAberta.pontos);
  const listaPontos = zonaAberta ? visiveis.filter(naZona) : visiveis;
  const aMarcar = !!colocar || !!mover || reportar;
  const ocupado = aMarcar || !!contorno;
  const cruzado = !!contorno && contorno.pontos.length >= MIN_PONTOS && contornoCruzado(contorno.pontos);

  function fracao(clientX: number, clientY: number): PontoZona | null {
    if (!caixa.current) return null;
    const r = caixa.current.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (clientY - r.top) / r.height)) };
  }

  function mudarZoom(z: number, c?: PontoZona) {
    const j = janela.current, k = caixa.current;
    if (!c && j && k && k.offsetWidth > 0) c = { x: (j.scrollLeft + j.clientWidth / 2) / k.offsetWidth, y: (j.scrollTop + j.clientHeight / 2) / k.offsetHeight };
    centro.current = c ?? null;
    setZoom(Math.min(ZOOM_MAX, Math.max(1, z)));
  }

  function abrirZona(z: Zona) {
    const l = janela.current?.clientWidth || largura;
    const zz = dims ? zoomParaZona(z.pontos, l, window.innerHeight * 0.7, dims.l, dims.a) : 2;
    const c = caixaZona(z.pontos);
    setSel(null);
    setVista(z.id);
    mostrar.current = true;
    mudarZoom(zz, { x: c.cx, y: c.cy });
  }

  function plantaInteira() {
    setVista(null);
    setContorno(null);
    mudarZoom(1, { x: 0.5, y: 0.5 });
  }

  async function toque(e: React.MouseEvent<HTMLDivElement>) {
    const p = fracao(e.clientX, e.clientY);
    if (!p || !doc) return;
    if (contorno) {
      if (contorno.modo === 'novo' && contorno.pontos.length < MAX_PONTOS) setContorno({ ...contorno, pontos: [...contorno.pontos, p], sel: null });
      else setContorno({ ...contorno, sel: null });
      return;
    }
    if (!aMarcar) {
      if (!vista && camadas.has('zonas')) { const z = zonaEm(zonas!, p); if (z) { abrirZona(z); return; } }
      setSel(null);
      return;
    }
    const { x, y } = p;
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
      if (!camadas.has(tipo)) setCamadas(new Set([...camadas, tipo]));
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

  async function gravarContorno() {
    if (!contorno || !doc) return;
    try {
      if (contorno.modo === 'novo') {
        const z = await criarZona(db, doc.id, contorno.nome, contorno.pontos, contorno.localId || null);
        setContorno(null);
        setMsg({ tipo: 'ok', texto: `Zona «${z.nome}» criada. Toca nela para a ampliar.` });
      } else if (contorno.id) {
        await atualizarZona(db, contorno.id, { nome: contorno.nome, pontos: contorno.pontos, localizacaoId: contorno.localId || null });
        setContorno(null);
        setMsg({ tipo: 'ok', texto: 'Zona guardada.' });
      }
    } catch (err) {
      setMsg({ tipo: 'erro', texto: (err as Error).message });
    }
  }

  function arrastarInicio(i: number, e: React.PointerEvent<HTMLButtonElement>) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    arrastar.current = i;
    if (contorno) setContorno({ ...contorno, sel: i });
  }
  function arrastarMover(i: number, e: React.PointerEvent<HTMLButtonElement>) {
    if (arrastar.current !== i || !contorno) return;
    const p = fracao(e.clientX, e.clientY);
    if (!p) return;
    setContorno((c) => (c ? { ...c, pontos: c.pontos.map((q, k) => (k === i ? p : q)) } : c));
  }
  const arrastarFim = () => { arrastar.current = null; };

  const listaEquips = [...equips].sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
  const listaLocais = todosLocais.filter((l) => !l.deletedAt && l.id !== localId).sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
  const listaArtigos = [...artigos].sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
  const semItens = listaEquips.length + listaLocais.length + listaArtigos.length === 0;
  const nit = dims ? nitidez(dims.l, largura, zoom, window.devicePixelRatio || 1) : null;
  // Na vista da zona, o resto da planta fica escurecido (o contorno continua à vista).
  const mascara = zonaAberta && !contorno ? `M0,0H1V1H0Z M${zonaAberta.pontos.map((p) => `${p.x},${p.y}`).join(' L')}Z` : null;

  return (
    <div className="cartao space-y-3">
      <h3 className="font-semibold">Planta</h3>
      {docs.length > 1 && !zonaAberta && !contorno && (
        <Campo rotulo="Imagem">
          <select className="campo" value={doc.id} onChange={(e) => { setEscolhida(e.target.value); setSel(null); setVista(null); setZoom(1); }}>
            {docs.map((d) => <option key={d.id} value={d.id}>{d.nome}</option>)}
          </select>
        </Campo>
      )}
      {!contorno && (
        <>
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
              {!zonaAberta && <button className="btn-secundario col-span-2" onClick={() => { setContorno({ modo: 'novo', id: null, nome: '', pontos: [], sel: null, localId: '' }); setColocar(''); setMover(null); setReportar(false); setSel(null); setMsg(null); }}>+ Nova zona</button>}
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
        </>
      )}

      {contorno && (
        <div className="space-y-2 rounded-xl bg-sky-50 p-3 text-sm">
          <p className="font-medium">{contorno.modo === 'novo' ? 'Nova zona' : 'Corrigir zona'}</p>
          <Campo rotulo="Nome da zona">
            <input className="campo" value={contorno.nome} maxLength={MAX_NOME_ZONA} onChange={(e) => setContorno({ ...contorno, nome: e.target.value })} autoComplete="off" placeholder="Ex.: Open space norte" />
          </Campo>
          <Campo rotulo="Esta zona é o local (opcional)" dica="Para armários, centros de cópias… Fica um só nome na planta (sem ponto azul à parte) e tocar na zona mostra o inventário e os kits desse local.">
            <select className="campo" value={contorno.localId} onChange={(e) => { const v = e.target.value; setContorno({ ...contorno, localId: v, nome: contorno.nome.trim() ? contorno.nome : (nomeLocal(v) ?? '').slice(0, MAX_NOME_ZONA) }); }}>
              <option value="">Nenhum (só uma área)</option>
              {listaLocais.filter((l) => l.id === contorno.localId || !ligadosNoutras.some((x) => x.localId === l.id && x.zonaId !== contorno.id)).map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
            </select>
          </Campo>
          <p className="text-xs text-slate-600">
            {contorno.modo === 'novo'
              ? `Toca na planta à volta da zona, ponto a ponto (${contorno.pontos.length} ${contorno.pontos.length === 1 ? 'ponto' : 'pontos'}). A app liga-os e fecha a forma. Arrasta um ponto para o corrigir; usa + para ampliar.`
              : 'Arrasta os pontos para corrigir o contorno. Toca num «+» para acrescentar um ponto; toca num ponto e depois em «Apagar ponto» para o tirar.'}
          </p>
          {cruzado && <p className="rounded-lg bg-red-50 p-2 text-xs text-red-800">As linhas cruzam-se: arrasta os pontos até deixarem de se cruzar.</p>}
          <div className="flex flex-wrap gap-2">
            {contorno.modo === 'novo' && <button className="btn-secundario" disabled={contorno.pontos.length === 0} onClick={() => setContorno({ ...contorno, pontos: contorno.pontos.slice(0, -1), sel: null })}>↶ Desfazer ponto</button>}
            {contorno.sel !== null && contorno.pontos.length > MIN_PONTOS && (
              <button className="btn-secundario" onClick={() => setContorno({ ...contorno, pontos: contorno.pontos.filter((_, k) => k !== contorno.sel), sel: null })}>Apagar ponto</button>
            )}
          </div>
          <div className="flex gap-2">
            <button className="btn-primario flex-1" disabled={contorno.pontos.length < MIN_PONTOS || !contorno.nome.trim() || cruzado} onClick={() => void gravarContorno()}>{contorno.modo === 'novo' ? 'Concluir zona' : 'Guardar'}</button>
            <button className="btn-secundario" onClick={() => { setContorno(null); setMsg(null); }}>Cancelar</button>
          </div>
        </div>
      )}

      {zonaAberta && (
        <div className="flex items-center gap-2">
          <button className="btn-secundario shrink-0 px-3 py-1" onClick={plantaInteira}>← Planta inteira</button>
          <p className="min-w-0 truncate font-medium">{zonaAberta.nome}</p>
        </div>
      )}

      {!contorno && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Mostrar na planta">
          {CAMADAS.map((c) => {
            const on = camadas.has(c);
            return (
              <button key={c} aria-pressed={on} onClick={() => { const n = new Set(camadas); if (on) n.delete(c); else n.add(c); setCamadas(n); }}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${on ? 'border-slate-300 bg-white font-medium text-slate-900' : 'border-dashed border-slate-300 bg-slate-100 text-slate-400'}`}>
                <span className={`h-2.5 w-2.5 ${c === 'zonas' ? 'rounded-sm border border-sky-600 bg-sky-100' : `rounded-full ${COR_PONTO[c]}`} ${on ? '' : 'opacity-40'}`} />
                {ROTULO_CAMADA[c]}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-slate-500">Ampliar: {Math.round(zoom * 100)}%</span>
        <div className="flex gap-2">
          <button className="btn-secundario px-4 py-1" aria-label="Reduzir planta" disabled={zoom <= 1} onClick={() => mudarZoom(proximoZoom(zoom, -1))}>−</button>
          <button className="btn-secundario px-4 py-1" aria-label="Ampliar planta" disabled={zoom >= ZOOM_MAX} onClick={() => mudarZoom(proximoZoom(zoom, 1))}>+</button>
        </div>
      </div>
      {zonaAberta && nit && <p className={`rounded-lg px-2 py-1 text-xs ${NITIDEZ[nit.nivel][1]}`}>{NITIDEZ[nit.nivel][0]}</p>}

      <PlantaImagem doc={doc} caixa={caixa} janela={janela} aoToque={toque} aPlacar={ocupado} zoom={zoom} aoCarregar={setDims}>
        <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
          {mascara && <path d={mascara} fillRule="evenodd" fill="rgb(15 23 42 / 0.45)" />}
          {!contorno && zonas.filter((z) => (zonaAberta ? z.id === zonaAberta.id : verZonas)).map((z) => {
            const local = !!z.localizacaoId;
            const dest = !!destaque && z.localizacaoId === destaque;
            return <polygon key={z.id} points={pontosSvg(z.pontos)} fill={zonaAberta ? 'none' : local ? 'rgb(79 70 229 / 0.12)' : 'rgb(14 165 233 / 0.10)'} stroke={dest ? '#dc2626' : local ? '#4f46e5' : '#0284c7'} strokeWidth={zonaAberta || dest ? 3 : 1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />;
          })}
          {contorno && contorno.pontos.length > 1 && (
            contorno.modo === 'novo'
              ? <polyline points={pontosSvg(contorno.pontos)} fill="none" stroke={cruzado ? '#dc2626' : '#0284c7'} strokeWidth={3} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
              : <polygon points={pontosSvg(contorno.pontos)} fill="rgb(14 165 233 / 0.12)" stroke={cruzado ? '#dc2626' : '#0284c7'} strokeWidth={3} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          )}
          {contorno && contorno.modo === 'novo' && contorno.pontos.length >= MIN_PONTOS && (
            <line x1={contorno.pontos[contorno.pontos.length - 1].x} y1={contorno.pontos[contorno.pontos.length - 1].y} x2={contorno.pontos[0].x} y2={contorno.pontos[0].y} stroke="#0284c7" strokeWidth={2} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
          )}
        </svg>
        {!zonaAberta && !contorno && verZonas && zonas.map((z) => {
          const c = caixaZona(z.pontos);
          return <span key={z.id} style={{ left: `${c.cx * 100}%`, top: `${c.cy * 100}%` }} className={`pointer-events-none absolute z-0 max-w-28 -translate-x-1/2 -translate-y-1/2 truncate rounded bg-white/80 px-1 text-[10px] font-medium ${z.localizacaoId ? 'text-indigo-800' : 'text-sky-800'}`}>{z.nome}</span>;
        })}
        {visiveis.map((m) => {
          const dentro = naZona(m);
          const grande = !!zonaAberta && dentro;
          // Nomes só quando há espaço: selecionado, dentro da zona aberta, ou com zoom ≥ 200%.
          const etiqueta = etiquetaVisivel({ selecionado: m.id === sel, zonaAberta: !!zonaAberta, dentro, zoom });
          return (
            <button
              key={m.id}
              aria-label={`Marcador ${nome(m)}`}
              onClick={(e) => { e.stopPropagation(); setSel(m.id === sel ? null : m.id); }}
              style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }}
              className={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center ${grande ? 'h-11 w-11' : 'h-6 w-6'} ${ocupado || (zonaAberta && !dentro) ? 'pointer-events-none' : ''} ${zonaAberta && !dentro ? 'opacity-30' : ''} ${m.id === sel ? 'z-20' : 'z-10'}`}
            >
              {etiqueta && (
                <span className={`pointer-events-none absolute bottom-full whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium shadow ${m.id === sel ? 'mb-1 max-w-40 truncate bg-[#0f172a] text-white' : '-mb-2 bg-white/90 text-slate-900'}`}>{m.id === sel ? nome(m) : curto(nome(m))}</span>
              )}
              <span className={`block rounded-full border border-white shadow ${m.id === sel ? 'h-5 w-5 border-2' : grande ? 'h-3.5 w-3.5 border-2' : 'h-2.5 w-2.5'} ${COR_PONTO[m.tipo]} ${m.refId === destaque ? 'animate-pulse ring-4 ring-red-500' : ''} ${m.id === sel ? 'ring-4 ring-sky-400' : ''}`} />
            </button>
          );
        })}
        {contorno && contorno.modo === 'editar' && contorno.pontos.length < MAX_PONTOS && contorno.pontos.map((p, i) => {
          const q = contorno.pontos[(i + 1) % contorno.pontos.length];
          return (
            <button key={`m${i}`} aria-label="Acrescentar ponto" onClick={(e) => { e.stopPropagation(); const ps = [...contorno.pontos]; ps.splice(i + 1, 0, { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }); setContorno({ ...contorno, pontos: ps, sel: i + 1 }); }}
              style={{ left: `${((p.x + q.x) / 2) * 100}%`, top: `${((p.y + q.y) / 2) * 100}%` }}
              className="absolute z-20 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center">
              <span className="flex h-4 w-4 items-center justify-center rounded-full border border-sky-600 bg-white text-[11px] font-bold leading-none text-sky-700">+</span>
            </button>
          );
        })}
        {contorno && contorno.pontos.map((p, i) => (
          <button
            key={`v${i}`}
            aria-label={`Ponto ${i + 1} da zona`}
            onPointerDown={(e) => arrastarInicio(i, e)}
            onPointerMove={(e) => arrastarMover(i, e)}
            onPointerUp={arrastarFim}
            onPointerCancel={arrastarFim}
            onClick={(e) => e.stopPropagation()}
            style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, touchAction: 'none' }}
            className="absolute z-30 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
          >
            <span className={`block rounded-full border-2 border-white shadow ${contorno.sel === i ? 'h-5 w-5 bg-amber-500 ring-4 ring-amber-300' : i === 0 ? 'h-4 w-4 bg-sky-800' : 'h-4 w-4 bg-sky-600'}`} />
          </button>
        ))}
      </PlantaImagem>

      {dims && !zonaAberta && <p className="text-xs text-slate-500">Imagem da planta: {dims.l}×{dims.a} px</p>}

      {zonaAberta && !contorno && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <button className="font-medium text-teal-700 underline" onClick={plantaInteira}>← Planta inteira</button>
          <button className="text-teal-700 underline" onClick={() => { setContorno({ modo: 'editar', id: zonaAberta.id, nome: zonaAberta.nome, pontos: zonaAberta.pontos.map((p) => ({ ...p })), sel: null, localId: zonaAberta.localizacaoId ?? '' }); setColocar(''); setMover(null); setReportar(false); setSel(null); setMsg(null); }}>Editar zona (nome e contorno)</button>
          <button className="text-red-700 underline" onClick={() => setARemover(zonaAberta)}>Remover zona</button>
        </div>
      )}
      {zonaAberta && !contorno && zonaAberta.localizacaoId && !sel && (
        <div className="space-y-2 rounded-xl bg-indigo-50 p-3 text-sm">
          <p className="font-medium">Local: {nomeLocal(zonaAberta.localizacaoId) ?? '(removido)'}</p>
          <ResumoKitsLocal localId={zonaAberta.localizacaoId} artigos={artigos} contagens={contagens} />
          <InventarioLocal localId={zonaAberta.localizacaoId} artigos={artigos} contagens={contagens} />
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <button className="text-teal-700 underline" onClick={() => ir(`/locais/${zonaAberta.localizacaoId}`)}>Abrir local (contar)</button>
            <button className="font-medium text-amber-800 underline" onClick={() => ir(`/anomalias/nova?local=${zonaAberta.localizacaoId}`)}>Registar anomalia</button>
          </div>
        </div>
      )}

      {!zonaAberta && !contorno && zonas.length > 0 && (
        <details className="rounded-xl bg-slate-50 p-3 text-sm" open>
          <summary className="cursor-pointer font-medium">Zonas nesta planta ({zonas.length})</summary>
          <ul className="mt-2 space-y-1">
            {zonas.map((z) => (
              <li key={z.id}>
                <button className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left" onClick={() => abrirZona(z)}>
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm border border-sky-600 bg-sky-100" />
                  <span className="truncate">{z.nome}</span>
                  {z.localizacaoId && <span className="shrink-0 rounded bg-indigo-100 px-1 text-[10px] text-indigo-800">local</span>}
                  <span className="ml-auto shrink-0 text-xs text-slate-500">{visiveis.filter((m) => pontoNaZona(m, z.pontos)).length} pontos</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {!contorno && listaPontos.length > 0 && (
        <details className="rounded-xl bg-slate-50 p-3 text-sm">
          <summary className="cursor-pointer font-medium">{zonaAberta ? 'Pontos nesta zona' : 'Pontos nesta planta'} ({listaPontos.length})</summary>
          <ul className="mt-2 space-y-1">
            {[...listaPontos].sort((a, b) => nome(a).localeCompare(nome(b), 'pt')).map((m) => (
              <li key={m.id}>
                <button className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left ${m.id === sel ? 'bg-sky-100 font-medium' : ''}`} onClick={() => { setSel(m.id === sel ? null : m.id); janela.current?.scrollIntoView({ block: 'center' }); }}>
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${COR_PONTO[m.tipo]}`} />
                  <span className="truncate">{nome(m)}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {selecionado && !contorno && (
        <div className="space-y-2 rounded-xl bg-slate-50 p-3 text-sm">
          <p className="font-medium">{nome(selecionado)}</p>
          {selecionado.tipo === 'local' && <ResumoKitsLocal localId={selecionado.refId} artigos={artigos} contagens={contagens} />}
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
      {!zonaAberta && !contorno && docs.length > 1 && (visiveis.length > 0 || zonas.length > 0) && (
        <button className="btn-secundario w-full" onClick={() => { setTrocar(true); setMsg(null); }}>🔁 Trocar para outra imagem (manter pontos e zonas)</button>
      )}
      <p className="text-xs text-slate-500">Ponto verde = equipamento · laranja = artigo · azul = local (armário, prateleira) · vermelho = anomalia aberta · contorno azul-claro = zona, roxo = zona que é um local (toca para ampliar). Os nomes dos pontos aparecem ao abrir uma zona ou a partir de 200%. Os botões por cima da planta escondem o que não precisas de ver. A posição é a que tu marcas; a app não deteta nada sozinha.</p>
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
      <Modal aberto={aRemover !== null} onFechar={() => setARemover(null)}>
        <p className="font-semibold">Remover a zona «{aRemover?.nome}»?</p>
        <p className="text-sm text-slate-600">Só sai o contorno; os pontos que estão lá dentro ficam onde estão.{aRemover?.localizacaoId ? ' O local continua a existir (com as contagens e os kits); se tinha ponto azul, volta a aparecer.' : ''} Continua nas cópias de segurança já feitas.</p>
        <div className="grid grid-cols-2 gap-3">
          <button className="btn-secundario" onClick={() => setARemover(null)}>Manter</button>
          <button className="btn-perigo" onClick={async () => { if (aRemover) await removerZona(db, aRemover.id); setARemover(null); plantaInteira(); }}>Remover</button>
        </div>
      </Modal>
    </div>
  );
}

export const COR_PONTO: Record<Marcador['tipo'], string> = { equipamento: 'bg-teal-700', artigo: 'bg-amber-600', anomalia: 'bg-red-600', local: 'bg-indigo-600' };

/** A imagem da planta, ampliável. A imagem nunca é cortada nem regravada: a ampliação é só visual. */
export function PlantaImagem({ doc, caixa, janela, aoToque, aPlacar, zoom, aoCarregar, children }: {
  doc: Documento; caixa: React.RefObject<HTMLDivElement | null>; janela?: React.RefObject<HTMLDivElement | null>;
  aoToque: (e: React.MouseEvent<HTMLDivElement>) => void; aPlacar: boolean; zoom: number;
  aoCarregar?: (d: { l: number; a: number }) => void; children: React.ReactNode;
}) {
  const url = useUrlDoBlob(doc.id, doc.blob);
  return (
    <div ref={janela} className={`${zoom > 1 ? 'max-h-[70dvh]' : ''} overflow-auto border border-slate-200 ${aPlacar ? 'ring-2 ring-teal-500' : ''}`}>
      <div ref={caixa} onClick={aoToque} style={{ width: `${zoom * 100}%` }} className={`relative ${aPlacar ? 'cursor-crosshair' : ''}`}>
        {url && <img src={url} alt="Planta" draggable={false} decoding="async" onLoad={(e) => aoCarregar?.({ l: e.currentTarget.naturalWidth, a: e.currentTarget.naturalHeight })} className="block w-full select-none" />}
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

/** Kits aplicados ao local: quantos artigos abaixo do alvo e por contar (para saber onde repor sem abrir o local). */
function ResumoKitsLocal({ localId, artigos, contagens }: { localId: string; artigos: Artigo[]; contagens: ContagemStock[] }) {
  const kits = useLiveQuery(async () => {
    const lig = (await db.kitLocais.where('localizacaoId').equals(localId).toArray()).filter((x) => !x.deletedAt);
    return (await db.kits.bulkGet(lig.map((x) => x.kitId))).filter((k): k is Kit => !!k && !k.deletedAt);
  }, [localId]);
  if (!kits || kits.length === 0) return null;
  return (
    <ul className="space-y-0.5 text-xs">
      {kits.sort((a, b) => a.nome.localeCompare(b.nome, 'pt')).map((k) => {
        const linhas = linhasKitNoLocal(k, artigos, contagens, localId);
        const abaixo = linhas.filter((l) => l.abaixoAlvo).length;
        const porContar = linhas.filter((l) => l.quantidade === null).length;
        return (
          <li key={k.id}>
            <span className="font-medium">Kit {k.nome}</span>
            {' · '}
            {abaixo === 0 && porContar === 0
              ? <span className="text-teal-700">tudo no alvo</span>
              : <span className="text-amber-800">{[abaixo ? `${abaixo} abaixo do alvo` : '', porContar ? `${porContar} por contar` : ''].filter(Boolean).join(' · ')}</span>}
          </li>
        );
      })}
    </ul>
  );
}
