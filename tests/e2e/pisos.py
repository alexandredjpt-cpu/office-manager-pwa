import os
ROOT = os.environ['E2E_ROOT']; OUT = os.environ['E2E_DIR']; CHROME = os.environ.get('E2E_CHROME') or None
import subprocess, time
from playwright.sync_api import sync_playwright
srv=subprocess.Popen(['npx','vite','preview','--port','4173','--strictPort'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
time.sleep(4)
U='http://localhost:4173/'
def ok(c,m):
    print(('ok ' if c else 'FALHA ')+m)
    if not c: raise SystemExit(1)
try:
  with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CHROME,args=['--no-sandbox'])
    pg=b.new_context(viewport={'width':390,'height':900}).new_page()
    pg.on('pageerror',lambda e:print('PAGEERR',e))
    pg.goto(U); pg.get_by_role('button',name='Criar dados de exemplo (fictícios)').click() if pg.get_by_role('button',name='Criar dados de exemplo (fictícios)').count() else None
    pg.goto(U+'#/locais/novo'); pg.get_by_label('Nome *').fill('Sala piso zero'); pg.get_by_label('Piso (opcional)').fill('0'); pg.get_by_role('button',name='Criar localização').click(); pg.wait_for_timeout(500)
    pg.goto(U+'#/locais/novo'); pg.get_by_label('Nome *').fill('Sala piso dois'); pg.get_by_label('Piso (opcional)').fill('2'); pg.get_by_role('button',name='Criar localização').click(); pg.wait_for_timeout(500)
    pg.goto(U+'#/'); pg.wait_for_selector('[aria-label=Pisos]')
    ok(pg.get_by_role('button',name='Piso 0').count()==1 and pg.get_by_role('button',name='Piso 2').count()==1,'Início mostra um botão por piso')
    pg.get_by_role('button',name='Piso 2').click(); pg.wait_for_url('**/#/locais?piso=2')
    pg.wait_for_selector('text=Sala piso dois')
    ok(pg.get_by_text('Sala piso zero').count()==0,'piso 2 filtra os locais do piso 0')
    b.close()
finally: srv.terminate()
