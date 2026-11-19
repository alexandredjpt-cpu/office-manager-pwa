import { ir } from './router';

export function Mais() {
  return (
    <>
      <h2 className="text-xl font-semibold">Mais</h2>
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
    </>
  );
}
