import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { pedirPersistencia } from '../backup/partilha';
import { ir, useRota } from './router';
import { Inicio } from './Inicio';
import { Copia } from './Copia';
import { ListaEquipamentos, FichaEquipamento } from './Equipamentos';
import { ListaLocais, FichaLocal } from './Locais';
import { EcraStock, FichaArtigo } from './Stock';
import { FichaAnomalia, ListaAnomalias } from './Anomalias';
import { Mais } from './Mais';
import { Relatorios } from './Relatorios';
import { FichaInspecao, ListaInspecoes } from './Inspecoes';

const SEPARADORES = [
  ['', 'Início', '/'],
  ['equipamentos', 'Equipamentos', '/equipamentos'],
  ['stock', 'Stock', '/stock'],
  ['anomalias', 'Anomalias', '/anomalias'],
  ['mais', 'Mais', '/mais']
] as const;

export function App() {
  const { partes, query } = useRota();
  const [persistente, setPersistente] = useState<boolean | null>(null);
  const { needRefresh: [atualizar], updateServiceWorker } = useRegisterSW();

  useEffect(() => {
    pedirPersistencia().then(setPersistente).catch(() => setPersistente(null));
  }, []);

  // Cada mudança de ecrã começa no topo
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [partes.join('/')]);

  const [secao, id] = partes;
  let ecra;
  if (secao === 'equipamentos') {
    ecra = id ? <FichaEquipamento id={id} localizacaoInicial={query.get('local') ?? ''} /> : <ListaEquipamentos />;
  } else if (secao === 'locais') {
    ecra = id ? <FichaLocal id={id} /> : <ListaLocais />;
  } else if (secao === 'stock') {
    ecra = id ? <FichaArtigo id={id} /> : <EcraStock vista={query.get('ver') ?? ''} />;
  } else if (secao === 'anomalias') {
    ecra = id ? <FichaAnomalia id={id} local={query.get('local') ?? ''} equipamento={query.get('equip') ?? ''} inspecaoLinha={query.get('insp') ?? ''} /> : <ListaAnomalias />;
  } else if (secao === 'inspecoes') {
    ecra = id ? <FichaInspecao id={id} /> : <ListaInspecoes />;
  } else if (secao === 'relatorios') {
    ecra = <Relatorios />;
  } else if (secao === 'mais') {
    ecra = <Mais />;
  } else if (secao === 'copia') {
    ecra = <Copia />;
  } else {
    ecra = <Inicio persistente={persistente} />;
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col">
      <header className="sticky top-0 z-10 bg-teal-700 px-4 pb-3 pt-[max(env(safe-area-inset-top),12px)] text-white">
        <h1 className="text-lg font-semibold">Office Manager</h1>
        <p className="text-xs text-teal-100">Pessoal · offline · sem servidor</p>
      </header>

      {atualizar && (
        <div className="m-4 flex items-center justify-between gap-3 rounded-xl bg-amber-100 p-3 text-sm">
          Nova versão disponível.
          <button className="btn-primario py-2" onClick={() => updateServiceWorker(true)}>Atualizar</button>
        </div>
      )}

      <main className="flex-1 space-y-4 p-4 pb-28">{ecra}</main>

      <nav className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto grid max-w-xl grid-cols-5">
          {SEPARADORES.map(([chave, texto, caminho]) => {
            const ativo = (secao ?? '') === chave || (chave === 'mais' && (secao === 'locais' || secao === 'copia' || secao === 'relatorios' || secao === 'inspecoes'));
            return (
              <button
                key={chave}
                onClick={() => ir(caminho)}
                className={`py-4 text-xs font-medium ${ativo ? 'text-teal-700' : 'text-slate-500'}`}
                aria-current={ativo ? 'page' : undefined}
              >
                {texto}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
