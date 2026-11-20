import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type CategoriaDocumento, type Documento, type EntidadeDocumento } from '../db/schema';
import {
  anexarDocumento, CATEGORIAS_DOCUMENTO, definirCategoria, desligarDocumento, documentosDe, equipamentosIguais, formatarTamanho, LIMITE_BYTES,
  ligarDocumento, removerDocumento, ROTULO_CATEGORIA, type Alvo, type DocumentoDoRegisto
} from '../db/documentos';
import { normalizar } from '../db/consultas';
import { partilharOuDescarregar } from '../backup/partilha';
import { Aviso, Modal, dataPt } from './comuns';
import { dimensoesImagem } from '../fotos/dimensoes';
import { avaliarTamanhoPlanta, MP_AVISO, MP_RECUSA } from '../db/zonas';

const ROTULO_ENTIDADE: Record<EntidadeDocumento, string> = { equipamento: 'Equipamentos', localizacao: 'Locais', fornecedor: 'Fornecedores', encomenda: 'Encomendas' };

/** Nomes legíveis de todos os registos que podem ter documentos. */
function useRegistos() {
  return useLiveQuery(async () => {
    const [eq, lo, fo, en] = await Promise.all([db.equipamentos.toArray(), db.localizacoes.toArray(), db.fornecedores.toArray(), db.encomendas.toArray()]);
    const nomes = new Map<string, string>();
    for (const e of eq) nomes.set(`equipamento|${e.id}`, `${e.codigo} · ${e.nome}`);
    for (const l of lo) nomes.set(`localizacao|${l.id}`, l.nome);
    for (const f of fo) nomes.set(`fornecedor|${f.id}`, f.nome);
    for (const e of en) nomes.set(`encomenda|${e.id}`, `${e.codigo}${fo.find((f) => f.id === e.fornecedorId)?.nome ? ` · ${fo.find((f) => f.id === e.fornecedorId)!.nome}` : ''}`);
    return { eq, lo, fo, en, nome: (a: Alvo) => nomes.get(`${a.entidade}|${a.entidadeId}`) ?? '?' };
  }, []);
}

