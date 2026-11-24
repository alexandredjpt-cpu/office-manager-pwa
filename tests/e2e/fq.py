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
    pg.goto('http://localhost:4173/#/locais'); pg.get_by_text('Arrumos (exemplo)').first.click(); pg.wait_for_selector('[role=tablist]'); pg.get_by_role('tab',name='Editar').click(); pg.wait_for_selector('text=Documentos')
    pg.locator('input[type=file][accept*="pdf"]').set_input_files(os.path.join(OUT, 'foto.jpg')); pg.wait_for_selector('img[alt=Planta]')
    pg.goto('http://localhost:4173/'); pg.get_by_role('button',name='Plantas').click(); pg.wait_for_selector('img[alt=Planta]')
    pg.get_by_role('button',name='⚠ Reportar anomalia aqui').click()
    im=pg.locator('img[alt=Planta]'); box=im.bounding_box(); im.click(position={'x':box['width']*0.3,'y':box['height']*0.6})
    pg.wait_for_selector('text=Descrição curta'); print('url tem planta e posição:', 'planta=' in pg.url and '&x=' in pg.url and '&y=' in pg.url)
    print('local preenchido:',pg.get_by_label('Localização').evaluate("e=>e.selectedOptions[0]?.textContent"))
    pg.get_by_label('Descrição curta').fill('Puxador partido'); pg.get_by_label('Prioridade').select_option(index=2)
    pg.get_by_role('button',name='Registar anomalia').click(); pg.wait_for_selector('text=Tirar foto'); print('gravada; ficha com botão de foto: sim')
    pg.goto('http://localhost:4173/#/plantas'); pg.wait_for_selector('img[alt=Planta]')
    m=pg.locator('button[aria-label^="Marcador"][aria-label*="Puxador partido"]'); print('ponto vermelho na planta:',m.count(), m.first.locator('span').evaluate("e=>getComputedStyle(e).backgroundColor") if m.count() else '')
    m.first.click(); pg.wait_for_selector('text=Abrir anomalia'); print('painel: Abrir anomalia | Registar anomalia oculto:', pg.get_by_role('button',name='Registar anomalia').count()==0)
    pg.get_by_role('button',name='Abrir anomalia').click(); pg.wait_for_selector('text=Descrição curta')
    pg.get_by_role('button',name='Confirmar resolvida').click(); pg.get_by_role('button',name='Sim, resolvida').click(); pg.wait_for_selector('text=/Resolvida em/')
    pg.wait_for_timeout(600)
    pg.goto('http://localhost:4173/#/plantas'); pg.wait_for_selector('img[alt=Planta]'); pg.wait_for_timeout(400)
    print('pontos após resolver:', pg.locator('button[aria-label*="Puxador partido"]').count())
    b.close()
finally: srv.terminate()
