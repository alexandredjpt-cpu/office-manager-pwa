/**
 * Office Manager — servidor (Cloudflare Worker + D1).
 *
 * Guarda uma cópia do que o gestor publica e serve-a a quem tem convite. Só o gestor
 * escreve; quem é de consulta só lê, e isso é decidido aqui, não na app — esconder
 * botões no telemóvel não protege nada.
 */
import {
  VALIDADE_CONVITE_HORAS, conviteUtilizavel, desdeDe, gerarCodigo, gerarToken,
  normalizarCodigo, podeEscrever, resumo, validarEnvio, type Papel
} from './logica';

export interface Env {
  BD: D1Database;
  SEGREDO_ARRANQUE?: string;
  ORIGEM_PERMITIDA?: string;
}

interface Quem { utilizadorId: string; nome: string; papel: Papel; dispositivoId: string; ultimoAcesso: string | null }

const json = (dados: unknown, estado = 200, env?: Env) =>
  new Response(JSON.stringify(dados), { status: estado, headers: { 'content-type': 'application/json; charset=utf-8', ...cabecalhosCors(env) } });
const erro = (mensagem: string, estado: number, env?: Env) => json({ erro: mensagem }, estado, env);

function cabecalhosCors(env?: Env): Record<string, string> {
  return {
    'access-control-allow-origin': env?.ORIGEM_PERMITIDA ?? '*',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-max-age': '86400'
  };
}

const agora = () => new Date().toISOString();
const novoId = () => crypto.randomUUID();

/** Reserva um bloco do relógio do servidor, para cada registo ficar com o seu número. */
async function reservarSeq(bd: D1Database, quantos: number): Promise<number> {
  await bd.prepare("INSERT OR IGNORE INTO contador (nome, valor) VALUES ('seq', 0)").run();
  const r = await bd.prepare("UPDATE contador SET valor = valor + ? WHERE nome = 'seq' RETURNING valor").bind(quantos).first<{ valor: number }>();
  return (r?.valor ?? quantos) - quantos;
}

async function identificar(pedido: Request, env: Env): Promise<Quem | null> {
  const cabecalho = pedido.headers.get('authorization') ?? '';
  const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7).trim() : '';
  if (!token) return null;
  const linha = await env.BD.prepare(
    `SELECT d.id AS dispositivoId, d.ultimoAcesso, u.id AS utilizadorId, u.nome, u.papel
       FROM dispositivos d JOIN utilizadores u ON u.id = d.utilizadorId
      WHERE d.tokenHash = ? AND d.removidoEm IS NULL AND u.removidoEm IS NULL`
  ).bind(await resumo(token)).first<Quem>();
  if (!linha) return null;
  // A marca de último acesso só se grava uma vez por hora, para não gastar escritas à toa.
  const antiga = !linha.ultimoAcesso || Date.now() - new Date(linha.ultimoAcesso).getTime() > 3600_000;
  if (antiga) await env.BD.prepare('UPDATE dispositivos SET ultimoAcesso = ? WHERE id = ?').bind(agora(), linha.dispositivoId).run();
  return linha;
}

async function corpoJson(pedido: Request): Promise<unknown> {
  try { return await pedido.json(); } catch { return null; }
}

