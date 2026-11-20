import os
ROOT = os.environ['E2E_ROOT']; OUT = os.environ['E2E_DIR']; CHROME = os.environ.get('E2E_CHROME') or None
import subprocess, time, re
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
    pg.goto('http://localhost:4173/#/locais/novo'); pg.wait_for_selector('[aria-label="Opções existentes"]')
    print('chips tipo:', pg.locator('[aria-label="Opções existentes"] button').all_inner_texts())
    pg.get_by_label('Nome *').fill('Local T'); pg.get_by_role('button',name='Exterior',exact=True).click()
    print('campo:', pg.locator('input[placeholder^="Toca"]').input_value())
    pg.get_by_role('button',name='Criar localização').click(); pg.wait_for_selector('text=Local T')
    pg.goto('http://localhost:4173/#/equipamentos/novo'); pg.wait_for_selector('text=Categoria')
    print('chips categoria equip:', pg.locator('[aria-label="Opções existentes"] button').all_inner_texts()[:5])
    b.close()
finally: srv.terminate()
