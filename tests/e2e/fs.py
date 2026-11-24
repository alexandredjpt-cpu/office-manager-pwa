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
    pg.goto('http://localhost:4173/#/locais'); pg.get_by_text('Arrumos (exemplo)').first.click(); pg.wait_for_selector('[role=tablist]'); pg.get_by_role('tab',name='Editar').click(); pg.wait_for_selector('text=Documentos')
    pg.locator('input[type=file][accept*="pdf"]').set_input_files(os.path.join(OUT, 'foto.jpg')); pg.wait_for_selector('img[alt=Planta]')
    pg.goto('http://localhost:4173/#/plantas'); pg.wait_for_selector('img[alt=Planta]')
    im=pg.locator('img[alt=Planta]'); box=im.bounding_box(); sel=pg.get_by_label('Colocar na planta')
    for i,(x,y) in enumerate([(0.3,0.3),(0.32,0.33),(0.35,0.3)]):
        sel.select_option(index=i+1); im.click(position={'x':box['width']*x,'y':box['height']*y}); pg.wait_for_timeout(300)
    pg.locator('body').click(position={'x':5,'y':5})
    pg.get_by_text('Pontos nesta planta (3)').click()
    pg.locator('details li button').nth(0).click(); pg.wait_for_timeout(300)
    print('etiqueta:',pg.locator('span.bg-slate-900').all_inner_texts(), '| esbatidos:',pg.locator('button[aria-label^="Marcador"].opacity-30').count())
    pg.screenshot(path=os.path.join(OUT, 'fs.png'))
    b.close()
finally: srv.terminate()
