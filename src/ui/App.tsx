import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { pedirPersistencia } from '../backup/partilha';
import { ir, useRota } from './router';
import { Inicio } from './Inicio';
import { Mais } from './Mais';
import { ErroGeral } from './ErroGeral';

/**
 * Carrega um ecrã só quando é aberto. Se a app foi atualizada entretanto e a parte antiga já não existe,
 * recarrega uma vez (em vez de mostrar erro).
 */
function ecraLazy<M, P extends object>(importar: () => Promise<M>, escolher: (m: M) => React.ComponentType<P>) {
  return lazy(async () => {
    try {
      const m = await importar();
      sessionStorage.removeItem('om.recarregou');
      return { default: escolher(m) };
    } catch (e) {
      if (!sessionStorage.getItem('om.recarregou')) { sessionStorage.setItem('om.recarregou', '1'); window.location.reload(); }
      throw e;
    }
  });
}

// Cada ecrã é carregado só quando é aberto (arranque mais rápido); offline continua tudo em cache.
const Copia = ecraLazy(() => import('./Copia'), (m) => m.Copia);
const ListaEquipamentos = ecraLazy(() => import('./Equipamentos'), (m) => m.ListaEquipamentos);
const FichaEquipamento = ecraLazy(() => import('./Equipamentos'), (m) => m.FichaEquipamento);
const ListaLocais = ecraLazy(() => import('./Locais'), (m) => m.ListaLocais);
const FichaLocal = ecraLazy(() => import('./Locais'), (m) => m.FichaLocal);
const EcraStock = ecraLazy(() => import('./Stock'), (m) => m.EcraStock);
const FichaArtigo = ecraLazy(() => import('./Stock'), (m) => m.FichaArtigo);
const FichaAnomalia = ecraLazy(() => import('./Anomalias'), (m) => m.FichaAnomalia);
const ListaAnomalias = ecraLazy(() => import('./Anomalias'), (m) => m.ListaAnomalias);
const ListaKits = ecraLazy(() => import('./Kits'), (m) => m.ListaKits);
const FichaKit = ecraLazy(() => import('./Kits'), (m) => m.FichaKit);
const EcraPlantas = ecraLazy(() => import('./Planta'), (m) => m.EcraPlantas);
const EmailsPreparados = ecraLazy(() => import('./EmailsPreparados'), (m) => m.EmailsPreparados);
const Aparencia = ecraLazy(() => import('./Aparencia'), (m) => m.Aparencia);
const Relatorios = ecraLazy(() => import('./Relatorios'), (m) => m.Relatorios);
const Agenda = ecraLazy(() => import('./Agenda'), (m) => m.Agenda);
const FichaLembrete = ecraLazy(() => import('./Agenda'), (m) => m.FichaLembrete);
const Pesquisa = ecraLazy(() => import('./Pesquisa'), (m) => m.Pesquisa);
const Modelos = ecraLazy(() => import('./Modelos'), (m) => m.Modelos);
const Havi = ecraLazy(() => import('./Havi'), (m) => m.Havi);
const FichaContacto = ecraLazy(() => import('./Contactos'), (m) => m.FichaContacto);
const ListaContactos = ecraLazy(() => import('./Contactos'), (m) => m.ListaContactos);
const FichaEncomenda = ecraLazy(() => import('./Encomendas'), (m) => m.FichaEncomenda);
const FichaFornecedor = ecraLazy(() => import('./Encomendas'), (m) => m.FichaFornecedor);
const ListaEncomendas = ecraLazy(() => import('./Encomendas'), (m) => m.ListaEncomendas);
const ListaFornecedores = ecraLazy(() => import('./Encomendas'), (m) => m.ListaFornecedores);
const FichaInspecao = ecraLazy(() => import('./Inspecoes'), (m) => m.FichaInspecao);
const ListaInspecoes = ecraLazy(() => import('./Inspecoes'), (m) => m.ListaInspecoes);

const SEPARADORES = [
  ['', 'Início', '/'],
  ['equipamentos', 'Equipamentos', '/equipamentos'],
  ['stock', 'Stock', '/stock'],
  ['anomalias', 'Anomalias', '/anomalias'],
  ['mais', 'Mais', '/mais']
] as const;

function pontoDe(q: URLSearchParams) {
  const documentoId = q.get('planta'); const x = Number(q.get('x')); const y = Number(q.get('y'));
  return documentoId && q.get('x') !== null && q.get('y') !== null && Number.isFinite(x) && Number.isFinite(y) ? { documentoId, x, y } : null;
}

/** O que cada ecrã recebe: o id do caminho, os parâmetros e o estado da app (só o Início e o Mais o usam). */
interface Ctx {
  id: string | undefined;
  q: URLSearchParams;
  app: { persistente: boolean | null; procurar: () => Promise<void>; haNova: boolean; aAtualizar: () => void };
}
type Separador = (typeof SEPARADORES)[number][0];
interface Rota { ecra: (c: Ctx) => React.ReactNode; separador?: Separador }

