import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Prioridade } from '../db/schema';
import { PRIORIDADES } from '../db/anomalias';
import { guardarResponsavel, lerResponsavel, pdfCompras, pdfHistoricoInspecoes, pdfInventario, pdfPendentes, pdfReposicao, pdfResolvidas, type Resultado } from '../export/gerar';
import { partilharOuDescarregar } from '../backup/partilha';
import { voltar } from './router';
import { Aviso, Campo } from './comuns';

/** Gera, e depois partilha (Android) ou descarrega. */
export async function entregarPdf(fazer: () => Promise<Resultado>): Promise<string> {
  const { blob, nome } = await fazer();
  const r = await partilharOuDescarregar(blob, nome);
  return r === 'cancelado' ? '' : r === 'partilhado' ? `Partilhado: ${nome}.` : `Guardado em Transferências: ${nome}.`;
}

export function Relatorios() {
  const locais = useLiveQuery(() => db.localizacoes.filter((l) => !l.deletedAt).toArray(), []);
  const [resp, setResp] = useState('');
  const [prio, setPrio] = useState<Prioridade | ''>('');
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [local, setLocal] = useState('');
  const [localInsp, setLocalInsp] = useState('');
  const [localRep, setLocalRep] = useState('');
  const comKits = useLiveQuery(async () => new Set((await db.kitLocais.toArray()).filter((x) => !x.deletedAt).map((x) => x.localizacaoId)), []);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  useEffect(() => { lerResponsavel(db).then(setResp); }, []);

  async function gerar(fazer: () => Promise<Resultado>) {
    setMsg(null);
    setOcupado(true);
    try {
      const texto = await entregarPdf(fazer);
      if (texto) setMsg({ tipo: 'ok', texto });
    } catch (e) {
      setMsg({ tipo: 'erro', texto: `Falhou: ${(e as Error).message}` });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      <button className="text-sm text-teal-700" onClick={() => voltar('/mais')}>← Mais</button>
      <h2 className="text-xl font-semibold">Relatórios (PDF)</h2>
      <p className="text-sm text-slate-500">Geram-se no telemóvel, sem rede. No Android podes partilhar o PDF diretamente (e-mail, WhatsApp…).</p>

      <div className="cartao">
        <Campo rotulo="Responsável (aparece nos relatórios)">
          <input className="campo" value={resp} onChange={(e) => setResp(e.target.value)} onBlur={() => guardarResponsavel(db, resp)} autoComplete="name" />
        </Campo>
      </div>

      <div className="cartao space-y-3">
        <h3 className="font-semibold">Anomalias pendentes</h3>
        <select className="campo" aria-label="Prioridade" value={prio} onChange={(e) => setPrio(e.target.value as Prioridade | '')}>
          <option value="">Todas as prioridades</option>
          {Object.entries(PRIORIDADES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="btn-primario w-full" disabled={ocupado} onClick={() => gerar(() => pdfPendentes(db, prio))}>Gerar PDF</button>
      </div>

      <div className="cartao space-y-3">
        <h3 className="font-semibold">Anomalias resolvidas</h3>
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="De"><input className="campo" type="date" value={de} onChange={(e) => setDe(e.target.value)} /></Campo>
          <Campo rotulo="Até"><input className="campo" type="date" value={ate} onChange={(e) => setAte(e.target.value)} /></Campo>
        </div>
        <button className="btn-primario w-full" disabled={ocupado} onClick={() => gerar(() => pdfResolvidas(db, de, ate))}>Gerar PDF</button>
      </div>

      <div className="cartao space-y-3">
        <h3 className="font-semibold">Folha de reposição (kits)</h3>
        <p className="text-xs text-slate-500">Para a ronda: o que há em cada local, o alvo do kit e quanto repor. Coluna «Feito» para marcar à mão.</p>
        <select className="campo" aria-label="Local da folha de reposição" value={localRep} onChange={(e) => setLocalRep(e.target.value)}>
          <option value="">Todos os locais com kits</option>
          {(locais ?? []).filter((l) => comKits?.has(l.id)).sort((a, b) => a.nome.localeCompare(b.nome, 'pt')).map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
        </select>
        <button className="btn-primario w-full" disabled={ocupado} onClick={() => gerar(() => pdfReposicao(db, localRep))}>Gerar PDF</button>
      </div>

      <div className="cartao space-y-3">
        <h3 className="font-semibold">Inventário de stock</h3>
        <select className="campo" aria-label="Local do inventário" value={local} onChange={(e) => setLocal(e.target.value)}>
          <option value="">Geral (todos os locais)</option>
          {(locais ?? []).sort((a, b) => a.nome.localeCompare(b.nome, 'pt')).map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
        </select>
        <button className="btn-primario w-full" disabled={ocupado} onClick={() => gerar(() => pdfInventario(db, local))}>Gerar PDF</button>
      </div>

      <div className="cartao space-y-3">
        <h3 className="font-semibold">Histórico de inspeções</h3>
        <select className="campo" aria-label="Local das inspeções" value={localInsp} onChange={(e) => setLocalInsp(e.target.value)}>
          <option value="">Todos os locais</option>
          {(locais ?? []).sort((a, b) => a.nome.localeCompare(b.nome, 'pt')).map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
        </select>
        <button className="btn-primario w-full" disabled={ocupado} onClick={() => gerar(() => pdfHistoricoInspecoes(db, localInsp))}>Gerar PDF</button>
      </div>

      <div className="cartao space-y-3">
        <h3 className="font-semibold">Necessidades de compra</h3>
        <button className="btn-primario w-full" disabled={ocupado} onClick={() => gerar(() => pdfCompras(db))}>Gerar PDF</button>
      </div>

      {ocupado && <Aviso tipo="ok">A gerar…</Aviso>}
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
    </>
  );
}
