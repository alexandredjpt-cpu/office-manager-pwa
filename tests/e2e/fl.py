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
    pg.wait_for_selector('text=Atividade recente'); print('atividade recente no início: True')
    pg.goto('http://localhost:4173/#/locais'); pg.get_by_text('Sala (exemplo)').first.click(); pg.wait_for_selector('text=Planta')
    pg.locator('input[type=file][accept*="pdf"]').set_input_files(os.path.join(OUT, 'foto.jpg')); pg.wait_for_selector('text=Documentos (1)')
    pg.wait_for_selector('img[alt=Planta]')
    pg.get_by_label('Colocar na planta').select_option(index=1)
    im=pg.locator('img[alt=Planta]'); box=im.bounding_box(); im.click(position={'x':box['width']*0.3,'y':box['height']*0.4})
    pg.wait_for_selector('button[aria-label^="Marcador"]'); print('marcador colocado')
    w0=im.bounding_box()['width']
    dot=pg.locator('button[aria-label^="Marcador"] span').first.bounding_box(); print('ponto px:',round(dot['width']),round(dot['height']))
    pg.get_by_role('button',name='Ampliar planta').click(); pg.get_by_role('button',name='Ampliar planta').click()
    w1=im.bounding_box()['width']; print('largura 100% -> 200%:',round(w0),round(w1))
    pg.get_by_role('button',name='Reduzir planta').click(); pg.get_by_role('button',name='Reduzir planta').click()
    print('reduzida:',round(im.bounding_box()['width']))
    b.close()
finally: srv.terminate()
