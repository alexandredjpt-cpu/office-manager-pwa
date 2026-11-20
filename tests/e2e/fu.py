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
    pg.goto('http://localhost:4173/#/equipamentos'); pg.get_by_text('Router (exemplo)').first.click(); pg.wait_for_selector('text=Tirar foto')
    print('capture:',pg.locator('input[capture]').get_attribute('capture'))
    with pg.expect_file_chooser() as fc: pg.get_by_role('button',name='📷 Tirar foto').click()
    fc.value.set_files(os.path.join(OUT, 'foto.jpg')); pg.wait_for_selector('text=Fotografias (1)')
    with pg.expect_file_chooser() as fc: pg.get_by_role('button',name='🖼 Da galeria').click()
    print('galeria múltipla:',fc.value.is_multiple()); fc.value.set_files([os.path.join(OUT, 'foto.jpg'),os.path.join(OUT, 'foto.jpg')]); pg.wait_for_selector('text=Fotografias (3)'); print('fotos: 3')
    b.close()
finally: srv.terminate()
