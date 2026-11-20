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
    pg.goto('http://localhost:4173/#/kits/novo')
    pg.get_by_placeholder('Ex.: Economato').fill('Teste'); pg.get_by_role('button',name='Criar kit').click(); pg.wait_for_selector('text=Artigos do kit')
    pg.locator('input[type=checkbox]').first.check(); pg.get_by_role('button',name='Guardar locais').click(); pg.wait_for_selector('text=Locais guardados.')
    pg.get_by_role('button',name='Apagar kit').click(); l=pg.get_by_role('dialog').get_by_role('button',name='Apagar kit'); print('dialogo:',l.count())
    l.click(); pg.wait_for_timeout(800)
    print('url:',pg.url); print('lista:',pg.locator('main').inner_text()[:150])
    b.close()
finally: srv.terminate()