export default {
  async fetch(pedido: Request, env: Env): Promise<Response> {
    const url = new URL(pedido.url);
    const rota = url.pathname.replace(/\/+$/, '');
    const metodo = pedido.method;

    if (metodo === 'OPTIONS') return new Response(null, { status: 204, headers: cabecalhosCors(env) });

    // --- primeiro gestor: uma só vez, com o segredo, e só enquanto não houver ninguém ---
    if (metodo === 'POST' && rota === '/api/arranque') {
      const corpo = (await corpoJson(pedido)) as { segredo?: string; nome?: string; dispositivo?: string } | null;
      if (!env.SEGREDO_ARRANQUE || corpo?.segredo !== env.SEGREDO_ARRANQUE) return erro('Segredo inválido.', 403, env);
      const quantos = await env.BD.prepare('SELECT COUNT(*) AS n FROM utilizadores WHERE removidoEm IS NULL').first<{ n: number }>();
      if ((quantos?.n ?? 0) > 0) return erro('O arranque já foi feito.', 409, env);
      const token = gerarToken();
      const utilizadorId = novoId();
      await env.BD.batch([
        env.BD.prepare('INSERT INTO utilizadores (id, nome, papel, criadoEm) VALUES (?, ?, ?, ?)').bind(utilizadorId, corpo?.nome?.trim() || 'Gestor', 'gestor', agora()),
        env.BD.prepare('INSERT INTO dispositivos (id, utilizadorId, tokenHash, descricao, criadoEm) VALUES (?, ?, ?, ?, ?)')
          .bind(novoId(), utilizadorId, await resumo(token), corpo?.dispositivo?.slice(0, 80) ?? '', agora())
      ]);
      return json({ token, papel: 'gestor' }, 201, env);
    }

    // --- entrar com um convite ---
    if (metodo === 'POST' && rota === '/api/entrar') {
      const corpo = (await corpoJson(pedido)) as { codigo?: string; dispositivo?: string } | null;
      const codigo = normalizarCodigo(String(corpo?.codigo ?? ''));
      if (!codigo) return erro('Falta o código.', 400, env);
      const hash = await resumo(codigo);
      const convite = await env.BD.prepare('SELECT nome, papel, expiraEm, usadoEm FROM convites WHERE codigoHash = ?')
        .bind(hash).first<{ nome: string; papel: Papel; expiraEm: string; usadoEm: string | null }>();
      const pode = conviteUtilizavel(convite, new Date());
      if (!pode.ok) return erro(pode.erro, 403, env);
      const token = gerarToken();
      const utilizadorId = novoId();
      await env.BD.batch([
        env.BD.prepare('UPDATE convites SET usadoEm = ? WHERE codigoHash = ? AND usadoEm IS NULL').bind(agora(), hash),
        env.BD.prepare('INSERT INTO utilizadores (id, nome, papel, criadoEm) VALUES (?, ?, ?, ?)').bind(utilizadorId, convite!.nome, convite!.papel, agora()),
        env.BD.prepare('INSERT INTO dispositivos (id, utilizadorId, tokenHash, descricao, criadoEm) VALUES (?, ?, ?, ?, ?)')
          .bind(novoId(), utilizadorId, await resumo(token), String(corpo?.dispositivo ?? '').slice(0, 80), agora())
      ]);
      return json({ token, nome: convite!.nome, papel: convite!.papel }, 201, env);
    }

    // --- daqui para baixo é preciso estar identificado ---
    const quem = await identificar(pedido, env);
    if (!quem) return erro('Sem acesso. Pede um convite novo.', 401, env);

    if (metodo === 'GET' && rota === '/api/eu') return json({ nome: quem.nome, papel: quem.papel }, 200, env);

    if (metodo === 'GET' && rota === '/api/puxar') {
      const desde = desdeDe(url.searchParams.get('desde'));
      const limite = Math.min(Math.max(desdeDe(url.searchParams.get('limite')) || 500, 1), 1000);
      const { results } = await env.BD.prepare(
        'SELECT tabela, id, dados, atualizado, seq FROM registos WHERE seq > ? ORDER BY seq LIMIT ?'
      ).bind(desde, limite).all<{ tabela: string; id: string; dados: string; atualizado: string; seq: number }>();
      const registos = results.map((r) => ({ ...r, dados: JSON.parse(r.dados) as unknown }));
      return json({ registos, seq: registos.length ? registos[registos.length - 1].seq : desde, fim: registos.length < limite }, 200, env);
    }

    if (metodo === 'POST' && rota === '/api/enviar') {
      if (!podeEscrever(quem.papel)) return erro('Esta conta é só de consulta.', 403, env);
      const validado = validarEnvio(await corpoJson(pedido));
      if (!validado.ok) return erro(validado.erro, 400, env);
      const { registos } = validado;
      if (registos.length === 0) return json({ gravados: 0, seq: 0 }, 200, env);
      const base = await reservarSeq(env.BD, registos.length);
      await env.BD.batch(registos.map((r, i) => env.BD.prepare(
        `INSERT INTO registos (tabela, id, dados, atualizado, seq) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (tabela, id) DO UPDATE SET dados = excluded.dados, atualizado = excluded.atualizado, seq = excluded.seq
         WHERE excluded.atualizado > registos.atualizado`
      ).bind(r.tabela, r.id, JSON.stringify(r.dados ?? null), r.atualizado, base + i + 1)));
      return json({ gravados: registos.length, seq: base + registos.length }, 200, env);
    }

    // --- utilizadores e convites: só o gestor ---
    if (rota === '/api/convites' && metodo === 'POST') {
      if (!podeEscrever(quem.papel)) return erro('Esta conta é só de consulta.', 403, env);
      const corpo = (await corpoJson(pedido)) as { nome?: string; papel?: Papel } | null;
      const nome = String(corpo?.nome ?? '').trim();
      const papel: Papel = corpo?.papel === 'gestor' ? 'gestor' : 'consulta';
      if (!nome) return erro('Dá um nome a quem vais convidar.', 400, env);
      const codigo = gerarCodigo();
      const expiraEm = new Date(Date.now() + VALIDADE_CONVITE_HORAS * 3600_000).toISOString();
      await env.BD.prepare('INSERT INTO convites (codigoHash, nome, papel, criadoEm, expiraEm) VALUES (?, ?, ?, ?, ?)')
        .bind(await resumo(normalizarCodigo(codigo)), nome, papel, agora(), expiraEm).run();
      // O código só aparece aqui: no servidor fica apenas o resumo.
      return json({ codigo, nome, papel, expiraEm }, 201, env);
    }

    if (rota === '/api/utilizadores' && metodo === 'GET') {
      if (!podeEscrever(quem.papel)) return erro('Esta conta é só de consulta.', 403, env);
      const { results } = await env.BD.prepare(
        `SELECT u.id, u.nome, u.papel, u.criadoEm, MAX(d.ultimoAcesso) AS ultimoAcesso, COUNT(d.id) AS telemoveis
           FROM utilizadores u LEFT JOIN dispositivos d ON d.utilizadorId = u.id AND d.removidoEm IS NULL
          WHERE u.removidoEm IS NULL GROUP BY u.id ORDER BY u.criadoEm`
      ).all();
      return json({ utilizadores: results }, 200, env);
    }

    const removerUtilizador = rota.match(/^\/api\/utilizadores\/([0-9a-f-]{36})$/);
    if (removerUtilizador && metodo === 'DELETE') {
      if (!podeEscrever(quem.papel)) return erro('Esta conta é só de consulta.', 403, env);
      const id = removerUtilizador[1];
      if (id === quem.utilizadorId) return erro('Não te podes remover a ti próprio.', 400, env);
      await env.BD.batch([
        env.BD.prepare('UPDATE utilizadores SET removidoEm = ? WHERE id = ? AND removidoEm IS NULL').bind(agora(), id),
        env.BD.prepare('UPDATE dispositivos SET removidoEm = ? WHERE utilizadorId = ? AND removidoEm IS NULL').bind(agora(), id)
      ]);
      return json({ removido: id }, 200, env);
    }

    return erro('Não existe.', 404, env);
  }
} satisfies ExportedHandler<Env>;
