import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/schema';
import { MIN_CARACTERES, pesquisar, type TipoResultado } from '../db/pesquisa';
import { stockPorArtigo } from '../db/stock';
import { ir, voltar } from './router';

const TITULOS: Record<TipoResultado, string> = { equipamento: 'Equipamentos', artigo: 'Artigos', local: 'Locais', anomalia: 'Anomalias' };

export function Pesquisa() {
  const [texto, setTexto] = useState('');
  const equipamentos = useLiveQuery(() => db.equipamentos.toArray(), []);
  const artigos = useLiveQuery(() => db.artigos.toArray(), []);
  const locais = useLiveQuery(() => db.localizacoes.toArray(), []);
  const anomalias = useLiveQuery(() => db.anomalias.toArray(), []);
  const contagens = useLiveQuery(() => db.contagensStock.toArray(), []);
  const plantas = useLiveQuery(async () => {
    const mapa: Record<string, string> = {};
    for (const m of (await db.marcadores.toArray()).filter((x) => !x.deletedAt)) {
      const d = await db.documentos.get(m.documentoId);
      if (d && !d.deletedAt && d.entidade === 'localizacao') mapa[m.refId] = d.entidadeId;
    }
    return mapa;
  }, []) ?? {};
  if (!equipamentos || !artigos || !locais || !anomalias || !contagens) return null;

  const nomeLocal = (id: string) => locais.find((l) => l.id === id)?.nome ?? '';
  const stocks = stockPorArtigo(artigos, contagens);
  const stockDe = (id: string) => {
    const s = stocks.find((x) => x.artigo.id === id);
    if (!s || s.porLocal.length === 0) return 'sem contagem';
    return `${s.total} ${s.artigo.unidade} (${s.porLocal.map((l) => `${nomeLocal(l.localizacaoId)}: ${l.quantidade}`).join('; ')})`;
  };
  const r = pesquisar(texto, { equipamentos, artigos, locais, anomalias, stockDe, nomeLocal });
  const tipos = (Object.keys(TITULOS) as TipoResultado[]).filter((t) => r.some((x) => x.tipo === t));

  return (
    <>
      <button className="text-sm text-teal-700" onClick={() => voltar('/')}>← Voltar</button>
      <input className="campo" type="search" autoFocus placeholder="Pesquisar em tudo: equipamentos, artigos, locais, anomalias…" value={texto} onChange={(e) => setTexto(e.target.value)} />
      {texto.trim().length >= MIN_CARACTERES && r.length === 0 && <p className="cartao text-center text-sm text-slate-500">Nada encontrado.</p>}
      {tipos.map((t) => (
        <section key={t} className="cartao">
          <h3 className="font-semibold">{TITULOS[t]}</h3>
          <ul className="divide-y divide-slate-100">
            {r.filter((x) => x.tipo === t).map((x) => (
              <li key={x.id}>
                <button className="w-full py-2.5 text-left" onClick={() => ir(x.rota)}>
                  <span className="block text-sm font-medium">{x.titulo}</span>
                  <span className="text-xs text-slate-500">{x.detalhe}</span>
                </button>
                {plantas[x.id] && <button className="pb-2 text-xs text-teal-700 underline" onClick={() => ir(`/locais/${plantas[x.id]}?destaque=${x.id}`)}>Ver na planta</button>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
