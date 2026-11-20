import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Equipamento, type Localizacao } from '../db/schema';
import { atualizarLocalizacao, criarLocalizacao, eliminarLocalizacao } from '../db/repo';
import { ir, substituir, voltar } from './router';
import { Aviso, Campo, EstadoBadge, Modal, EntradaComSugestoes } from './comuns';
import { Fotos } from './Fotos';
import { PlantaLocal } from './Planta';
import { KitsNoLocal } from './Kits';
import { Documentos } from './Documentos';

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
  if (!dados) return null;

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Locais</h2>
        <button className="btn-primario px-5" onClick={() => ir('/locais/novo')} aria-label="Nova localização">+</button>
      </div>
      {dados.length === 0 ? (
        <p className="cartao text-center text-sm text-slate-500">Ainda não há locais. Toca em + para criar o primeiro.</p>
      ) : (
        <ul className="space-y-2">
          {dados.map(({ l, n }) => (
            <li key={l.id}>
              <button className="cartao flex w-full items-center justify-between text-left active:bg-slate-50" onClick={() => ir(`/locais/${l.id}`)}>
                <span>
                  <span className="block font-semibold">{l.nome}</span>
                  <span className="text-sm text-slate-500">{rotuloTipo(l.tipo)}</span>
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
  const usados = useLiveQuery(async () => [...new Set((await db.localizacoes.filter((x) => !x.deletedAt).toArray()).map((x) => rotuloTipo(x.tipo)))], []) ?? [];
  const [notas, setNotas] = useState(l?.notas ?? '');
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [eliminar, setEliminar] = useState(false);

  async function guardar() {
    setAviso(null);
    try {
      if (!l) {
        const criada = await criarLocalizacao(db, { nome, tipo: chaveDoTipo(tipo), notas });
        substituir(`/locais/${criada.id}`);
      } else {
        await atualizarLocalizacao(db, l.id, { nome, tipo: chaveDoTipo(tipo), notas });
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

      <div className="cartao space-y-3">
        <Campo rotulo="Nome *"><input className="campo" value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="off" /></Campo>
        <Campo rotulo="Tipo">
          <EntradaComSugestoes valor={tipo} aoMudar={setTipo} sugestoes={[...Object.values(TIPOS), ...usados]} placeholder="Toca numa opção ou escreve a tua" />
        </Campo>
        <Campo rotulo="Notas"><textarea className="campo min-h-24" value={notas} onChange={(e) => setNotas(e.target.value)} /></Campo>
        <button className="btn-primario w-full" onClick={guardar}>{l ? 'Guardar alterações' : 'Criar localização'}</button>
      </div>

      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}

      {l && <KitsNoLocal localId={l.id} />}
      {l && <PlantaLocal localId={l.id} destaque={destaque} />}
      {l && <Documentos entidade="localizacao" entidadeId={l.id} />}
      {l && <div className="cartao"><Fotos entidade="localizacao" entidadeId={l.id} editavel /></div>}

      {l && (
        <div className="cartao space-y-3">
          <h3 className="font-semibold">Equipamentos aqui ({equips.length})</h3>
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

      {l && (
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
