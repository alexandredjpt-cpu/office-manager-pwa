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
    pg.get_by_role('button',name='Criar dados de exemplo').click(); pg.wait_for_selector('text=Alertas (1)'); print('alerta de garantia ok')
    # pesquisa
    pg.get_by_role('button',name='Pesquisar').click(); pg.get_by_placeholder(re.compile('Pesquisar em tudo')).fill('papel')
    pg.wait_for_selector('text=Papel A4 (exemplo)'); print(pg.inner_text('main')[:200].replace('\n',' | '))
    pg.get_by_text('Papel A4 (exemplo)').click(); pg.wait_for_selector('text=Registar contagem')
    # anular contagem
    pg.get_by_label(re.compile('Quantidade encontrada')).fill('99'); pg.get_by_role('button',name='Registar contagem').click(); pg.wait_for_selector('text=Contagem registada.')
    pg.get_by_role('button',name='Anular esta contagem (engano)').first.click(); pg.wait_for_timeout(500)
    print('99 desapareceu:', pg.locator('text=99').count()==0)
    # lembrete
    pg.goto('http://localhost:4173/#/agenda/novo'); pg.get_by_label('Título *').fill('Mudar filtro'); 
    pg.get_by_label('Avisar com (dias)').fill('3'); pg.locator('input[type=date]').first.fill('2026-11-21')
    pg.get_by_role('button',name='Criar lembrete').click(); pg.wait_for_selector('text=Mudar filtro'); print('lembrete criado; grupo:', 'Próximos 7 dias' in pg.inner_text('main'))
    pg.goto('http://localhost:4173/#/'); pg.wait_for_selector('text=Alertas (2)'); print('2 alertas no início')
    # anular anomalia
    pg.goto('http://localhost:4173/#/anomalias'); pg.get_by_text('Wi-Fi instável').click(); pg.wait_for_selector('text=Histórico')
    pg.get_by_role('button',name='Anular (registada por engano)').click(); pg.get_by_label('Motivo *').fill('teste'); pg.get_by_role('button',name='Anular',exact=True).click()
    pg.wait_for_selector('text=Sem anomalias'); print('anomalia anulada')
    b.close()
finally: srv.terminate()