const p = (q: URLSearchParams, k: string) => q.get(k) ?? '';

/**
 * Mapa de secções: `#/<secção>/<id>?…` → ecrã. Uma secção nova é uma linha aqui.
 * `separador` diz que botão da barra de baixo fica aceso (sem ele, nenhum).
 */
const ROTAS: Record<string, Rota> = {
  equipamentos: { separador: 'equipamentos', ecra: ({ id, q }) => (id ? <FichaEquipamento id={id} localizacaoInicial={p(q, 'local')} copiarDe={p(q, 'copiar')} aba={p(q, 'aba')} /> : <ListaEquipamentos />) },
  stock: { separador: 'stock', ecra: ({ id, q }) => (id ? <FichaArtigo id={id} codigoInicial={p(q, 'codigo')} contar={q.get('contar') === '1'} /> : <EcraStock vista={p(q, 'ver')} />) },
  anomalias: {
    separador: 'anomalias',
    ecra: ({ id, q }) => (id
      ? <FichaAnomalia id={id} local={p(q, 'local')} equipamento={p(q, 'equip')} inspecaoLinha={p(q, 'insp')} titulo={p(q, 'titulo')} descricao={p(q, 'descricao')} nota={p(q, 'nota')} partilha={q.get('partilha') === '1'} ponto={pontoDe(q)} />
      : <ListaAnomalias />)
  },
  locais: { separador: 'mais', ecra: ({ id, q }) => (id ? <FichaLocal id={id} destaque={q.get('destaque')} /> : <ListaLocais />) },
  inspecoes: { separador: 'mais', ecra: ({ id, q }) => (id ? <FichaInspecao id={id} rapida={q.get('rapida') === '1'} /> : <ListaInspecoes />) },
  agenda: { separador: 'mais', ecra: ({ id, q }) => (id ? <FichaLembrete id={id} dataInicial={p(q, 'data')} titulo={p(q, 'titulo')} notas={p(q, 'descricao')} nota={p(q, 'nota')} /> : <Agenda />) },
  encomendas: { separador: 'mais', ecra: ({ id, q }) => (id ? <FichaEncomenda id={id} /> : <ListaEncomendas anomalia={q.get('anomalia')} />) },
  fornecedores: { separador: 'mais', ecra: ({ id }) => (id ? <FichaFornecedor id={id} /> : <ListaFornecedores />) },
  contactos: { separador: 'mais', ecra: ({ id }) => (id ? <FichaContacto id={id} /> : <ListaContactos />) },
  kits: { separador: 'mais', ecra: ({ id }) => (id ? <FichaKit id={id} /> : <ListaKits />) },
  aparencia: { separador: 'mais', ecra: () => <Aparencia /> },
  emails: { separador: 'mais', ecra: () => <EmailsPreparados /> },
  modelos: { separador: 'mais', ecra: () => <Modelos /> },
  havi: { separador: 'mais', ecra: () => <Havi /> },
  relatorios: { separador: 'mais', ecra: () => <Relatorios /> },
  copia: { separador: 'mais', ecra: () => <Copia /> },
  mais: { separador: 'mais', ecra: ({ app }) => <Mais procurar={app.procurar} haNova={app.haNova} aAtualizar={app.aAtualizar} /> },
  plantas: { ecra: ({ id, q }) => <EcraPlantas id={id} destaque={q.get('destaque')} /> },
  pesquisa: { ecra: () => <Pesquisa /> }
};
/** Qualquer caminho desconhecido (ou vazio) mostra o Início. */
const INICIO: Rota = { separador: '', ecra: ({ app }) => <Inicio persistente={app.persistente} /> };
export const rotaDe = (secao: string | undefined): Rota => (secao && Object.hasOwn(ROTAS, secao) ? ROTAS[secao] : INICIO);

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
  const rota = rotaDe(secao);
  const ecra = rota.ecra({ id, q: query, app: { persistente, procurar: procurarAtualizacao, haNova: atualizar, aAtualizar: () => updateServiceWorker(true) } });

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col">
      <header className="sticky top-0 z-10 bg-teal-700 px-4 pb-3 pt-[max(env(safe-area-inset-top),12px)] text-white" style={{ borderBottom: '4px solid var(--cor-destaque, transparent)' }}>
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

      <main className="flex-1 space-y-4 p-4 pb-28"><ErroGeral chave={`${secao ?? ''}/${id ?? ''}`}><Suspense fallback={<p className="py-8 text-center text-sm text-slate-400">A abrir…</p>}>{ecra}</Suspense></ErroGeral></main>

      <nav className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto grid max-w-xl grid-cols-5">
          {SEPARADORES.map(([chave, texto, caminho]) => {
            const ativo = rota.separador === chave;
            return (
              <button
                key={chave}
                onClick={() => ir(caminho)}
                className={`py-4 text-xs font-medium ${ativo ? 'text-teal-700' : 'text-slate-500'}`}
                style={ativo ? { boxShadow: 'inset 0 3px 0 var(--cor-destaque, transparent)' } : undefined}
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
