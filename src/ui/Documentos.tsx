import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Documento, type EntidadeDocumento } from '../db/schema';
import { anexarDocumento, formatarTamanho, LIMITE_BYTES, removerDocumento } from '../db/documentos';
import { partilharOuDescarregar } from '../backup/partilha';
import { Aviso, Modal, dataPt } from './comuns';
import { dimensoesImagem } from '../fotos/dimensoes';
import { avaliarTamanhoPlanta, MP_AVISO, MP_RECUSA } from '../db/zonas';

export function Documentos({ entidade, entidadeId, editavel = true }: { entidade: EntidadeDocumento; entidadeId: string; editavel?: boolean }) {
  const docs = useLiveQuery(
    () => db.documentos.where('[entidade+entidadeId]').equals([entidade, entidadeId]).filter((d) => !d.deletedAt).sortBy('createdAt'),
    [entidade, entidadeId]
  );
  const [aRemover, setARemover] = useState<Documento | null>(null);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
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
      try { await anexarDocumento(db, entidade, entidadeId, f); n++; } catch (e) { erros.push((e as Error).message); }
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

  return (
    <section className="cartao space-y-3">
      <h3 className="font-semibold">Documentos {docs ? `(${docs.length})` : ''}</h3>
      {docs && docs.length > 0 && (
        <ul className="divide-y divide-slate-100 text-sm">
          {docs.map((d) => (
            <li key={d.id} className="space-y-1 py-2">
              <p className="break-all font-medium">{d.mime === 'application/pdf' ? '📄' : '🖼️'} {d.nome}</p>
              <p className="text-xs text-slate-500">{formatarTamanho(d.tamanho)} · {dataPt(d.createdAt)}{d.descricao ? ` · ${d.descricao}` : ''}</p>
              <div className="flex gap-4 text-xs">
                <button className="text-teal-700 underline" onClick={() => abrir(d)}>Abrir</button>
                <button className="text-teal-700 underline" onClick={() => void partilharOuDescarregar(d.blob, d.nome)}>Partilhar</button>
                {editavel && <button className="text-red-700 underline" onClick={() => setARemover(d)}>Remover</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      {editavel && (
        <>
          <input ref={input} type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void adicionar(e.target.files)} />
          <button className="btn-secundario w-full" disabled={ocupado} onClick={() => input.current?.click()}>{ocupado ? 'A guardar…' : '📎 Anexar PDF ou imagem'}</button>
          <p className="text-xs text-slate-500">Até {LIMITE_BYTES / 1048576} MB cada. Ficam só neste telemóvel e entram na cópia completa.</p>
        </>
      )}
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
      <Modal aberto={aRemover !== null} onFechar={() => setARemover(null)}>
        <p className="font-semibold">Remover «{aRemover?.nome}»?</p>
        <p className="text-sm text-slate-600">Deixa de aparecer aqui. Continua nas cópias de segurança já feitas.</p>
        <div className="grid grid-cols-2 gap-3">
          <button className="btn-secundario" onClick={() => setARemover(null)}>Manter</button>
          <button className="btn-perigo" onClick={async () => { if (aRemover) await removerDocumento(db, aRemover.id); setARemover(null); }}>Remover</button>
        </div>
      </Modal>
    </section>
  );
}
