import os
ROOT = os.environ['E2E_ROOT']; OUT = os.environ['E2E_DIR']; CHROME = os.environ.get('E2E_CHROME') or None
import subprocess, time
from playwright.sync_api import sync_playwright
srv=subprocess.Popen(['npx','vite','preview','--port','4173','--strictPort'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
time.sleep(4)
try:
  with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CHROME,args=['--no-sandbox'])
    pg=b.new_page(viewport={'width':390,'height':900})
    pg.on('pageerror',lambda e:print('PAGEERR',e)); pg.on('console',lambda m:print('CON',m.text[:200]) if m.type=='error' else None)
    pg.goto('http://localhost:4173/'); pg.wait_for_selector('text=Office Manager')
    pg.get_by_role('button',name='Criar dados de exemplo').click(); pg.wait_for_selector('text=Alertas')
    pg.goto('http://localhost:4173/#/mais'); pg.get_by_text('Kits (listas-modelo)').click()
    pg.wait_for_selector('text=Ainda não tens kits'); pg.get_by_role('button',name='Novo kit').click()
    pg.get_by_placeholder('Ex.: Economato').fill('Economato'); pg.get_by_role('button',name='Criar kit').click()
    pg.wait_for_selector('text=Artigos do kit')
    sel=pg.locator('select').first
    opts=sel.locator('option').all_inner_texts(); print('artigos:',opts[:4])
    for i in (1,2):
        sel.select_option(index=1); pg.get_by_role('button',name='Acrescentar ao kit').click(); pg.wait_for_timeout(300)
    alvos=pg.locator('input[aria-label^="Alvo por local"]'); print('n artigos no kit:',alvos.count())
    alvos.first.fill('5'); alvos.first.blur(); pg.wait_for_timeout(300)
    locs=pg.locator('input[type=checkbox]'); print('n locais:',locs.count())
    locs.nth(0).check(); locs.nth(1).check()
    pg.get_by_role('button',name='Guardar locais').click(); pg.wait_for_selector('text=Locais guardados.')
    # ir ao primeiro local marcado
    nome=pg.locator('label:has(input[type=checkbox]:checked)').first.inner_text().strip(); print('local:',nome)
    pg.goto('http://localhost:4173/#/locais'); pg.get_by_text(nome,exact=False).first.click(); pg.wait_for_timeout(800)
    pg.get_by_role('tab',name='Repor').click(); pg.wait_for_selector('text=Editar kit'); print('caixa:',pg.locator('text=/Aqui: |Por contar/').all_inner_texts())
    pg.locator('input[aria-label^="Contar"]').first.fill('3')
    pg.get_by_role('button',name='Registar contagens preenchidas').click(); pg.wait_for_selector('text=contagem(ns) registada(s)')
    print('linhas:',pg.locator('text=/Aqui: |Por contar/').all_inner_texts())
    pg.screenshot(path=os.path.join(OUT, 'fj.png'),full_page=True)
    b.close()
finally: srv.terminate()
