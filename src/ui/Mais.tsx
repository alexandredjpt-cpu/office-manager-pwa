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

  return (
    <>
      <h2 className="text-xl font-semibold">Mais</h2>
      <button className="cartao w-full text-left active:bg-slate-50" onClick={() => ir('/encomendas')}>
        <p className="font-semibold">Encomendas e fornecedores</p>
        <p className="text-sm text-slate-500">Registo de encomendas e receções. A app nunca envia nada.</p>
      </button>
      <button className="cartao w-full text-left active:bg-slate-50" onClick={() => ir('/contactos')}>
        <p className="font-semibold">Contactos</p>
        <p className="text-sm text-slate-500">Aprovadores e outras pessoas a quem escreves.</p>
      </button>
      <button className="cartao w-full text-left active:bg-slate-50" onClick={() => ir('/kits')}>
        <p className="font-semibold">Kits (listas-modelo)</p>
        <p className="text-sm text-slate-500">Ex.: Economato. Define a lista uma vez e aplica a vários locais.</p>
      </button>
      <button className="cartao w-full text-left active:bg-slate-50" onClick={() => ir('/aparencia')}>
        <p className="font-semibold">Aparência</p>
        <p className="text-sm text-slate-500">Modo escuro, cores da app e dos PDFs (só neste telemóvel).</p>
      </button>
      <button className="cartao w-full text-left active:bg-slate-50" onClick={() => ir('/emails')}>
        <p className="font-semibold">E-mails preparados</p>
        <p className="text-sm text-slate-500">Histórico do que preparaste para enviar (e-mail e WhatsApp).</p>
      </button>
      <button className="cartao w-full text-left active:bg-slate-50" onClick={() => ir('/agenda')}>
        <p className="font-semibold">Agenda e lembretes</p>
        <p className="text-sm text-slate-500">Garantias, lembretes e datas importantes.</p>
      </button>
      <button className="cartao w-full text-left active:bg-slate-50" onClick={() => ir('/locais')}>
        <p className="font-semibold">Locais</p>
        <p className="text-sm text-slate-500">Divisões, arrumos e outros sítios.</p>
      </button>
      <button className="cartao w-full text-left active:bg-slate-50" onClick={() => ir('/inspecoes')}>
        <p className="font-semibold">Inspeções</p>
        <p className="text-sm text-slate-500">Verificar os equipamentos de um local.</p>
      </button>
      <button className="cartao w-full text-left active:bg-slate-50" onClick={() => ir('/relatorios')}>
        <p className="font-semibold">Relatórios (PDF)</p>
        <p className="text-sm text-slate-500">Anomalias, inventário e necessidades de compra.</p>
      </button>
      <button className="cartao w-full text-left active:bg-slate-50" onClick={() => ir('/copia')}>
        <p className="font-semibold">Cópia de segurança</p>
        <p className="text-sm text-slate-500">Guardar e restaurar todos os dados.</p>
      </button>

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
