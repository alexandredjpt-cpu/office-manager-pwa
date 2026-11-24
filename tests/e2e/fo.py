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
    pg.goto('http://localhost:4173/#/locais'); pg.get_by_text('Arrumos (exemplo)').first.click(); pg.wait_for_selector('[role=tablist]'); pg.get_by_role('tab',name='Editar').click(); pg.wait_for_selector('text=Documentos')
    pg.locator('input[type=file][accept*="pdf"]').set_input_files(os.path.join(OUT, 'foto.jpg')); pg.wait_for_selector('img[alt=Planta]')
    pg.goto('http://localhost:4173/#/stock/novo'); pg.get_by_label('Nome *').fill('Marcadores novos')
    pg.get_by_role('button',name=__import__('re').compile('Criar')).click(); pg.wait_for_timeout(800)
    pg.goto('http://localhost:4173/#/plantas'); pg.wait_for_selector('img[alt=Planta]')
    ops=pg.get_by_label('Colocar na planta').locator('option').all_inner_texts(); print('novo na lista:',[o for o in ops if 'novos' in o])
    sel=pg.get_by_label('Colocar na planta'); sel.select_option(label=[o for o in ops if 'novos' in o][0])
    im=pg.locator('img[alt=Planta]'); box=im.bounding_box(); im.click(position={'x':box['width']*0.5,'y':box['height']*0.5})
    pg.wait_for_selector('text=Tirar da planta'); print('colocado: sim')
    b.close()
finally: srv.terminate()
