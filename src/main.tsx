import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './ui/App';
import { aplicarTema, lerTema } from './ui/tema';

aplicarTema(lerTema());
// Dados antigos: artigos com o fornecedor só escrito passam a ligar-se a um fornecedor real.
void import('./db/schema').then(async ({ db }) => (await import('./db/stock')).migrarFornecedorTexto(db)).catch(() => undefined);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
