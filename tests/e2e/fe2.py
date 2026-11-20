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
    # e-mail livre com fornecedor novo
    pg.goto('http://localhost:4173/#/modelos'); pg.get_by_role('button',name=re.compile('Escrever e-mail a um fornecedor')).click()
    pg.get_by_label('Fornecedor').select_option(label='+ Novo fornecedor…'); pg.get_by_label('Nome *').fill('Fornecedor Rápido'); pg.get_by_label('Pessoa de contacto').fill('Rui')
    pg.wait_for_selector('text=Modelo'); print(pg.locator('textarea').first.input_value()[:60].replace('\n',' / '))
    pg.on('framenavigated', lambda f: None)
    pg.evaluate("window.addEventListener('beforeunload',e=>e.preventDefault())")
    # evitar navegação real do mailto
    pg.evaluate("Object.defineProperty(window,'location',{configurable:true,value:window.location})") if False else None
    # nova encomenda com fornecedor novo
    pg.goto('http://localhost:4173/#/encomendas'); pg.get_by_role('button',name='Nova encomenda').click()
    pg.locator('[role=dialog] select').select_option(label='+ Novo fornecedor…'); pg.get_by_label('Nome do novo fornecedor *').fill('Outro Forn'); pg.get_by_role('button',name='Criar rascunho').click()
    pg.wait_for_selector('text=EN-000001'); print('encomenda com fornecedor novo:', 'Outro Forn' in pg.inner_text('main'))
    b.close()
finally: srv.terminate()
