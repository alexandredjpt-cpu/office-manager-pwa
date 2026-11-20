import os
ROOT = os.environ['E2E_ROOT']; OUT = os.environ['E2E_DIR']; CHROME = os.environ.get('E2E_CHROME') or None
import subprocess, time, re
from playwright.sync_api import sync_playwright
srv=subprocess.Popen(['npx','vite','preview','--port','4173','--strictPort'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
time.sleep(4)
try:
  with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CHROME,args=['--no-sandbox'])
    ctx=b.new_context(viewport={'width':390,'height':800},accept_downloads=True)
    pg=ctx.new_page()
    pg.on('pageerror',lambda e:print('PAGEERR',e)); pg.on('console',lambda m:print('CON',m.text[:200]) if m.type=='error' else None)
    pg.goto('http://localhost:4173/'); pg.wait_for_selector('text=Office Manager')
    pg.get_by_role('button',name='Criar dados de exemplo').click()
    pg.wait_for_selector('text=A comprar (1)')
    pg.get_by_role('button',name='Stock',exact=True).first.click()
    pg.wait_for_selector('text=Papel A4 (exemplo)'); print('lista stock ok')
    pg.get_by_role('button',name=re.compile('A comprar')).click()
    pg.wait_for_selector('text=Total estimado'); print(pg.inner_text('main')[:300].replace('\n',' | '))
    pg.get_by_role('button',name='Comprado',exact=True).click(); pg.wait_for_selector('text=Desfazer')
    with pg.expect_download() as d: pg.get_by_role('button',name=re.compile('Exportar lista')).click()
    d.value.save_as(os.path.join(OUT, 'compras.xlsx')); print('xlsx',d.value.suggested_filename)
    # ficha + contagem
    pg.get_by_role('button',name=re.compile('Artigos')).click()
    pg.get_by_text('Papel A4 (exemplo)').click(); pg.wait_for_selector('text=Registar contagem')
    pg.get_by_label(re.compile('Quantidade encontrada')).fill('6,5'); pg.get_by_role('button',name='Registar contagem').click()
    pg.wait_for_selector('text=Contagem registada.'); print(pg.inner_text('text=Histórico de contagens >> xpath=..')[:200].replace('\n',' | '))
    pg.get_by_role('button',name='← Stock').click()
    pg.wait_for_selector('text=OK')
    # apagar exemplo e criar real
    pg.get_by_role('button',name='Início').click()
    pg.get_by_role('button',name='Apagar dados de exemplo e começar do zero').click()
    pg.get_by_role('button',name='Apagar',exact=True).click(); pg.wait_for_selector('text=Criar dados de exemplo')
    pg.goto('http://localhost:4173/#/stock/novo'); pg.locator('input.campo').first.fill('Café')
    pg.get_by_role('button',name='Criar artigo').click(); pg.wait_for_selector('text=AR-000001'); print('AR-000001 ok')
    pg.screenshot(path=os.path.join(OUT, 'b3.png'))
    b.close()
finally: srv.terminate()
