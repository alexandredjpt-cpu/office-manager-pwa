import { useCallback, useEffect, useRef, useState } from 'react';
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
import { ListaKits, FichaKit } from './Kits';
import { EcraPlantas } from './Planta';
import { Relatorios } from './Relatorios';
import { Agenda, FichaLembrete } from './Agenda';
import { Pesquisa } from './Pesquisa';
import { Modelos } from './Modelos';
import { FichaContacto, ListaContactos } from './Contactos';
import { FichaEncomenda, FichaFornecedor, ListaEncomendas, ListaFornecedores } from './Encomendas';
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
  const registo = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const { needRefresh: [atualizar], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, r) {
      registo.current = r;
      if (!r) return;
      // Uma PWA que volta do segundo plano não recarrega: procura-se versão nova ao voltar e de meia em meia hora.
      const procurar = () => r.update().catch(() => undefined);
      document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && procurar());
      setInterval(procurar, 30 * 60_000);
    }
  });
  const procurarAtualizacao = useCallback(async () => {
    try {
      await registo.current?.update();
    } catch {
      /* sem rede */
    }
  }, []);

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
    ecra = id ? <FichaLocal id={id} destaque={query.get('destaque')} /> : <ListaLocais />;
  } else if (secao === 'stock') {
    ecra = id ? <FichaArtigo id={id} /> : <EcraStock vista={query.get('ver') ?? ''} />;
  } else if (secao === 'anomalias') {
    ecra = id ? <FichaAnomalia id={id} local={query.get('local') ?? ''} equipamento={query.get('equip') ?? ''} inspecaoLinha={query.get('insp') ?? ''} titulo={query.get('titulo') ?? ''} /> : <ListaAnomalias />;
  } else if (secao === 'inspecoes') {
    ecra = id ? <FichaInspecao id={id} /> : <ListaInspecoes />;
  } else if (secao === 'agenda') {
    ecra = id ? <FichaLembrete id={id} /> : <Agenda />;
  } else if (secao === 'encomendas') {
    ecra = id ? <FichaEncomenda id={id} /> : <ListaEncomendas />;
  } else if (secao === 'fornecedores') {
    ecra = id ? <FichaFornecedor id={id} /> : <ListaFornecedores />;
  } else if (secao === 'contactos') {
    ecra = id ? <FichaContacto id={id} /> : <ListaContactos />;
  } else if (secao === 'plantas') {
    ecra = <EcraPlantas id={id} destaque={query.get('destaque')} />;
  } else if (secao === 'kits') {
    ecra = id ? <FichaKit id={id} /> : <ListaKits />;
  } else if (secao === 'modelos') {
    ecra = <Modelos />;
  } else if (secao === 'pesquisa') {
    ecra = <Pesquisa />;
  } else if (secao === 'relatorios') {
    ecra = <Relatorios />;
  } else if (secao === 'mais') {
    ecra = <Mais procurar={procurarAtualizacao} haNova={atualizar} aAtualizar={() => updateServiceWorker(true)} />;
  } else if (secao === 'copia') {
    ecra = <Copia />;
  } else {
    ecra = <Inicio persistente={persistente} />;
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col">
      <header className="sticky top-0 z-10 bg-teal-700 px-4 pb-3 pt-[max(env(safe-area-inset-top),12px)] text-white">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Office Manager</h1>
            <p className="text-xs text-teal-100">Pessoal · offline · sem servidor</p>
          </div>
          <button aria-label="Pesquisar" className="rounded-full bg-teal-600 px-4 py-2 text-sm" onClick={() => ir('/pesquisa')}>🔍</button>
        </div>
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
            const ativo = (secao ?? '') === chave || (chave === 'mais' && (secao === 'locais' || secao === 'copia' || secao === 'relatorios' || secao === 'inspecoes' || secao === 'agenda' || secao === 'encomendas' || secao === 'fornecedores' || secao === 'modelos' || secao === 'contactos' || secao === 'kits'));
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
