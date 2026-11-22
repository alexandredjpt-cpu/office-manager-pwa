import { EmailPreparar } from './EmailPreparar';
import { camposVazios } from '../db/emails';
import { hojeIso } from '../db/agenda';
import { diaPt } from './comuns';
import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Prioridade } from '../db/schema';
import { PRIORIDADES } from '../db/anomalias';
import { PERIODOS, type TipoPeriodo } from '../export/periodico';
import { guardarResponsavel, lerResponsavel, pdfPeriodo, pdfCompras, pdfHistoricoInspecoes, pdfInventario, pdfDiferencas, pdfPendentes, pdfReposicao, xlsxDiferencas, pdfResolvidas, type Resultado } from '../export/gerar';
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
  const [pisoInsp, setPisoInsp] = useState('');
  const [pisoPend, setPisoPend] = useState('');
  const [localRep, setLocalRep] = useState('');
  const [dif, setDif] = useState({ de: '', ate: '', localizacaoId: '', incluirSemDiferenca: false });
  const pisos = [...new Set((locais ?? []).map((l) => (l.piso ?? '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt', { numeric: true }));
  const comKits = useLiveQuery(async () => new Set((await db.kitLocais.toArray()).filter((x) => !x.deletedAt).map((x) => x.localizacaoId)), []);
  const [periodo, setPeriodo] = useState<TipoPeriodo>('semana_anterior');
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
      <h2 className="text-xl font-semibold">Relatórios</h2>
      <p className="text-sm text-slate-500">Geram-se no telemóvel, sem rede. No Android podes partilhar o PDF diretamente (e-mail, WhatsApp…).</p>

      <div className="cartao">
        <Campo rotulo="Responsável (aparece nos relatórios)">
          <input className="campo" value={resp} onChange={(e) => setResp(e.target.value)} onBlur={() => guardarResponsavel(db, resp)} autoComplete="name" />
        </Campo>
      </div>

      <div className="cartao space-y-3">
        <h3 className="font-semibold">Relatório semanal ou mensal</h3>
        <p className="text-sm text-slate-500">Anomalias registadas e resolvidas, inspeções concluídas, encomendas e o que falta comprar.</p>
        <select className="campo" aria-label="Período" value={periodo} onChange={(e) => setPeriodo(e.target.value as TipoPeriodo)}>
          {Object.entries(PERIODOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="btn-primario w-full" disabled={ocupado} onClick={() => gerar(() => pdfPeriodo(db, periodo))}>Gerar PDF do período</button>
      </div>

      <div className="cartao space-y-3">
        <h3 className="font-semibold">Anomalias pendentes</h3>
        <select className="campo" aria-label="Prioridade" value={prio} onChange={(e) => setPrio(e.target.value as Prioridade | '')}>
          <option value="">Todas as prioridades</option>
          {Object.entries(PRIORIDADES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {pisos.length > 0 && (
          <select className="campo" aria-label="Piso das anomalias" value={pisoPend} onChange={(e) => setPisoPend(e.target.value)}>
            <option value="">Todos os pisos</option>
            {pisos.map((p) => <option key={p} value={p}>Piso {p}</option>)}
          </select>
        )}
        <button className="btn-primario w-full" disabled={ocupado} onClick={() => gerar(() => pdfPendentes(db, prio, pisoPend))}>Gerar PDF</button>
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
        <h3 className="font-semibold">Diferenças entre contagens</h3>
        <p className="text-xs text-slate-500">O que mudou entre uma contagem e a anterior (inclui transferências, perdas e receções). É variação, não consumo.</p>
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="De"><input className="campo" type="date" value={dif.de} onChange={(e) => setDif({ ...dif, de: e.target.value })} /></Campo>
          <Campo rotulo="Até"><input className="campo" type="date" value={dif.ate} onChange={(e) => setDif({ ...dif, ate: e.target.value })} /></Campo>
        </div>
        <select className="campo" aria-label="Local das diferenças" value={dif.localizacaoId} onChange={(e) => setDif({ ...dif, localizacaoId: e.target.value })}>
          <option value="">Todos os locais</option>
          {(locais ?? []).sort((a, b) => a.nome.localeCompare(b.nome, 'pt')).map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={dif.incluirSemDiferenca} onChange={(e) => setDif({ ...dif, incluirSemDiferenca: e.target.checked })} /> Incluir contagens sem diferença</label>
        <div className="grid grid-cols-2 gap-2">
          <button className="btn-primario" disabled={ocupado} onClick={() => gerar(() => pdfDiferencas(db, dif))}>PDF</button>
          <button className="btn-secundario" disabled={ocupado} onClick={() => gerar(() => xlsxDiferencas(db, dif))}>Excel</button>
        </div>
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
        <p className="text-xs text-slate-500">«Todos os locais» = histórico geral (realizadas, em curso e canceladas). Escolhe um piso para o relatório por piso.</p>
        {pisos.length > 0 && (
          <select className="campo" aria-label="Piso das inspeções" value={pisoInsp} onChange={(e) => { setPisoInsp(e.target.value); setLocalInsp(''); }}>
            <option value="">Todos os pisos</option>
            {pisos.map((p) => <option key={p} value={p}>Piso {p}</option>)}
          </select>
        )}
        <select className="campo" aria-label="Local das inspeções" value={localInsp} onChange={(e) => setLocalInsp(e.target.value)}>
          <option value="">Todos os locais</option>
          {(locais ?? []).filter((l) => !pisoInsp || (l.piso ?? '') === pisoInsp).sort((a, b) => a.nome.localeCompare(b.nome, 'pt')).map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
        </select>
        <button className="btn-primario w-full" disabled={ocupado} onClick={() => gerar(() => pdfHistoricoInspecoes(db, localInsp, localInsp ? '' : pisoInsp))}>Gerar PDF</button>
      </div>

      <div className="cartao space-y-3">
        <h3 className="font-semibold">Necessidades de compra</h3>
        <button className="btn-primario w-full" disabled={ocupado} onClick={() => gerar(() => pdfCompras(db))}>Gerar PDF</button>
      </div>

      <div className="cartao space-y-3">
        <h3 className="font-semibold">Stock para Excel</h3>
        <p className="text-sm text-slate-500">Duas folhas legíveis: cada artigo em cada local, e o total por artigo com o mínimo e onde está. Artigos nunca contados aparecem a zero.</p>
        <button className="btn-primario w-full" disabled={ocupado} onClick={() => gerar(async () => { const r = await (await import('../export/stockXlsx')).exportarStockXlsx(db); return { blob: r.blob, nome: r.nome }; })}>Exportar o stock para Excel</button>
      </div>

      <div className="cartao space-y-3">
        <h3 className="font-semibold">Tudo para Excel</h3>
        <p className="text-sm text-slate-500">Um ficheiro com uma folha por tabela (locais, equipamentos, stock, anomalias, inspeções…). Só dados: fotografias e documentos ficam de fora. Não substitui a cópia de segurança.</p>
        <button className="btn-primario w-full" disabled={ocupado} onClick={() => gerar(async () => { const r = await (await import('../export/tudo')).exportarTudoXlsx(db); return { blob: r.blob, nome: r.nome }; })}>Exportar tudo para Excel</button>
      </div>

      <EmailPreparar
        titulo="Enviar um relatório por e-mail"
        origem="relatorio"
        modeloInicial="Envio de relatório de anomalias"
        campos={{ ...camposVazios(), responsavel: resp, data: diaPt(hojeIso()) }}
      />
      <p className="text-xs text-slate-500">Gera primeiro o PDF acima; depois, na app de e-mail, anexa-o a partir de Transferências.</p>
      {ocupado && <Aviso tipo="ok">A gerar…</Aviso>}
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
    </>
  );
}
