import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Artigo, type ContagemStock, type Equipamento, type Localizacao } from '../db/schema';
import { estaAberta } from '../db/anomalias';
import { atualizarLocalizacao, criarLocalizacao, eliminarLocalizacao } from '../db/repo';
import { ir, substituir, voltar } from './router';
import { Aviso, Campo, EntradaComSugestoes, EstadoBadge, Modal, SeGestor, SeletorOrdem, useOrdem } from './comuns';
import { ordenarListaLocais } from '../db/ordenar';
import { Fotos } from './Fotos';
import { PlantaLocal } from './Planta';
import { KitsNoLocal } from './Kits';
import { InventarioLocal } from './Planta';
import { BotaoInspecaoLocal } from './Inspecoes';
import { Documentos } from './Documentos';
import { pdfEtiquetasLocais } from '../export/gerar';
import { partilharOuDescarregar } from '../backup/partilha';

/** Gera as etiquetas QR (todas as visíveis ou só um local) e partilha/descarrega o PDF. */
function BotaoEtiquetas({ ids, rotulo }: { ids: string[]; rotulo: string }) {
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  async function gerar() {
    setOcupado(true); setMsg(null);
    try {
      const { blob, nome } = await pdfEtiquetasLocais(db, location.origin + location.pathname, ids);
      const r = await partilharOuDescarregar(blob, nome);
      if (r !== 'cancelado') setMsg({ tipo: 'ok', texto: r === 'partilhado' ? `Partilhado: ${nome}.` : `Guardado em Transferências: ${nome}.` });
    } catch (e) { setMsg({ tipo: 'erro', texto: (e as Error).message }); }
    setOcupado(false);
  }
  return (
    <>
      <button className="btn-secundario w-full" disabled={ocupado || ids.length === 0} onClick={() => void gerar()}>{ocupado ? 'A gerar…' : rotulo}</button>
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
    </>
  );
}

/** Tipos de série (guardados com estas chaves). Qualquer outro texto é um tipo criado por ti. */
export const TIPOS: Record<string, string> = {
  divisao: 'Divisão',
  armazenamento: 'Armazenamento',
  zona_comum: 'Zona comum',
  exterior: 'Exterior',
  outro: 'Outro'
};

export const rotuloTipo = (t: string) => TIPOS[t] ?? t;
/** Texto escrito → chave de série se coincidir com um tipo de série; senão o próprio texto. */
const chaveDoTipo = (texto: string) => {
  const n = texto.trim().toLowerCase();
  return Object.entries(TIPOS).find(([, v]) => v.toLowerCase() === n)?.[0] ?? texto.trim();
};