export function Documentos({ entidade, entidadeId, editavel = true }: { entidade: EntidadeDocumento; entidadeId: string; editavel?: boolean }) {
  const docs = useLiveQuery(() => documentosDe(db, entidade, entidadeId), [entidade, entidadeId]);
  const ligacoes = useLiveQuery(() => db.documentoLigacoes.filter((l) => !l.deletedAt).toArray(), []);
  const registos = useRegistos();
  const [aRemover, setARemover] = useState<DocumentoDoRegisto | null>(null);
  const [aLigar, setALigar] = useState<Documento | null>(null);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [categoriaNova, setCategoriaNova] = useState<CategoriaDocumento>('outro');
  const [filtro, setFiltro] = useState<CategoriaDocumento | ''>('');
  const input = useRef<HTMLInputElement>(null);

  async function adicionar(lista: FileList | null) {
    if (!lista?.length) return;
    setOcupado(true);
    setMsg(null);
    const erros: string[] = [];
    const avisos: string[] = [];
    let n = 0;
    for (const f of Array.from(lista)) {
      // Imagens de um local são plantas: demasiados megapíxeis podem fechar a app no telemóvel.
      if (entidade === 'localizacao' && f.type.startsWith('image/')) {
        const d = await dimensoesImagem(f).catch(() => null);
        if (d) {
          const t = avaliarTamanhoPlanta(d.l, d.a);
          if (t.nivel === 'recusa') { erros.push(`«${f.name}» tem ${d.l}×${d.a} px (${t.mp.toFixed(0)} MP); o máximo para uma planta é ${MP_RECUSA} MP. Exporta com menos resolução.`); continue; }
          if (t.nivel === 'aviso') avisos.push(`«${f.name}» tem ${t.mp.toFixed(0)} MP (acima de ${MP_AVISO} MP): pode ficar lenta neste telemóvel.`);
        }
      }
      try { await anexarDocumento(db, entidade, entidadeId, f, '', categoriaNova); n++; } catch (e) { erros.push((e as Error).message); }
    }
    setOcupado(false);
    if (input.current) input.current.value = '';
    if (erros.length) setMsg({ tipo: 'erro', texto: [...erros, ...avisos].join(' ') });
    else setMsg({ tipo: 'ok', texto: [`${n} documento(s) anexado(s).`, ...avisos].join(' ') });
  }

  function abrir(d: Documento) {
    const url = URL.createObjectURL(d.blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  if (!docs || !ligacoes || !registos) return null;
  const visiveis = filtro ? docs.filter((x) => (x.doc.categoria ?? 'outro') === filtro) : docs;
  const cats = [...new Set(docs.map((x) => x.doc.categoria ?? 'outro'))];
  const outrosDe = (d: Documento) => ligacoes.filter((l) => l.documentoId === d.id);

  return (
    <section className="cartao space-y-3">
      <h3 className="font-semibold">Documentos ({docs.length})</h3>
      {docs.length > 3 && cats.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por categoria">
          {(['', ...CATEGORIAS_DOCUMENTO.filter((c) => cats.includes(c))] as (CategoriaDocumento | '')[]).map((c) => (
            <button key={c || 'todos'} className={`rounded-full px-3 py-1 text-xs ${filtro === c ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-700'}`} onClick={() => setFiltro(c)}>{c ? ROTULO_CATEGORIA[c] : 'Todos'}</button>
          ))}
        </div>
      )}
      {visiveis.length > 0 && (
        <ul className="divide-y divide-slate-100 text-sm">
          {visiveis.map((x) => {
            const d = x.doc;
            const outros = outrosDe(d);
            const dono = { entidade: d.entidade, entidadeId: d.entidadeId };
            return (
              <li key={`${d.id}-${x.ligacao?.id ?? 'dono'}`} className="space-y-1 py-2">
                <p className="break-all font-medium">{d.mime === 'application/pdf' ? '📄' : '🖼️'} {d.nome}</p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  {editavel ? (
                    <select aria-label={`Categoria de ${d.nome}`} className="rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-xs text-slate-700" value={d.categoria ?? 'outro'} onChange={(e) => void definirCategoria(db, d.id, e.target.value as CategoriaDocumento)}>
                      {CATEGORIAS_DOCUMENTO.map((c) => <option key={c} value={c}>{ROTULO_CATEGORIA[c]}</option>)}
                    </select>
                  ) : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">{ROTULO_CATEGORIA[d.categoria ?? 'outro']}</span>}
                  <span>{formatarTamanho(d.tamanho)} · {dataPt(d.createdAt)}{d.descricao ? ` · ${d.descricao}` : ''}</span>
                </div>
                {x.ligacao ? (
                  <p className="text-xs text-sky-800">🔗 Anexado em {registos.nome(dono)}{outros.length > 1 ? ` e ligado a mais ${outros.length - 1}` : ''}</p>
                ) : outros.length > 0 ? (
                  <details className="text-xs text-sky-800">
                    <summary className="cursor-pointer">🔗 Também ligado a {outros.length} registo(s)</summary>
                    <ul className="mt-1 max-h-32 overflow-y-auto pl-4">{outros.map((l) => <li key={l.id}>{registos.nome(l)}</li>)}</ul>
                  </details>
                ) : null}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <button className="text-teal-700 underline" onClick={() => abrir(d)}>Abrir</button>
                  <button className="text-teal-700 underline" onClick={() => void partilharOuDescarregar(d.blob, d.nome)}>Partilhar</button>
                  {editavel && <button className="text-teal-700 underline" onClick={() => { setALigar(d); setMsg(null); }}>Ligar a outros</button>}
                  {editavel && <button className="text-red-700 underline" onClick={() => setARemover(x)}>{x.ligacao ? 'Tirar daqui' : 'Remover'}</button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {editavel && (
        <>
          <input ref={input} type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void adicionar(e.target.files)} />
          <div className="flex gap-2">
            <select aria-label="Categoria dos documentos a anexar" className="campo w-36 shrink-0" value={categoriaNova} onChange={(e) => setCategoriaNova(e.target.value as CategoriaDocumento)}>
              {CATEGORIAS_DOCUMENTO.map((c) => <option key={c} value={c}>{ROTULO_CATEGORIA[c]}</option>)}
            </select>
            <button className="btn-secundario flex-1" disabled={ocupado} onClick={() => input.current?.click()}>{ocupado ? 'A guardar…' : '📎 Anexar PDF ou imagem'}</button>
          </div>
          <p className="text-xs text-slate-500">Até {LIMITE_BYTES / 1048576} MB cada. Ficam só neste telemóvel e entram na cópia completa. «Ligar a outros» põe o mesmo ficheiro noutros registos sem ocupar mais espaço.</p>
        </>
      )}
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
      <Modal aberto={aRemover !== null} onFechar={() => setARemover(null)}>
        {aRemover?.ligacao ? (
          <>
            <p className="font-semibold">Tirar «{aRemover.doc.nome}» deste registo?</p>
            <p className="text-sm text-slate-600">Só deixa de aparecer aqui. O documento continua em {registos.nome({ entidade: aRemover.doc.entidade, entidadeId: aRemover.doc.entidadeId })} e nos outros registos.</p>
          </>
        ) : (
          <>
            <p className="font-semibold">Remover «{aRemover?.doc.nome}»?</p>
            <p className="text-sm text-slate-600">
              Deixa de aparecer aqui{aRemover && outrosDe(aRemover.doc).length > 0 ? ` e nos ${outrosDe(aRemover.doc).length} registo(s) a que está ligado` : ''}. Continua nas cópias de segurança já feitas.
            </p>
          </>
        )}
        <div className="grid grid-cols-2 gap-3">
          <button className="btn-secundario" onClick={() => setARemover(null)}>Manter</button>
          <button className="btn-perigo" onClick={async () => {
            if (aRemover) { if (aRemover.ligacao) await desligarDocumento(db, aRemover.ligacao.id); else await removerDocumento(db, aRemover.doc.id); }
            setARemover(null);
          }}>{aRemover?.ligacao ? 'Tirar daqui' : 'Remover'}</button>
        </div>
      </Modal>
      {aLigar && (
        <LigarDocumento doc={aLigar} registos={registos} jaLigados={new Set([`${aLigar.entidade}|${aLigar.entidadeId}`, ...outrosDe(aLigar).map((l) => `${l.entidade}|${l.entidadeId}`)])} origem={{ entidade, entidadeId }}
          aoFechar={(n) => { setALigar(null); if (n !== undefined) setMsg({ tipo: 'ok', texto: n ? `Ligado a mais ${n} registo(s).` : 'Já estava ligado a esses registos.' }); }} />
      )}
    </section>
  );
}

function LigarDocumento({ doc, registos, jaLigados, origem, aoFechar }: {
  doc: Documento; registos: NonNullable<ReturnType<typeof useRegistos>>; jaLigados: Set<string>; origem: Alvo; aoFechar: (n?: number) => void;
}) {
  const [tipo, setTipo] = useState<EntidadeDocumento>(origem.entidade);
  const [texto, setTexto] = useState('');
  const [escolhidos, setEscolhidos] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);
  const [aGravar, setAGravar] = useState(false);

  const opcoes: { chave: string; alvo: Alvo; nome: string; extra: string }[] = (
    tipo === 'equipamento' ? registos.eq.filter((e) => !e.deletedAt && e.estado !== 'abatido').map((e) => ({ alvo: { entidade: tipo, entidadeId: e.id }, extra: [e.marca, e.modelo].filter(Boolean).join(' ') }))
      : tipo === 'localizacao' ? registos.lo.filter((l) => !l.deletedAt).map((l) => ({ alvo: { entidade: tipo, entidadeId: l.id }, extra: l.piso ? `Piso ${l.piso}` : '' }))
        : tipo === 'fornecedor' ? registos.fo.filter((f) => !f.deletedAt).map((f) => ({ alvo: { entidade: tipo, entidadeId: f.id }, extra: '' }))
          : registos.en.filter((e) => !e.deletedAt).map((e) => ({ alvo: { entidade: tipo, entidadeId: e.id }, extra: '' }))
  )
    .map((o) => ({ ...o, chave: `${o.alvo.entidade}|${o.alvo.entidadeId}`, nome: registos.nome(o.alvo) }))
    .filter((o) => !jaLigados.has(o.chave))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
  const termos = normalizar(texto).split(/\s+/).filter(Boolean);
  const visiveis = opcoes.filter((o) => termos.every((t) => normalizar(`${o.nome} ${o.extra}`).includes(t)));
  const ref = origem.entidade === 'equipamento' ? registos.eq.find((e) => e.id === origem.entidadeId) : undefined;
  const iguais = ref && tipo === 'equipamento' ? equipamentosIguais(registos.eq, ref).filter((e) => !jaLigados.has(`equipamento|${e.id}`)) : [];
  const alternar = (k: string) => setEscolhidos((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  async function ligar() {
    setAGravar(true);
    setErro(null);
    try {
      const alvos = [...escolhidos].map((k) => { const [entidade, entidadeId] = k.split('|') as [EntidadeDocumento, string]; return { entidade, entidadeId }; });
      aoFechar(await ligarDocumento(db, doc.id, alvos));
    } catch (e) {
      setErro((e as Error).message);
      setAGravar(false);
    }
  }

  return (
    <Modal aberto onFechar={() => aoFechar()}>
      <p className="font-semibold">Ligar «{doc.nome}» a outros registos</p>
      <p className="text-xs text-slate-500">O ficheiro guarda-se uma só vez; aparece em todos os registos escolhidos.</p>
      <select className="campo" aria-label="Tipo de registo" value={tipo} onChange={(e) => { setTipo(e.target.value as EntidadeDocumento); setTexto(''); }}>
        {(Object.keys(ROTULO_ENTIDADE) as EntidadeDocumento[]).map((t) => <option key={t} value={t}>{ROTULO_ENTIDADE[t]}</option>)}
      </select>
      {iguais.length > 0 && (
        <button className="btn-secundario w-full" onClick={() => setEscolhidos((s) => new Set([...s, ...iguais.map((e) => `equipamento|${e.id}`)]))}>
          Escolher os iguais a este ({iguais.length}: mesmo nome, marca e modelo)
        </button>
      )}
      {opcoes.length > 6 && <input className="campo" type="search" aria-label="Procurar registo" placeholder="Procurar…" value={texto} onChange={(e) => setTexto(e.target.value)} />}
      <ul className="max-h-[40dvh] divide-y divide-slate-100 overflow-y-auto text-sm">
        {visiveis.map((o) => (
          <li key={o.chave}>
            <label className="flex items-center gap-3 py-2">
              <input type="checkbox" className="h-5 w-5 shrink-0" checked={escolhidos.has(o.chave)} onChange={() => alternar(o.chave)} />
              <span className="min-w-0"><span className="block truncate">{o.nome}</span>{o.extra && <span className="block truncate text-xs text-slate-500">{o.extra}</span>}</span>
            </label>
          </li>
        ))}
        {visiveis.length === 0 && <li className="py-2 text-slate-500">{opcoes.length === 0 ? 'Já está ligado a todos.' : 'Nenhum com esta pesquisa.'}</li>}
      </ul>
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <div className="grid grid-cols-2 gap-3">
        <button className="btn-secundario" onClick={() => aoFechar()}>Cancelar</button>
        <button className="btn-primario" disabled={escolhidos.size === 0 || aGravar} onClick={() => void ligar()}>Ligar a {escolhidos.size}</button>
      </div>
    </Modal>
  );
}
