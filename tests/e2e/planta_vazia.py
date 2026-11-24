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
    # app vazia (sem dados de exemplo): só um local com planta
    pg.goto('http://localhost:4173/#/locais/novo'); pg.get_by_label('Nome *').fill('Escritório'); pg.get_by_role('button',name='Criar localização').click(); pg.wait_for_timeout(600)
    pg.goto('http://localhost:4173/#/locais'); pg.get_by_text('Escritório').first.click(); pg.wait_for_selector('[role=tablist]'); pg.get_by_role('tab',name='Editar').click(); pg.wait_for_selector('text=Documentos')
    pg.locator('input[type=file][accept*="pdf"]').set_input_files(os.path.join(OUT,'foto.jpg')); pg.wait_for_selector('img[alt=Planta]')
    assert pg.get_by_text('Ainda não há equipamentos, artigos nem outros locais').count()==1, 'mensagem de lista vazia'
    pg.get_by_role('button',name='+ Novo equipamento').click(); pg.get_by_label('Nome do equipamento novo').fill('Impressora')
    pg.get_by_role('button',name='Criar e escolher').click(); pg.wait_for_selector('text=Toca na planta onde fica')
    im=pg.locator('img[alt=Planta]'); box=im.bounding_box(); im.click(position={'x':box['width']*0.5,'y':box['height']*0.5})
    pg.wait_for_selector('button[aria-label="Marcador Impressora"]')
    opts=pg.locator('select:has(option:text-is("Escolher…")) option').all_inner_texts()
    assert any('Impressora' in o for o in opts), opts
    print('planta vazia: mensagem, novo equipamento criado neste local e colocado')
    b.close()
finally: srv.terminate()