export function ListaLocais() {
  const dados = useLiveQuery(async () => {
    const [locais, equips] = await Promise.all([db.localizacoes.toArray(), db.equipamentos.toArray()]);
    return locais
      .filter((l) => !l.deletedAt)
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt'))
      .map((l) => ({ l, n: equips.filter((e) => e.localizacaoId === l.id && e.estado !== 'abatido').length }));
  }, []);
  const [piso, setPiso] = useState(() => new URLSearchParams(location.hash.split('?')[1] ?? '').get('piso') ?? '');
  const [ordem, setOrdem] = useOrdem('locais');
  if (!dados) return null;
  const pisos = [...new Set(dados.map(({ l }) => (l.piso ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt', { numeric: true }));
  const visiveis = ordenarListaLocais(piso ? dados.filter(({ l }) => (l.piso ?? '') === piso) : dados, ordem);

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Locais</h2>
        <SeGestor><button className="btn-primario px-5" onClick={() => ir('/locais/novo')} aria-label="Nova localização">+</button></SeGestor>
      </div>
      {pisos.length > 0 && (
        <select className="campo" aria-label="Piso" value={piso} onChange={(e) => setPiso(e.target.value)}>
          <option value="">Todos os pisos</option>
          {pisos.map((p) => <option key={p} value={p}>Piso {p}</option>)}
        </select>
      )}
      {dados.length > 1 && <SeletorOrdem lista="locais" ordem={ordem} aoMudar={setOrdem} />}
      {dados.length > 0 && <BotaoEtiquetas ids={visiveis.map(({ l }) => l.id)} rotulo={`▦ Etiquetas QR para as portas (${visiveis.length})`} />}
      {dados.length === 0 ? (
        <p className="cartao text-center text-sm text-slate-500">Ainda não há locais. Toca em + para criar o primeiro.</p>
      ) : (
        <ul className="space-y-2">
          {visiveis.map(({ l, n }) => (
            <li key={l.id}>
              <button className="cartao flex w-full items-center justify-between text-left active:bg-slate-50" onClick={() => ir(`/locais/${l.id}`)}>
                <span>
                  <span className="block font-semibold">{l.nome}</span>
                  <span className="text-sm text-slate-500">{[rotuloTipo(l.tipo), l.piso ? `Piso ${l.piso}` : '', l.ala ? `Ala ${l.ala}` : ''].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="text-sm text-slate-500">{n} equip.</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function FichaLocal({ id, destaque = null }: { id: string; destaque?: string | null }) {
  const novo = id === 'novo';
  const l = useLiveQuery(async (): Promise<Localizacao | null | false> => {
    if (novo) return null;
    const x = await db.localizacoes.get(id);
    return x && !x.deletedAt ? x : false;
  }, [id]);
  const equips = useLiveQuery(async (): Promise<Equipamento[]> => (novo ? [] : db.equipamentos.where('localizacaoId').equals(id).toArray()), [id]);

  if (l === undefined || equips === undefined) return null;
  if (l === false) {
    return (
      <>
        <p className="cartao">Esta localização não existe.</p>
        <button className="btn-secundario w-full" onClick={() => voltar('/locais')}>Voltar</button>
      </>
    );
  }
  return <FormLocal key={l?.id ?? 'novo'} l={l} equips={equips} destaque={destaque} />;
}

function FormLocal({ l, equips, destaque }: { l: Localizacao | null; equips: Equipamento[]; destaque: string | null }) {
  const [nome, setNome] = useState(l?.nome ?? '');
  const [tipo, setTipo] = useState<string>(rotuloTipo(l?.tipo ?? 'divisao'));
  const [pisoF, setPisoF] = useState(l?.piso ?? '');
  const [alaF, setAlaF] = useState(l?.ala ?? '');
  const outros = useLiveQuery(async () => (await db.localizacoes.filter((x) => !x.deletedAt).toArray()), []) ?? [];
  const usados = useLiveQuery(async () => [...new Set((await db.localizacoes.filter((x) => !x.deletedAt).toArray()).map((x) => rotuloTipo(x.tipo)))], []) ?? [];
  const [notas, setNotas] = useState(l?.notas ?? '');
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [eliminar, setEliminar] = useState(false);
  // Ficha do local em quatro secções: o que há, repor, equipamentos e anomalias. A edição fica numa quinta.
  // Vindo de uma pesquisa ou da planta (destaque), abre logo a planta.
  const [secao, setSecao] = useState<Secao>(destaque ? 'editar' : 'tem');
  const anomaliasAqui = useLiveQuery(async () => (l ? (await db.anomalias.where('localizacaoId').equals(l.id).toArray()).filter((a) => !a.deletedAt && estaAberta(a)) : []), [l?.id]) ?? [];

  async function guardar() {
    setAviso(null);
    try {
      if (!l) {
        const criada = await criarLocalizacao(db, { nome, tipo: chaveDoTipo(tipo), notas, piso: pisoF, ala: alaF });
        substituir(`/locais/${criada.id}`);
      } else {
        await atualizarLocalizacao(db, l.id, { nome, tipo: chaveDoTipo(tipo), notas, piso: pisoF, ala: alaF });
        setAviso({ tipo: 'ok', texto: 'Guardado.' });
      }
    } catch (e) {
      setAviso({ tipo: 'erro', texto: (e as Error).message });
    }
  }

  async function confirmarEliminar() {
    if (!l) return;
    try {
      await eliminarLocalizacao(db, l.id);
      substituir('/locais');
    } catch (e) {
      setAviso({ tipo: 'erro', texto: (e as Error).message });
      setEliminar(false);
    }
  }

  return (
    <>
      <button className="text-sm text-teal-700" onClick={() => voltar('/locais')}>← Locais</button>
      <h2 className="text-xl font-semibold">{l ? l.nome : 'Nova localização'}</h2>

      {l && (
        <div role="tablist" aria-label="Secções do local" className="flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1 text-sm">
          {SECOES.map(([k, rotulo]) => (
            <button key={k} role="tab" aria-selected={secao === k} onClick={() => setSecao(k)}
              className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-2 font-medium ${secao === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}>{rotulo}</button>
          ))}
        </div>
      )}

      {l && secao === 'tem' && <div className="cartao space-y-2"><h3 className="font-semibold">O que tem</h3><LocalStock localId={l.id} /></div>}
      {l && secao === 'repor' && (
        <>
          <KitsNoLocal localId={l.id} />
          <div className="cartao text-sm text-slate-600">
            <p>Sem kit aqui? Aplica um kit na secção de Kits (Mais), ou conta um artigo em Stock → «Contar em» este local.</p>
          </div>
        </>
      )}
      {l && secao === 'equip' && (
        <div className="cartao space-y-3">
          <h3 className="font-semibold">Equipamentos aqui ({equips.length})</h3>
          {equips.length === 0 && <p className="text-sm text-slate-500">Nenhum equipamento neste local.</p>}
          {equips.length > 0 && (
            <ul className="divide-y divide-slate-100">
              {equips.map((e) => (
                <li key={e.id}>
                  <button className="flex w-full items-center justify-between py-2 text-left" onClick={() => ir(`/equipamentos/${e.id}`)}>
                    <span className="text-sm"><span className="font-mono text-xs text-slate-500">{e.codigo}</span> {e.nome}</span>
                    <EstadoBadge estado={e.estado} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button className="btn-secundario w-full" onClick={() => ir(`/equipamentos/novo?local=${l.id}`)}>+ Equipamento neste local</button>
        </div>
      )}
      {l && secao === 'anom' && (
        <div className="cartao space-y-3">
          <h3 className="font-semibold">Anomalias abertas ({anomaliasAqui.length})</h3>
          {anomaliasAqui.length === 0 && <p className="text-sm text-slate-500">Nenhuma anomalia aberta aqui.</p>}
          {anomaliasAqui.length > 0 && (
            <ul className="divide-y divide-slate-100">
              {anomaliasAqui.map((a) => (
                <li key={a.id}>
                  <button className="flex w-full items-center justify-between py-2 text-left" onClick={() => ir(`/anomalias/${a.id}`)}>
                    <span className="text-sm"><span className="font-mono text-xs text-slate-500">{a.codigo}</span> {a.titulo}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button className="btn-primario w-full" onClick={() => ir(`/anomalias/nova?local=${l.id}`)}>+ Reportar anomalia aqui</button>
        </div>
      )}

      {(!l || secao === 'editar') && <div className="cartao space-y-3">
        <Campo rotulo="Nome *"><input className="campo" value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="off" /></Campo>
        <Campo rotulo="Tipo">
          <EntradaComSugestoes valor={tipo} aoMudar={setTipo} sugestoes={[...Object.values(TIPOS), ...usados]} placeholder="Toca numa opção ou escreve a tua" />
        </Campo>
        <Campo rotulo="Piso (opcional)">
          <EntradaComSugestoes valor={pisoF} aoMudar={setPisoF} sugestoes={outros.map((x) => x.piso ?? '')} placeholder="Ex.: 0, 1, Cave" />
        </Campo>
        <Campo rotulo="Ala (opcional)">
          <EntradaComSugestoes valor={alaF} aoMudar={setAlaF} sugestoes={outros.map((x) => x.ala ?? '')} placeholder="Ex.: Norte, A" />
        </Campo>
        <Campo rotulo="Notas"><textarea className="campo min-h-24" value={notas} onChange={(e) => setNotas(e.target.value)} /></Campo>
        <button className="btn-primario w-full" onClick={guardar}>{l ? 'Guardar alterações' : 'Criar localização'}</button>
      </div>}

      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}

      {l && secao === 'tem' && <BotaoInspecaoLocal localId={l.id} />}
      {l && secao === 'editar' && <BotaoEtiquetas ids={[l.id]} rotulo="▦ Etiqueta QR deste local" />}
      {l && secao === 'editar' && <PlantaLocal localId={l.id} destaque={destaque} />}
      {l && secao === 'editar' && <Documentos entidade="localizacao" entidadeId={l.id} />}
      {l && secao === 'editar' && <div className="cartao"><Fotos entidade="localizacao" entidadeId={l.id} editavel /></div>}

      {l && secao === 'editar' && (
        <button className="btn-perigo w-full" onClick={() => setEliminar(true)}>Eliminar localização</button>
      )}

      <Modal aberto={eliminar} onFechar={() => setEliminar(false)}>
        <p className="font-semibold">Eliminar «{l?.nome}»?</p>
        <p className="text-sm text-slate-600">Só é possível se não houver equipamentos nela. O registo fica guardado na cópia de segurança.</p>
        <div className="grid grid-cols-2 gap-3">
          <button className="btn-secundario" onClick={() => setEliminar(false)}>Cancelar</button>
          <button className="btn-perigo" onClick={confirmarEliminar}>Eliminar</button>
        </div>
      </Modal>
    </>
  );
}

type Secao = 'tem' | 'repor' | 'equip' | 'anom' | 'editar';
const SECOES: [Secao, string][] = [['tem', 'O que tem'], ['repor', 'Repor'], ['equip', 'Equipamentos'], ['anom', 'Anomalias'], ['editar', 'Editar']];

/** Stock deste local: quantidade de cada artigo (última contagem), com botão para contar. */
function LocalStock({ localId }: { localId: string }) {
  const dados = useLiveQuery(async () => ({
    artigos: (await db.artigos.toArray()).filter((a) => !a.deletedAt) as Artigo[],
    contagens: (await db.contagensStock.where('localizacaoId').equals(localId).toArray()) as ContagemStock[],
  }), [localId]);
  if (!dados) return null;
  return (
    <>
      <InventarioLocal localId={localId} artigos={dados.artigos} contagens={dados.contagens} />
      <button className="btn-secundario w-full" onClick={() => ir('/stock')}>Contar artigos (Stock)</button>
    </>
  );
}
