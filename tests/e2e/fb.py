import os
ROOT = os.environ['E2E_ROOT']; OUT = os.environ['E2E_DIR']; CHROME = os.environ.get('E2E_CHROME') or None
import subprocess, time, re
from playwright.sync_api import sync_playwright
srv=subprocess.Popen(['npx','vite','preview','--port','4173','--strictPort'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
time.sleep(4)
try:
  with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CHROME,args=['--no-sandbox'])
    pg=b.new_page(viewport={'width':390,'height':800})
    pg.on('pageerror',lambda e:print('PAGEERR',e)); pg.on('console',lambda m:print('CON',m.text[:200]) if m.type=='error' else None)
    pg.goto('http://localhost:4173/'); pg.wait_for_selector('text=Office Manager')
    pg.get_by_role('button',name='Criar dados de exemplo').click(); pg.wait_for_selector('text=Alertas')
    pg.goto('http://localhost:4173/#/stock'); pg.get_by_text('Papel A4 (exemplo)').first.click(); pg.wait_for_selector('text=Movimentos')
    pg.get_by_role('button',name=re.compile('Transferir')).click()
    sels=pg.locator('select'); print('selects',sels.count())
    pg.get_by_label(re.compile('^Para')).select_option(index=1)
    pg.get_by_label(re.compile('Quantidade \\(')).last.fill('1'); pg.get_by_label('Motivo *').fill('Reposição')
    pg.get_by_role('button',name='Registar movimento').click(); pg.wait_for_selector('text=Movimento registado.')
    print(pg.inner_text('main')[:900].replace('\n',' | '))
    pg.get_by_role('button',name='Anular este movimento (engano)').click(); pg.wait_for_timeout(600)
    print('anulado:', 'Transferência:' not in pg.inner_text('main'))
    pg.get_by_label(re.compile('^Quantidade \\(')).last.fill('999'); pg.get_by_label('Motivo *').fill('teste'); pg.get_by_role('button',name='Registar movimento').click(); pg.wait_for_selector('text=Só há')
    print('limite ok')
    b.close()
finally: srv.terminate()
