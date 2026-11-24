import os
ROOT = os.environ['E2E_ROOT']; OUT = os.environ['E2E_DIR']; CHROME = os.environ.get('E2E_CHROME') or None
import subprocess, time
from playwright.sync_api import sync_playwright
srv=subprocess.Popen(['npx','vite','preview','--port','4173','--strictPort'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
time.sleep(4)
try:
  with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CHROME,args=['--no-sandbox'])
    ctx=b.new_context(viewport={'width':390,'height':900},accept_downloads=True); pg=ctx.new_page()
    pg.add_init_script("delete navigator.canShare; delete navigator.share; Object.defineProperty(navigator,'canShare',{value:undefined}); Object.defineProperty(navigator,'share',{value:undefined});")
    pg.on('pageerror',lambda e:print('PAGEERR',e)); pg.on('console',lambda m:print('CON',m.text[:200]) if m.type=='error' else None)
    pg.goto('http://localhost:4173/'); pg.wait_for_selector('text=Office Manager')
    pg.get_by_role('button',name='Criar dados de exemplo').click(); pg.wait_for_selector('text=Alertas')
    # atividade: abrir, recarregar, continua aberta
    h=pg.get_by_role('button',name='Atividade recente'); h.click(); pg.reload(); pg.wait_for_selector('text=Alertas')
    print('atividade lembrada aberta:',pg.get_by_role('button',name='Atividade recente').get_attribute('aria-expanded'))
    pg.get_by_role('button',name='Atividade recente').click(); pg.reload(); pg.wait_for_selector('text=Alertas')
    print('atividade lembrada fechada:',pg.get_by_role('button',name='Atividade recente').get_attribute('aria-expanded'))
    # kit
    pg.goto('http://localhost:4173/#/kits/novo'); pg.get_by_placeholder('Ex.: Economato').fill('Economato'); pg.get_by_role('button',name='Criar kit').click(); pg.wait_for_selector('text=Artigos do kit')
    sel=pg.locator('select').first
    for i in (1,2): sel.select_option(index=1); pg.get_by_role('button',name='Acrescentar ao kit').click(); pg.wait_for_timeout(300)
    a=pg.locator('input[aria-label^="Alvo por local"]'); a.first.fill('10'); a.first.blur(); pg.wait_for_timeout(300)
    pg.locator('input[type=checkbox]').nth(0).check(); pg.locator('input[type=checkbox]').nth(1).check(); pg.get_by_role('button',name='Guardar locais').click(); pg.wait_for_selector('text=Locais guardados.')
    pg.goto('http://localhost:4173/#/locais'); pg.get_by_text('Arrumos (exemplo)').first.click(); pg.get_by_role('tab',name='Repor').click(); pg.wait_for_selector('text=Editar kit')
    with pg.expect_download() as d: pg.get_by_role('button',name='Folha de reposição (PDF)').click()
    f=d.value; print('pdf local:',f.suggested_filename, open(f.path(),'rb').read(5))
    pg.goto('http://localhost:4173/#/relatorios'); pg.wait_for_selector('text=Folha de reposição (kits)')
    print('opções:',pg.get_by_label('Local da folha de reposição').locator('option').all_inner_texts())
    with pg.expect_download() as d: pg.locator('div.cartao:has-text("Folha de reposição (kits)")').get_by_role('button',name='Gerar PDF').click()
    f2=d.value; print('pdf todos:',f2.suggested_filename); import shutil; shutil.copy(f2.path(),os.path.join(OUT, 'rep.pdf'))
    b.close()
finally: srv.terminate()
