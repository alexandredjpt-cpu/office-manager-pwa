import { useState } from 'react';
import { TEMA_ORIGINAL, contraste, guardarModo, guardarTema, hexValido, lerModo, lerTema, reporTema, type ModoCor } from './tema';
import { voltar } from './router';
import { Aviso, Campo } from './comuns';

function CampoCor({ rotulo, valor, aoMudar, dica, opcional = false }: { rotulo: string; valor: string; aoMudar: (v: string) => void; dica: string; opcional?: boolean }) {
  return (
    <Campo rotulo={rotulo} dica={dica}>
      <div className="flex items-center gap-2">
        <input type="color" aria-label={`${rotulo} (seletor)`} className="h-12 w-14 shrink-0 rounded-lg border border-slate-300" value={hexValido(valor) ? valor : '#ffffff'} onChange={(e) => aoMudar(e.target.value)} />
        <input className="campo" aria-label={rotulo} value={valor} onChange={(e) => aoMudar(e.target.value)} placeholder={opcional ? 'Sem destaque' : '#RRGGBB'} autoComplete="off" autoCapitalize="off" />
        {opcional && valor && <button className="btn-secundario px-3" onClick={() => aoMudar('')}>Tirar</button>}
      </div>
    </Campo>
  );
}

const OPCOES_MODO: [ModoCor, string][] = [['claro', '☀️ Claro'], ['escuro', '🌙 Escuro'], ['auto', 'Automático']];

function EscolherModo() {
  const [modo, setModo] = useState<ModoCor>(lerModo());
  return (
    <div className="cartao space-y-2">
      <p className="font-semibold">Modo</p>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Modo claro ou escuro">
        {OPCOES_MODO.map(([m, texto]) => (
          <button key={m} role="radio" aria-checked={modo === m} className={modo === m ? 'btn-primario px-2' : 'btn-secundario px-2'} onClick={() => { guardarModo(m); setModo(m); }}>{texto}</button>
        ))}
      </div>
      <p className="text-xs text-slate-500">Automático segue o modo do telemóvel. Os PDFs saem sempre em fundo branco.</p>
    </div>
  );
}

export function Aparencia() {
  const [t, setT] = useState(lerTema());
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const principalOk = hexValido(t.principal);
  const legivel = principalOk && contraste(t.principal, '#ffffff') >= 3;

  return (
    <>
      <button className="text-sm text-teal-700" onClick={() => voltar('/mais')}>← Mais</button>
      <h2 className="text-xl font-semibold">Aparência</h2>
      <EscolherModo />
      <p className="text-xs text-slate-500">As cores ficam guardadas só neste telemóvel; o código público da app não muda. Aplicam-se ao cabeçalho, botões, destaques e aos PDFs.</p>
      <div className="cartao space-y-3">
        <CampoCor rotulo="Cor principal" valor={t.principal} aoMudar={(v) => setT({ ...t, principal: v })} dica="Cabeçalho, botões e títulos. Leva texto branco por cima, por isso tem de ser escura o suficiente." />
        <CampoCor rotulo="Cor de destaque" valor={t.destaque} aoMudar={(v) => setT({ ...t, destaque: v })} dica="Faixa por baixo do cabeçalho e marca do separador ativo. Opcional." opcional />
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <div className="px-4 py-3 text-white" style={{ background: principalOk ? t.principal : '#94a3b8', borderBottom: `4px solid ${hexValido(t.destaque) ? t.destaque : 'transparent'}` }}>
            <p className="font-semibold">Pré-visualização</p>
            <p className="text-xs opacity-80">Assim fica o cabeçalho</p>
          </div>
          <div className="flex gap-2 p-3">
            <span className="rounded-xl px-4 py-2 text-sm font-medium text-white" style={{ background: principalOk ? t.principal : '#94a3b8' }}>Botão</span>
            {hexValido(t.destaque) && <span className="rounded-full px-3 py-2 text-sm font-medium" style={{ background: t.destaque, color: '#0f172a' }}>Destaque</span>}
          </div>
        </div>
        {principalOk && !legivel && <Aviso tipo="erro">Esta cor principal é demasiado clara: o texto branco não se lê. Usa-a como destaque.</Aviso>}
        <button className="btn-primario w-full" disabled={!legivel} onClick={() => { try { setT(guardarTema(t)); setMsg({ tipo: 'ok', texto: 'Cores aplicadas.' }); } catch (e) { setMsg({ tipo: 'erro', texto: (e as Error).message }); } }}>Aplicar</button>
        <button className="btn-secundario w-full" onClick={() => { reporTema(); setT(TEMA_ORIGINAL); setMsg({ tipo: 'ok', texto: 'Cores originais repostas.' }); }}>Repor cores originais</button>
      </div>
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
    </>
  );
}
