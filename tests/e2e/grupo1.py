"""Grupo 1: modo escuro, ordenar listas, resumo de hoje, notas rápidas (→ anomalia/lembrete) e copiar equipamento igual."""
import os
ROOT = os.environ['E2E_ROOT']; OUT = os.environ['E2E_DIR']; CHROME = os.environ.get('E2E_CHROME') or None
import subprocess, time
from playwright.sync_api import sync_playwright
srv=subprocess.Popen(['npx','vite','preview','--port','4173','--strictPort'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
time.sleep(4)
U='http://localhost:4173/'
def ok(cond, txt):
  print(('ok ' if cond else 'FALHA ')+txt)
  if not cond: raise SystemExit(1)
try:
  with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CHROME,args=['--no-sandbox'])
    ctx=b.new_context(viewport={'width':390,'height':900}); pg=ctx.new_page()
    pg.on('pageerror',lambda e:print('PAGEERR',e)); pg.on('console',lambda m:print('CON',m.text[:200]) if m.type=='error' else None)
    pg.goto(U); pg.wait_for_selector('text=Office Manager')
    pg.get_by_role('button',name='Criar dados de exemplo').click(); pg.wait_for_selector('text=anomalia aberta')
    ok(pg.locator('section[aria-label="Resumo de hoje"]').count()==1, 'resumo de hoje no Início')
    pg.screenshot(path=os.path.join(OUT,'g1-inicio-claro.png'), full_page=True)

    # Notas rápidas → anomalia
    pg.get_by_label('Nova nota').fill('Estore da sala a fazer barulho\nver ao fim do dia')
    pg.get_by_role('button',name='Guardar nota').click(); pg.wait_for_selector('text=Notas rápidas (1)')
    ok(pg.locator('text=1 nota por tratar').count()==1, 'nota conta no resumo')
    pg.get_by_role('button',name='→ Anomalia').click(); pg.wait_for_url('**/#/anomalias/nova*')
    ok(pg.locator('input').first.input_value()=='Estore da sala a fazer barulho', 'título vindo da nota')
    ok('ver ao fim do dia' in pg.locator('textarea').first.input_value(), 'descrição com o texto completo')
    sels=pg.locator('select'); sels.nth(0).select_option(index=1); sels.nth(2).select_option('media')
    pg.get_by_role('button',name='Registar anomalia').click(); pg.wait_for_function("()=>!location.hash.includes('nova')",timeout=5000)
    pg.goto(U); pg.wait_for_selector('text=Hoje')
    ok(pg.locator('text=Notas rápidas (').count()==0, 'nota tratada sai do Início')

    # Nota → lembrete
    pg.get_by_label('Nova nota').fill('Pedir toner'); pg.get_by_role('button',name='Guardar nota').click()
    pg.get_by_role('button',name='→ Lembrete').click(); pg.wait_for_url('**/#/agenda/novo*')
    ok(pg.locator('input').first.input_value()=='Pedir toner', 'lembrete preenchido')
    pg.get_by_role('button',name='Criar lembrete').click(); pg.wait_for_url('**/#/agenda'); pg.goto(U); pg.wait_for_selector('text=Hoje')
    ok(pg.locator('text=tarefa na agenda').count()==1, 'lembrete de hoje aparece no resumo')
    ok(pg.locator('text=Notas rápidas (').count()==0, 'segunda nota tratada')

    # Ordenar anomalias, lembra a escolha
    pg.goto(U+'#/anomalias'); pg.get_by_label('Ordenar por').select_option('recentes')
    primeiro=pg.locator('main ul li').first.inner_text()
    ok('Estore' in primeiro, 'mais recentes primeiro')
    pg.goto(U+'#/equipamentos'); pg.goto(U+'#/anomalias')
    ok(pg.get_by_label('Ordenar por').input_value()=='recentes', 'ordem lembrada')
    pg.goto(U+'#/equipamentos'); pg.get_by_label('Estado').select_option('todos'); pg.get_by_label('Ordenar por').select_option('nome')
    nomes=[t.split('\n')[0] for t in pg.locator('main ul li').all_inner_texts()]
    ok(nomes==sorted(nomes,key=lambda s:s.lower()), 'equipamentos por nome: '+', '.join(nomes))

    # Copiar equipamento igual
    pg.locator('main ul li button').first.click(); pg.wait_for_url('**/#/equipamentos/*-*')
    nome=pg.get_by_label('Nome *').input_value()
    pg.get_by_role('button',name='＋ Criar outro igual').click(); pg.wait_for_url('**/#/equipamentos/novo?copiar=*')
    ok(pg.get_by_label('Nome *').input_value()==nome, 'novo já com o nome copiado ('+nome+')')
    ok(pg.locator('text=Copiado de').count()==1, 'aviso de cópia')
    ok(pg.get_by_label('Nº de imobilizado').input_value()=='', 'etiqueta fica por preencher')
    pg.goto(U+'#/equipamentos'); pg.get_by_role('button',name='Novo equipamento').click(); pg.wait_for_url('**/#/equipamentos/novo')
    pg.get_by_role('button',name='Igual a um que já existe?').click()
    pg.locator('ul.max-h-72 li button').first.click()
    ok(pg.get_by_label('Nome *').input_value()!='', 'lista de iguais preenche o nome')
    pg.get_by_role('button',name='Criar equipamento').click(); pg.wait_for_url('**/#/equipamentos/*-*')
    ok(pg.locator('h2').first.inner_text().startswith('EQ-'), 'criado: '+pg.locator('h2').first.inner_text())

    # Modo escuro
    pg.goto(U+'#/aparencia'); pg.get_by_role('radio',name='🌙 Escuro').click()
    ok(pg.evaluate("document.documentElement.classList.contains('escuro')"), 'classe escuro aplicada')
    fundo=pg.evaluate("getComputedStyle(document.body).backgroundColor"); cart=pg.evaluate("getComputedStyle(document.querySelector('.cartao')).backgroundColor")
    print('fundo', fundo, 'cartão', cart)
    ok(fundo!='rgb(248, 250, 252)', 'fundo deixou de ser claro')
    pg.reload(); pg.wait_for_selector('text=Aparência')
    ok(pg.evaluate("document.documentElement.classList.contains('escuro')"), 'modo escuro mantém-se ao reabrir')
    pg.goto(U); pg.wait_for_selector('text=Hoje'); pg.screenshot(path=os.path.join(OUT,'g1-inicio-escuro.png'), full_page=True)
    pg.goto(U+'#/anomalias'); pg.wait_for_timeout(400); pg.screenshot(path=os.path.join(OUT,'g1-anomalias-escuro.png'), full_page=True)
    pg.goto(U+'#/stock'); pg.wait_for_timeout(400); pg.screenshot(path=os.path.join(OUT,'g1-stock-escuro.png'), full_page=True)
    pg.goto(U+'#/equipamentos/novo'); pg.wait_for_timeout(400); pg.screenshot(path=os.path.join(OUT,'g1-novo-escuro.png'), full_page=True)
    pg.goto(U+'#/aparencia'); pg.get_by_role('radio',name='Automático').click()
    pg.emulate_media(color_scheme='light'); pg.wait_for_timeout(200)
    ok(not pg.evaluate("document.documentElement.classList.contains('escuro')"), 'automático claro')
    pg.emulate_media(color_scheme='dark'); pg.wait_for_timeout(200)
    ok(pg.evaluate("document.documentElement.classList.contains('escuro')"), 'automático acompanha o telemóvel')
    b.close()
finally: srv.terminate()
