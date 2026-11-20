import os
ROOT = os.environ['E2E_ROOT']; OUT = os.environ['E2E_DIR']; CHROME = os.environ.get('E2E_CHROME') or None
import subprocess, time
from playwright.sync_api import sync_playwright
srv=subprocess.Popen(['npx','vite','preview','--port','4173','--strictPort'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
time.sleep(4)
try:
  with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CHROME,args=['--no-sandbox'])
    pg=b.new_page(viewport={'width':390,'height':900}); pg.on('pageerror',lambda e:print('PAGEERR',e))
    pg.goto('http://localhost:4173/'); pg.wait_for_selector('text=Office Manager')
    pg.get_by_role('button',name='Criar dados de exemplo').click(); pg.wait_for_selector('text=Alertas')
    pg.goto('http://localhost:4173/#/locais/novo'); pg.get_by_label('Nome *').fill('Sala real'); pg.get_by_role('button',name='Criar localização').click(); pg.wait_for_timeout(500)
    pg.goto('http://localhost:4173/#/copia'); pg.get_by_role('button',name='Apagar todos os dados…').click()
    btn=pg.get_by_role('dialog').get_by_role('button',name='Apagar tudo'); print('desativado sem palavra:',btn.is_disabled())
    pg.get_by_label('Confirmação').fill('apagar'); btn.click(); pg.wait_for_timeout(800)
    print('url:',pg.url, '| botão exemplo visível:', pg.get_by_role('button',name='Criar dados de exemplo').count())
    pg.goto('http://localhost:4173/#/locais'); pg.wait_for_timeout(500); print('Sala real ainda existe:', pg.get_by_text('Sala real').count())
    b.close()
finally: srv.terminate()
