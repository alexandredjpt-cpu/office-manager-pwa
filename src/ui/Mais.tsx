import { useState } from 'react';
import { ir } from './router';

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
      <Atalho rota="/servidor" titulo="Servidor e equipa (sincronização e papel)" />
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
