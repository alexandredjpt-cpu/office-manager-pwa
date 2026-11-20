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
    pg.get_by_role('button',name='Plantas').click(); pg.wait_for_selector('text=Ainda não há plantas'); print('sem plantas: mensagem ok')
    pg.goto('http://localhost:4173/#/locais'); pg.get_by_text('Arrumos (exemplo)').first.click(); pg.wait_for_selector('text=Documentos')
    pg.locator('input[type=file][accept*="pdf"]').set_input_files(os.path.join(OUT, 'foto.jpg')); pg.wait_for_selector('img[alt=Planta]')
    pg.goto('http://localhost:4173/'); pg.get_by_role('button',name='Plantas').click(); pg.wait_for_selector('img[alt=Planta]'); print('plantas abre a planta')
    sel=pg.get_by_label('Colocar na planta'); labels=sel.locator('option').all_inner_texts(); print('opções:',labels[:4])
    sel.select_option(index=1)
    im=pg.locator('img[alt=Planta]'); box=im.bounding_box(); im.click(position={'x':box['width']*0.4,'y':box['height']*0.4})
    pg.wait_for_selector('text=Registar anomalia'); pg.get_by_role('button',name='Registar anomalia').click()
    pg.wait_for_selector('text=Descrição curta'); print('url:',pg.url)
    print('local:',pg.get_by_label('Localização').evaluate("e=>e.selectedOptions[0]?.textContent"), '| equip:',pg.get_by_label(re.compile('Equipamento')).evaluate("e=>e.selectedOptions[0]?.textContent"))
    # artigo: marcador de artigo -> título preenchido
    pg.go_back(); pg.wait_for_selector('img[alt=Planta]')
    pg.get_by_label('Colocar na planta').select_option(label='AR-000001 · Papel A4 (exemplo)')
    im=pg.locator('img[alt=Planta]'); box=im.bounding_box(); im.click(position={'x':box['width']*0.7,'y':box['height']*0.7})
    pg.get_by_role('button',name='Registar anomalia').click(); pg.wait_for_selector('text=Descrição curta')
    print('titulo artigo:',pg.get_by_label('Descrição curta').input_value(),'| local:',pg.get_by_label('Localização').evaluate("e=>e.selectedOptions[0]?.textContent"))
    b.close()
finally: srv.terminate()
