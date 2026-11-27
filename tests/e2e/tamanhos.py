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
    # criar artigo de vestuário com 3 tamanhos
    pg.goto('http://localhost:4173/#/stock/novo')
    pg.get_by_label('Nome *').fill('Polo manga curta'); pg.get_by_role('button',name='M',exact=True).click(); pg.get_by_role('button',name='L',exact=True).click(); pg.get_by_role('button',name='XL',exact=True).click()
    print('código de barras escondido:', pg.get_by_label('Código de barras').count()==0)
    pg.get_by_role('button',name='Criar 3 artigo(s), um por tamanho').click()
    # a lista agrupa numa linha só
    pg.wait_for_selector('text=Tamanhos: M · L · XL'); print('grupo na lista')
    assert pg.get_by_text('Polo manga curta',exact=True).count()==1
    pg.get_by_text('Polo manga curta',exact=True).click(); pg.wait_for_selector('text=Ver tamanhos',state='detached')
    pg.get_by_role('button',name=re.compile(r'^L 0')).click(); pg.wait_for_url(re.compile('stock/'))
    assert pg.get_by_label('Nome *').input_value()=='Polo manga curta · L'; print('abre a ficha do tamanho')
    # contar o L e ver o grupo somar
    pg.get_by_label('Contar em').select_option(index=1)
    pg.get_by_label(re.compile('Quantidade encontrada')).fill('7'); pg.get_by_role('button',name='Registar contagem').click(); pg.wait_for_timeout(600)
    pg.goto('http://localhost:4173/#/stock'); pg.wait_for_selector('text=Tamanhos: M · L · XL')
    linha=pg.locator('li',has_text='Tamanhos: M · L · XL').first
    assert '7' in linha.inner_text(); print('total do grupo soma os tamanhos')
    b.close()
finally: srv.terminate()
