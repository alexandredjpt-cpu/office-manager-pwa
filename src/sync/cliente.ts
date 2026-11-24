import type { Papel } from '../db/papel';

/** Endereço do servidor (Worker). Só a app fala com ele; os dados nunca passam por outro sítio. */
export const URL_SERVIDOR = 'https://office-manager-servidor.mcdapppt.workers.dev';

export class ErroServidor extends Error {
  constructor(readonly estado: number, mensagem: string) {
    super(mensagem);
  }
}

/** Chamada ao servidor. Erros vêm com a mensagem que o servidor escreveu para a pessoa. */
export async function pedir<T>(metodo: string, caminho: string, opcoes: { token?: string; corpo?: unknown } = {}): Promise<T> {
  const r = await fetch(`${URL_SERVIDOR}${caminho}`, {
    method: metodo,
    headers: {
      ...(opcoes.token ? { authorization: `Bearer ${opcoes.token}` } : {}),
      ...(opcoes.corpo !== undefined ? { 'content-type': 'application/json' } : {})
    },
    body: opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo),
    cache: 'no-store'
  });
  const dados = (await r.json().catch(() => ({}))) as { erro?: string } & Record<string, unknown>;
  if (!r.ok) throw new ErroServidor(r.status, dados.erro ?? `O servidor respondeu com ${r.status}.`);
  return dados as T;
}

export interface VersaoServidor { dados: unknown; atualizado: string; seq: number }
export interface RegistoServidor extends VersaoServidor { tabela: string; id: string }
export interface RegistoEnvio { tabela: string; id: string; dados: unknown; atualizado: string; base: number | null }
export interface RespostaEnvio { gravados: number; seq: number; conflitos: { tabela: string; id: string; atual: VersaoServidor | null }[] }
export interface Convite { codigo: string; nome: string; papel: Papel; expiraEm: string }
export interface Pessoa { id: string; nome: string; papel: Papel; criadoEm: string; ultimoAcesso: string | null; telemoveis: number }

export const entrarComCodigo = (codigo: string, dispositivo: string) =>
  pedir<{ token: string; nome: string; papel: Papel }>('POST', '/api/entrar', { corpo: { codigo, dispositivo } });

export const eu = (token: string) => pedir<{ nome: string; papel: Papel }>('GET', '/api/eu', { token });

export const puxar = (token: string, desde: number) =>
  pedir<{ registos: RegistoServidor[]; seq: number; fim: boolean }>('GET', `/api/puxar?desde=${desde}`, { token });

export const enviar = (token: string, registos: RegistoEnvio[]) =>
  pedir<RespostaEnvio>('POST', '/api/enviar', { token, corpo: registos });

export const criarConvite = (token: string, nome: string, papel: Papel) =>
  pedir<Convite>('POST', '/api/convites', { token, corpo: { nome, papel } });

export const listarPessoas = (token: string) =>
  pedir<{ utilizadores: Pessoa[] }>('GET', '/api/utilizadores', { token });

export const mudarPapel = (token: string, id: string, papel: Papel) =>
  pedir<{ id: string; papel: Papel }>('PATCH', `/api/utilizadores/${id}`, { token, corpo: { papel } });

export const cortarAcesso = (token: string, id: string) =>
  pedir<{ removido: string }>('DELETE', `/api/utilizadores/${id}`, { token });
