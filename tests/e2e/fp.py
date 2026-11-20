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
    pg.goto('http://localhost:4173/#/locais'); pg.get_by_text('Arrumos (exemplo)').first.click(); pg.wait_for_selector('text=Documentos')
    pg.locator('input[type=file][accept*="pdf"]').set_input_files(os.path.join(OUT, 'foto.jpg')); pg.wait_for_selector('img[alt=Planta]')
    pg.goto('http://localhost:4173/#/plantas'); pg.wait_for_selector('img[alt=Planta]')
    pg.get_by_role('button',name='+ Novo artigo').click(); pg.get_by_label('Nome do artigo novo').fill('Caneta nova')
    pg.get_by_role('button',name='Criar e escolher').click(); pg.wait_for_selector('text=Toca na planta onde fica')
    im=pg.locator('img[alt=Planta]'); box=im.bounding_box()
    im.click(position={'x':box['width']*0.2,'y':box['height']*0.2}); pg.wait_for_selector('text=Pôr outro igual')
    pg.get_by_role('button',name='Pôr outro igual').click()
    im.click(position={'x':box['width']*0.8,'y':box['height']*0.7}); pg.wait_for_timeout(500)
    m=pg.locator('button[aria-label="Marcador Caneta nova"]'); print('pontos da caneta:',m.count())
    # mover o primeiro
    antes=m.nth(0).bounding_box()['x']
    m.nth(0).click(); pg.wait_for_timeout(300)
    if pg.get_by_role('button',name='Mover').count()==0: m.nth(0).click(); pg.wait_for_timeout(300)
    pg.get_by_role('button',name='Mover').click(); pg.wait_for_selector('text=A mover')
    im.click(position={'x':box['width']*0.5,'y':box['height']*0.5}); pg.wait_for_timeout(500)
    depois=pg.locator('button[aria-label="Marcador Caneta nova"]').nth(0).bounding_box()['x']
    print('pontos depois de mover:',pg.locator('button[aria-label="Marcador Caneta nova"]').count(),'| mexeu:',abs(antes-depois)>20)
    pg.goto('http://localhost:4173/#/stock'); pg.wait_for_selector('text=Caneta nova'); print('artigo existe em Stock: sim')
    b.close()
finally: srv.terminate()
