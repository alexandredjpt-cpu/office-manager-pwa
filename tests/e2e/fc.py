import os
ROOT = os.environ['E2E_ROOT']; OUT = os.environ['E2E_DIR']; CHROME = os.environ.get('E2E_CHROME') or None
import subprocess, time, re
from playwright.sync_api import sync_playwright
srv=subprocess.Popen(['npx','vite','preview','--port','4173','--strictPort'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
time.sleep(4)
try:
  with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CHROME,args=['--no-sandbox'])
    pg=b.new_page(viewport={'width':390,'height':800})
    pg.on('pageerror',lambda e:print('PAGEERR',e)); pg.on('console',lambda m:print('CON',m.text[:200]) if m.type=='error' else None)
    pg.goto('http://localhost:4173/'); pg.wait_for_selector('text=Office Manager')
    pg.get_by_role('button',name='Criar dados de exemplo').click(); pg.wait_for_selector('text=Alertas')
    pg.goto('http://localhost:4173/#/equipamentos'); pg.get_by_text('EQ-000001').first.click(); pg.wait_for_selector('text=Manutenção preventiva')
    pg.get_by_role('button',name='+ Tarefa').click()
    pg.get_by_label('Tarefa *').fill('Limpar filtros'); pg.locator('input[type=date]').last.fill('2026-11-25')
    pg.get_by_label('Repetir a cada (dias)').fill('30'); pg.get_by_role('button',name='Guardar',exact=True).click()
    pg.wait_for_selector('text=repete a cada 30 d'); print('tarefa criada')
    pg.goto('http://localhost:4173/#/agenda'); pg.wait_for_selector('text=Limpar filtros'); print('na agenda')
    pg.go_back(); pg.wait_for_selector('text=Manutenção preventiva')
    pg.get_by_role('button',name='Concluir',exact=True).click(); pg.get_by_role('button',name='Concluir e agendar a próxima').click()
    pg.wait_for_selector('text=Próxima:'); print(pg.inner_text('main').split('Manutenção preventiva')[1][:300].replace('\n',' | '))
    b.close()
finally: srv.terminate()
