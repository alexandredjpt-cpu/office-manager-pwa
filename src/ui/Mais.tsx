import { useState } from 'react';
import { db } from '../db/schema';
import { ROTULO_PAPEL, guardarPapel, type Papel } from '../db/papel';
import { usePapel } from './comuns';
import { ir } from './router';

/**
 * Enquanto não há servidor, o papel é escolhido aqui para se poder preparar e experimentar
 * o modo de consulta. Quando o servidor existir, passa a vir de lá e esta caixa desaparece.
 */
function EscolherPapel() {
  const papel = usePapel();
  return (
    <div className="cartao space-y-2">
      <p className="font-semibold">Papel</p>
      <div className="grid grid-cols-2 gap-2">
        {(['gestor', 'consulta'] as Papel[]).map((p) => (
          <button key={p} className={papel === p ? 'btn-primario' : 'btn-secundario'} onClick={() => void guardarPapel(db, p)}>{ROTULO_PAPEL[p]}</button>
        ))}
      </div>
      <p className="text-xs text-slate-500">«Só consulta» impede criar, alterar e apagar. Não protege os dados.</p>
    </div>
  );
}

export function Mais({ procurar, haNova, aAtualizar }: { procurar: () => Promise<void>; haNova: boolean; aAtualizar: () => void }) {
  const [estado, setEstado] = useState<'' | 'a procurar' | 'sem nova'>('');

  async function verificar() {
    setEstado('a procurar');
    await procurar();
    // O service worker novo demora uns segundos a descarregar.
    setTimeout(() => setEstado('sem nova'), 4000);
  }

  const Atalho = ({ rota, titulo }: { rota: string; titulo: string }) => (
    <button className="cartao w-full text-left active:bg-slate-50" onClick={() => ir(rota)}>
      <p className="font-semibold">{titulo}</p>
    </button>
  );

  return (
    <>
      <h2 className="text-xl font-semibold">Mais</h2>

      <p className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Dia a dia</p>
      <Atalho rota="/encomendas" titulo="Encomendas e fornecedores" />
      <Atalho rota="/agenda" titulo="Agenda e lembretes" />
      <Atalho rota="/inspecoes" titulo="Inspeções" />
      <Atalho rota="/relatorios" titulo="Relatórios (PDF e Excel)" />

      <p className="px-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Organizar</p>
      <Atalho rota="/locais" titulo="Locais" />
      <Atalho rota="/kits" titulo="Kits (listas-modelo)" />
      <Atalho rota="/contactos" titulo="Contactos" />
      <Atalho rota="/modelos" titulo="Modelos de mensagem" />
      <Atalho rota="/emails" titulo="E-mails preparados" />

      <p className="px-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Ajustes</p>
      <EscolherPapel />
      <Atalho rota="/aparencia" titulo="Aparência" />
      <Atalho rota="/copia" titulo="Cópia de segurança" />

      <div className="cartao space-y-3">
        <p className="font-semibold">Versão da app</p>
        <p className="text-sm text-slate-600">Compilada em {__VERSAO__} (UTC).</p>
        {haNova ? (
          <button className="btn-primario w-full" onClick={aAtualizar}>Há versão nova: Atualizar</button>
        ) : (
          <button className="btn-secundario w-full" disabled={estado === 'a procurar'} onClick={verificar}>
            {estado === 'a procurar' ? 'A procurar…' : 'Procurar atualização'}
          </button>
        )}
        {estado === 'sem nova' && !haNova && <p className="text-sm text-slate-600">Já tens a versão mais recente.</p>}
      </div>
    </>
  );
}
