import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { OfficeDB } from '../src/db/schema';
import {
  MODELO_HAVI_PADRAO, diaDeEntregaHavi, diaDeIso, guardarDestinatariosHavi, guardarModeloHavi, guardarRascunhoHavi, isoDia,
  lerDefinicoesHavi, montarEmailHavi, montarMailtoHavi, registarPedidoHavi
} from '../src/db/havi';
import { LIMITE_MAILTO } from '../src/db/emails';
import { exportarCopia, restaurarCopia } from '../src/backup/backup';

let db: OfficeDB;
let n = 0;
beforeEach(async () => { db = new OfficeDB(`havi-${++n}-${Date.now()}`); await db.open(); });

const linha = (i: number) => ({ codigo: `1032500${i % 10}`, nome: 'CHA CIDREIRA MC /melissa', quantidade: 6 });

describe('HAVI: texto do e-mail', () => {
  it('troca {{data}} e {{produtos}} no texto do utilizador', () => {
    const e = montarEmailHavi([linha(1)], new Date(2026, 10, 27), 'Olá,\nEntrega a {{data}}.\n{{produtos}}\nObrigado');
    expect(e.corpo).toContain('Entrega a 27 de novembro.');
    expect(e.corpo).toContain('10325001 --- 6 --- CHA CIDREIRA MC /melissa');
    expect(e.corpo.endsWith('Obrigado')).toBe(true);
    expect(e.assunto).toContain('sexta-feira');
  });
  it('sem {{produtos}} a lista vai no fim; texto vazio usa o padrão', () => {
    expect(montarEmailHavi([linha(1)], new Date(2026, 10, 27), 'Só isto.').corpo).toMatch(/^Só isto\.\n\nCódigo --- Qtd/);
    expect(montarEmailHavi([linha(1)], new Date(2026, 10, 27), '  ').corpo).toContain('Bom dia');
  });
  it('um pedido de 31 produtos passa o limite do mailto (por isso é copiado)', () => {
    const e = montarEmailHavi(Array.from({ length: 31 }, (_, i) => linha(i)), new Date(2026, 10, 27));
    expect(montarMailtoHavi(['x'], e.assunto, e.corpo).length).toBeGreaterThan(LIMITE_MAILTO);
    expect(montarMailtoHavi(['x'], e.assunto, '').length).toBeLessThan(LIMITE_MAILTO);
  });
  it('dias: lê AAAA-MM-DD como dia local e reconhece terça e sexta', () => {
    expect(isoDia(diaDeIso('2026-12-01')!)).toBe('2026-12-01');
    expect(diaDeIso('ontem')).toBeNull();
    expect(diaDeEntregaHavi(diaDeIso('2026-12-01')!)).toBe(true);
    expect(diaDeEntregaHavi(diaDeIso('2026-12-02')!)).toBe(false);
  });
});

describe('HAVI: definições e pedidos na base de dados', () => {
  it('sem nada guardado devolve o padrão', async () => {
    expect(await lerDefinicoesHavi(db)).toEqual({ destinatarios: [], modelo: MODELO_HAVI_PADRAO, rascunho: {} });
  });
  it('destinatários, texto e quantidades sobrevivem à cópia de segurança', async () => {
    await guardarDestinatariosHavi(db, ['um', 'dois']);
    await guardarModeloHavi(db, 'Texto meu {{produtos}}');
    await guardarRascunhoHavi(db, { a: 3, b: 0 });
    await registarPedidoHavi(db, '2026-11-27', [linha(1)]);
    const copia = await exportarCopia(db);
    const outra = new OfficeDB(`havi-restauro-${Date.now()}`); await outra.open();
    await restaurarCopia(outra, copia.blob);
    expect(await lerDefinicoesHavi(outra)).toEqual({ destinatarios: ['um', 'dois'], modelo: 'Texto meu {{produtos}}', rascunho: { a: 3 } });
    expect(await outra.pedidosHavi.count()).toBe(1);
  });
  it('preparar duas vezes o mesmo pedido não duplica; um pedido diferente fica registado', async () => {
    await registarPedidoHavi(db, '2026-11-27', [linha(1)]);
    await registarPedidoHavi(db, '2026-11-27', [linha(1)]);
    expect(await db.pedidosHavi.count()).toBe(1);
    await registarPedidoHavi(db, '2026-12-01', [linha(1)]);
    await registarPedidoHavi(db, '2026-12-01', []);
    expect(await db.pedidosHavi.count()).toBe(2);
  });
});
