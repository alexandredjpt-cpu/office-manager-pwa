import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type EntidadeFoto, type Fotografia } from '../db/schema';
import { adicionarFoto, eliminarLogico } from '../db/repo';
import { comprimirImagem } from '../fotos/comprimir';
import { Aviso, Modal, useUrlDoBlob } from './comuns';

function Miniatura({ foto, aoAbrir }: { foto: Fotografia; aoAbrir: () => void }) {
  const url = useUrlDoBlob(foto.id, foto.blob);
  return (
    <button onClick={aoAbrir} className="aspect-square overflow-hidden rounded-xl bg-slate-200" aria-label="Ver fotografia">
      {url && <img src={url} alt="" className="h-full w-full object-cover" />}
    </button>
  );
}

function Grande({ foto }: { foto: Fotografia }) {
  const url = useUrlDoBlob(foto.id, foto.blob);
  return url ? <img src={url} alt="Fotografia" className="max-h-[60dvh] w-full rounded-xl object-contain" /> : null;
}

/** `fase`: só mostra e grava fotos dessa fase ('antes' inclui as antigas sem fase). Assinaturas nunca aparecem aqui. */
export function Fotos({ entidade, entidadeId, editavel, fase, titulo = 'Fotografias' }: { entidade: EntidadeFoto; entidadeId: string; editavel: boolean; fase?: 'antes' | 'depois'; titulo?: string }) {
  const fotos = useLiveQuery(
    () => db.fotografias.where('[entidade+entidadeId]').equals([entidade, entidadeId])
      .filter((f) => !f.deletedAt && f.fase !== 'assinatura' && (!fase || (fase === 'depois' ? f.fase === 'depois' : f.fase !== 'depois')))
      .sortBy('createdAt'),
    [entidade, entidadeId, fase]
  );
  const [aVer, setAVer] = useState<Fotografia | null>(null);
  const [aApagar, setAApagar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const camara = useRef<HTMLInputElement>(null);

  async function adicionar(lista: FileList | null) {
    if (!lista?.length) return;
    setOcupado(true);
    setErro(null);
    try {
      for (const f of Array.from(lista)) await adicionarFoto(db, entidade, entidadeId, await comprimirImagem(f), fase === 'depois' ? { fase } : {});
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(false);
      if (input.current) input.current.value = '';
    }
  }

  async function eliminar() {
    if (!aVer) return;
    await eliminarLogico(db, 'fotografias', aVer.id);
    setAVer(null);
    setAApagar(false);
  }

  return (
    <section className="space-y-3">
      <h3 className="font-semibold">{titulo} {fotos ? `(${fotos.length})` : ''}</h3>
      {fotos && fotos.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {fotos.map((f) => <Miniatura key={f.id} foto={f} aoAbrir={() => setAVer(f)} />)}
        </div>
      )}
      {editavel && (
        <>
          {/* capture abre a câmara diretamente no Android; sem capture (e com multiple) o Chrome abre a galeria. */}
          <input ref={camara} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void adicionar(e.target.files); e.target.value = ''; }} />
          <input ref={input} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { void adicionar(e.target.files); e.target.value = ''; }} />
          {ocupado ? (
            <button className="btn-secundario w-full" disabled>A comprimir…</button>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button className="btn-primario" onClick={() => camara.current?.click()}>📷 Tirar foto</button>
              <button className="btn-secundario" onClick={() => input.current?.click()}>🖼 Da galeria</button>
            </div>
          )}
        </>
      )}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}

      <Modal aberto={aVer !== null} onFechar={() => { setAVer(null); setAApagar(false); }}>
        {aVer && <Grande foto={aVer} />}
        {aVer && <p className="text-xs text-slate-500">{Math.round(aVer.blob.size / 1024)} KB</p>}
        {aApagar ? (
          <div className="grid grid-cols-2 gap-3">
            <button className="btn-secundario" onClick={() => setAApagar(false)}>Manter</button>
            <button className="btn-perigo" onClick={eliminar}>Remover foto</button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <button className="btn-secundario" onClick={() => setAVer(null)}>Fechar</button>
            {editavel && <button className="btn-perigo" onClick={() => setAApagar(true)}>Remover</button>}
          </div>
        )}
      </Modal>
    </section>
  );
}
