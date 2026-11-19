import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Artigo, type TipoMovimento } from '../db/schema';
import { anularMovimento, registarMovimento, TIPOS_MOVIMENTO } from '../db/movimentos';
import { hojeIso } from '../db/agenda';
import { lerResponsavel } from '../export/gerar';
import { Aviso, Campo, diaPt } from './comuns';

interface Props {
  artigo: Artigo;
  locais: { id: string; nome: string }[];
  nomeLocal: (id: string) => string;
  /** Stock atual por local (para mostrar o disponível). */
  disponivel: (localId: string) => number;
}

export function Movimentos({ artigo, locais, nomeLocal, disponivel }: Props) {
  const movs = useLiveQuery(() => db.movimentosStock.where('artigoId').equals(artigo.id).filter((m) => !m.deletedAt).toArray(), [artigo.id]);
  const [tipo, setTipo] = useState<TipoMovimento>('transferencia');
  const [origem, setOrigem] = useState(locais[0]?.id ?? '');
  const [destino, setDestino] = useState('');
  const [qtd, setQtd] = useState('');
  const [motivo, setMotivo] = useState('');
  const [resp, setResp] = useState('');
  const [data, setData] = useState(hojeIso());
  const [aberto, setAberto] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  useEffect(() => { void lerResponsavel(db).then(setResp); }, []);

  const fmt = (n: number) => n.toLocaleString('pt-PT', { maximumFractionDigits: 3 });
  async function registar() {
    setAviso(null);
    try {
      await registarMovimento(db, { artigoId: artigo.id, tipo, quantidade: qtd, origemId: origem, destinoId: destino, motivo, responsavel: resp, data });
      setQtd(''); setMotivo('');
      setAviso({ tipo: 'ok', texto: 'Movimento registado.' });
    } catch (e) {
      setAviso({ tipo: 'erro', texto: (e as Error).message });
    }
  }
  async function anular(id: string) {
    setAviso(null);
    try { await anularMovimento(db, id); } catch (e) { setAviso({ tipo: 'erro', texto: (e as Error).message }); }
  }

  const lista = (movs ?? []).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 10);
  return (
    <div className="cartao space-y-3">
      <button className="flex w-full items-center justify-between" onClick={() => setAberto((x) => !x)}>
        <h3 className="font-semibold">Movimentos</h3>
        <span className="text-sm text-teal-700">{aberto ? 'Fechar' : 'Transferir / perda / ajuste'}</span>
      </button>
      {aberto && (
        locais.length === 0 ? <Aviso tipo="erro">Cria primeiro um local.</Aviso> : (
          <>
            <Campo rotulo="Tipo">
              <select className="campo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoMovimento)}>
                {(Object.keys(TIPOS_MOVIMENTO) as TipoMovimento[]).map((t) => <option key={t} value={t}>{TIPOS_MOVIMENTO[t]}</option>)}
              </select>
            </Campo>
            <Campo rotulo={tipo === 'transferencia' ? 'De' : 'Local'} dica={`Disponível: ${fmt(disponivel(origem))} ${artigo.unidade}`}>
              <select className="campo" value={origem} onChange={(e) => setOrigem(e.target.value)}>
                {locais.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
              </select>
            </Campo>
            {tipo === 'transferencia' && (
              <Campo rotulo="Para">
                <select className="campo" value={destino} onChange={(e) => setDestino(e.target.value)}>
                  <option value="">Escolhe…</option>
                  {locais.filter((l) => l.id !== origem).map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
                </select>
              </Campo>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Campo rotulo={`Quantidade (${artigo.unidade})`} dica={tipo === 'ajuste' ? 'Negativo retira' : undefined}>
                <input className="campo" inputMode="decimal" value={qtd} onChange={(e) => setQtd(e.target.value)} />
              </Campo>
              <Campo rotulo="Data"><input className="campo" type="date" value={data} onChange={(e) => setData(e.target.value)} /></Campo>
            </div>
            <Campo rotulo="Motivo *"><input className="campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} autoComplete="off" /></Campo>
            <Campo rotulo="Responsável"><input className="campo" value={resp} onChange={(e) => setResp(e.target.value)} autoComplete="off" /></Campo>
            <button className="btn-primario w-full" disabled={!qtd.trim() || !motivo.trim()} onClick={registar}>Registar movimento</button>
            <p className="text-xs text-slate-500">Perdas, danificados e ajustes ficam registados como tal (não como simples variação de contagem).</p>
          </>
        )
      )}
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
      {lista.length > 0 && (
        <ul className="divide-y divide-slate-100 text-sm">
          {lista.map((m, i) => (
            <li key={m.id} className="py-2">
              <div className="flex justify-between gap-2">
                <span>{TIPOS_MOVIMENTO[m.tipo]}{m.tipo === 'transferencia' ? `: ${nomeLocal(m.origemId ?? '')} → ${nomeLocal(m.destinoId ?? '')}` : ` · ${nomeLocal(m.origemId ?? '')}`}</span>
                <span className="font-medium">{m.tipo === 'ajuste' && m.quantidade > 0 ? '+' : ''}{fmt(m.quantidade)}</span>
              </div>
              <p className="text-xs text-slate-500">{diaPt(m.data)} · {m.motivo}{m.responsavel ? ` · ${m.responsavel}` : ''}</p>
              {i === 0 && <button className="mt-1 text-xs text-red-700 underline" onClick={() => anular(m.id)}>Anular este movimento (engano)</button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
