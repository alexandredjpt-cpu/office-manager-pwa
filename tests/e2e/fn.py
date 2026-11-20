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
    pg.on('pageerror',lambda e:print('PAGEERR',e))
    pg.goto('http://localhost:4173/'); pg.wait_for_selector('text=Office Manager')
    pg.get_by_role('button',name='Criar dados de exemplo').click(); pg.wait_for_selector('text=Alertas')
    h=pg.get_by_role('button',name='Atividade recente'); h.wait_for()
    print('fechada:',h.get_attribute('aria-expanded'), '| itens visíveis:',pg.locator('li:has(span.text-xs)').count())
    h.click(); print('aberta:',h.get_attribute('aria-expanded'), '| itens:',pg.locator('li:has(span.text-xs)').count()>0)
    h.click(); print('fechada outra vez:',h.get_attribute('aria-expanded'))
    b.close()
finally: srv.terminate()
