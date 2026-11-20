import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { OfficeDB, TABELAS } from '../src/db/schema';
import { criarEquipamento, criarLocalizacao } from '../src/db/repo';
import { criarArtigo } from '../src/db/stock';
import { criarKit } from '../src/db/kits';
import { apagarTudo } from '../src/db/exemplo';

describe('começar do zero', () => {
  it('exige APAGAR, apaga tudo menos meta e reinicia os códigos', async () => {
    const db = new OfficeDB(`t-${crypto.randomUUID()}`); await db.open();
    const loc = await criarLocalizacao(db, { nome: 'Sala real', tipo: 'divisao' });
    await criarEquipamento(db, { nome: 'Router real', localizacaoId: loc.id });
    await criarArtigo(db, { nome: 'Papel real' });
    await criarKit(db, { nome: 'Economato' });
    await db.meta.put({ chave: 'responsavel', valor: 'Eu' });
    await expect(apagarTudo(db, 'apagar?')).rejects.toThrow('APAGAR');
    expect(await db.equipamentos.count()).toBe(1);
    await apagarTudo(db, ' apagar ');
    for (const t of TABELAS.filter((x) => x !== 'meta')) expect(await db.table(t).count(), t).toBe(0);
    expect((await db.meta.get('responsavel'))?.valor).toBe('Eu');
    const l2 = await criarLocalizacao(db, { nome: 'Nova', tipo: 'divisao' });
    expect((await criarEquipamento(db, { nome: 'Novo', localizacaoId: l2.id })).codigo).toBe('EQ-000001');
  });
});
