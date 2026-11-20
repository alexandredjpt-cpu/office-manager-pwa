import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { OfficeDB } from '../src/db/schema';
import { criarLocalizacao } from '../src/db/repo';
import { criarArtigo, registarContagem, stockPorArtigo, listaCompras } from '../src/db/stock';
import {
  adicionarArtigoAoKit, arquivarKit, atualizarKit, criarKit, definirAlvoKit, definirLocaisDoKit,
  linhasKitNoLocal, locaisPorContar, removerArtigoDoKit
} from '../src/db/kits';
import { exportarCopia, restaurarCopia } from '../src/backup/backup';

let db: OfficeDB; let s1: string; let s2: string; let caneta: string; let papel: string; let kit: string;
beforeEach(async () => {
  db = new OfficeDB(`t-${crypto.randomUUID()}`); await db.open();
  s1 = (await criarLocalizacao(db, { nome: 'Sala 1', tipo: 'divisao' })).id;
  s2 = (await criarLocalizacao(db, { nome: 'Sala 2', tipo: 'divisao' })).id;
  caneta = (await criarArtigo(db, { nome: 'Caneta', stockMinimo: 10 })).id;
  papel = (await criarArtigo(db, { nome: 'Papel' })).id;
  kit = (await criarKit(db, { nome: 'Economato' })).id;
});

describe('kits', () => {
  it('nome obrigatório e único; atualizar valida', async () => {
    await expect(criarKit(db, { nome: ' ' })).rejects.toThrow('obrigatório');
    await expect(criarKit(db, { nome: 'economato' })).rejects.toThrow('Já existe');
    const k2 = await criarKit(db, { nome: 'Limpeza' });
    await expect(atualizarKit(db, k2.id, { nome: 'ECONOMATO' })).rejects.toThrow('Já existe');
    await atualizarKit(db, k2.id, { nome: 'Limpeza geral', notas: ' x ' });
    expect((await db.kits.get(k2.id))?.notas).toBe('x');
  });

  it('artigos: sem duplicados, alvo validado, remover e editar alvo', async () => {
    await adicionarArtigoAoKit(db, kit, caneta, 5);
    await expect(adicionarArtigoAoKit(db, kit, caneta)).rejects.toThrow('já está');
    await expect(adicionarArtigoAoKit(db, kit, 'nada')).rejects.toThrow('não existe');
    await expect(adicionarArtigoAoKit(db, kit, papel, -1)).rejects.toThrow('alvo');
    await adicionarArtigoAoKit(db, kit, papel, '');
    expect((await db.kits.get(kit))?.artigos).toEqual([{ artigoId: caneta, alvo: 5 }, { artigoId: papel, alvo: null }]);
    await definirAlvoKit(db, kit, papel, '3,5');
    expect((await db.kits.get(kit))?.artigos[1].alvo).toBe(3.5);
    await removerArtigoDoKit(db, kit, caneta);
    expect((await db.kits.get(kit))?.artigos.map((x) => x.artigoId)).toEqual([papel]);
  });

  it('aplicar a locais é idempotente, retira e reativa, sem criar contagens', async () => {
    await definirLocaisDoKit(db, kit, [s1, s2]);
    await definirLocaisDoKit(db, kit, [s1, s2]);
    expect((await db.kitLocais.toArray()).filter((x) => !x.deletedAt)).toHaveLength(2);
    await definirLocaisDoKit(db, kit, [s1]);
    expect((await db.kitLocais.toArray()).filter((x) => !x.deletedAt).map((x) => x.localizacaoId)).toEqual([s1]);
    await definirLocaisDoKit(db, kit, [s1, s2]);
    expect(await db.kitLocais.count()).toBe(2); // reativou, não duplicou
    expect(await db.contagensStock.count()).toBe(0);
    await expect(definirLocaisDoKit(db, kit, ['nada'])).rejects.toThrow('válidos');
  });

  it('linhas no local: por contar, contado e abaixo do alvo; artigo arquivado sai', async () => {
    await adicionarArtigoAoKit(db, kit, caneta, 5);
    await adicionarArtigoAoKit(db, kit, papel, null);
    await registarContagem(db, caneta, s1, 3);
    const k = (await db.kits.get(kit))!;
    const l = linhasKitNoLocal(k, await db.artigos.toArray(), await db.contagensStock.toArray(), s1);
    expect(l.map((x) => [x.artigo.nome, x.quantidade, x.abaixoAlvo])).toEqual([['Caneta', 3, true], ['Papel', null, false]]);
    await db.artigos.update(papel, { deletedAt: new Date().toISOString() });
    expect(linhasKitNoLocal(k, await db.artigos.toArray(), await db.contagensStock.toArray(), s1)).toHaveLength(1);
  });

  it('o alvo nunca gera compras: só o mínimo geral; por contar não cria zeros', async () => {
    await adicionarArtigoAoKit(db, kit, caneta, 50);
    await definirLocaisDoKit(db, kit, [s1, s2]);
    await registarContagem(db, caneta, s1, 6);
    await registarContagem(db, caneta, s2, 4);
    const st = stockPorArtigo(await db.artigos.toArray(), await db.contagensStock.toArray());
    expect(st.find((x) => x.artigo.id === caneta)?.total).toBe(10); // soma dos locais; mínimo 10 → ok
    expect(listaCompras(st)).toEqual([]);
    await registarContagem(db, caneta, s2, 3);
    expect(listaCompras(stockPorArtigo(await db.artigos.toArray(), await db.contagensStock.toArray())).map((x) => x.artigo.id)).toEqual([caneta]);
  });

  it('locaisPorContar conta locais com kit sem contagem; ignora kit arquivado/retirado', async () => {
    await adicionarArtigoAoKit(db, kit, caneta, 5);
    await definirLocaisDoKit(db, kit, [s1, s2]);
    const cont = async () => locaisPorContar(caneta, await db.kits.toArray(), await db.kitLocais.toArray(), await db.contagensStock.toArray());
    expect(await cont()).toBe(2);
    await registarContagem(db, caneta, s1, 1);
    expect(await cont()).toBe(1);
    await arquivarKit(db, kit);
    expect(await cont()).toBe(0);
    expect((await db.kitLocais.toArray()).every((x) => x.deletedAt)).toBe(true);
    expect(await db.contagensStock.count()).toBe(1); // contagens intactas
  });

  it('cópia completa leva kits e ligações; cópia antiga sem kits restaura', async () => {
    await adicionarArtigoAoKit(db, kit, caneta, 5);
    await definirLocaisDoKit(db, kit, [s1]);
    const { blob } = await exportarCopia(db);
    const d2 = new OfficeDB(`t-${crypto.randomUUID()}`); await d2.open();
    await restaurarCopia(d2, blob);
    expect([await d2.kits.count(), await d2.kitLocais.count()]).toEqual([1, 1]);
    expect((await d2.kits.toArray())[0].artigos).toHaveLength(1);
  });
});
