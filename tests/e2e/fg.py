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
    pg.goto('http://localhost:4173/#/locais'); pg.get_by_text('Sala (exemplo)').first.click(); pg.wait_for_selector('[role=tablist]'); pg.get_by_role('tab',name='Editar').click(); pg.wait_for_selector('text=Planta')
    pg.locator('input[type=file][accept*="pdf"]').set_input_files(os.path.join(OUT, 'foto.jpg')); pg.wait_for_selector('text=Documentos (1)')
    pg.wait_for_selector('img[alt=Planta]')
    pg.get_by_label('Colocar na planta').select_option(index=1)
    im=pg.locator('img[alt=Planta]'); box=im.bounding_box(); im.click(position={'x':box['width']*0.3,'y':box['height']*0.4})
    pg.wait_for_selector('button[aria-label^="Marcador"]'); print('marcador colocado')
    pg.wait_for_selector('text=Abrir ficha'); print('ficha do marcador visível após colocar')
    # pesquisa -> ver na planta
    pg.goto('http://localhost:4173/#/pesquisa'); pg.get_by_placeholder(re.compile('Pesquisar em tudo')).fill('router' if False else 'exemplo')
    pg.wait_for_selector('text=Ver na planta'); print('pesquisa mostra Ver na planta')
    pg.get_by_text('Ver na planta').first.click(); pg.wait_for_selector('button[aria-label^="Marcador"] .animate-pulse'); print('marcador destacado')
    # artigo com fornecedor
    pg.goto('http://localhost:4173/#/fornecedores/novo'); pg.get_by_label('Nome *').fill('Forn Z'); pg.get_by_role('button',name='Criar fornecedor').click(); pg.wait_for_selector('text=Forn Z')
    pg.goto('http://localhost:4173/#/stock'); pg.get_by_text('AR-000001').first.click(); pg.wait_for_selector('text=Fornecedor habitual')
    pg.get_by_label('Fornecedor habitual').select_option(label='Forn Z'); pg.get_by_role('button',name='Guardar alterações').first.click(); pg.wait_for_selector('text=Guardado.')
    pg.goto('http://localhost:4173/#/encomendas'); pg.get_by_role('button',name='Nova encomenda').click(); pg.locator('[role=dialog] select').select_option(label='Forn Z'); pg.get_by_role('button',name='Criar rascunho').click(); pg.wait_for_selector('text=EN-000001')
    print([x for x in pg.locator('button').all_inner_texts() if 'lista de compras' in x])
    b.close()
finally: srv.terminate()
