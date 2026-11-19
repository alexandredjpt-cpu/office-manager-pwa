import { useSyncExternalStore } from 'react';

const subscrever = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};
const lerHash = () => location.hash.slice(1) || '/';

export interface Rota {
  /** Segmentos do caminho: '/equipamentos/abc' → ['equipamentos', 'abc'] */
  partes: string[];
  query: URLSearchParams;
}

export function useRota(): Rota {
  const bruto = useSyncExternalStore(subscrever, lerHash, () => '/');
  const [caminho, q = ''] = bruto.split('?');
  return { partes: caminho.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(q) };
}

/** Navega e deixa entrada no histórico (o botão Voltar do Android regressa aqui). */
export const ir = (caminho: string) => {
  location.hash = caminho;
};

/** Navega sem deixar entrada no histórico (ex.: depois de guardar um formulário «novo»). */
export const substituir = (caminho: string) => {
  location.replace(`#${caminho}`);
};

export const voltar = (alternativa: string) => {
  if (history.length > 1) history.back();
  else substituir(alternativa);
};
