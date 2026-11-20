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
    pg.get_by_role('button',name='Criar dados de exemplo').click(); pg.wait_for_selector('text=Anomalias abertas')
    pg.goto('http://localhost:4173/#/inspecoes')
    pg.locator('select').first.select_option(label='Sala (exemplo)'); pg.get_by_role('button',name='Iniciar inspeção').click()
    pg.wait_for_selector('text=Por avaliar')
    pg.get_by_role('button',name='Concluir inspeção').click(); pg.wait_for_selector('text=Faltam avaliar 1'); print('exige todas avaliadas')
    pg.get_by_role('button',name='Com anomalia').click(); pg.get_by_role('button',name='Criar anomalia a partir disto').click()
    pg.get_by_label('Descrição curta *').fill('Luz fraca'); pg.get_by_label('Prioridade *').select_option('baixa')
    print('equip preenchido:', pg.get_by_label('Equipamento (opcional)').evaluate('e=>e.options[e.selectedIndex].text'))
    pg.get_by_role('button',name='Registar anomalia').click(); pg.wait_for_selector('text=Anomalia AN-000002'); print('anomalia ligada à inspeção ok')
    pg.set_input_files('input[type=file]',os.path.join(OUT, 'foto.jpg')); pg.wait_for_selector('button[aria-label="Ver fotografia"]',timeout=20000)
    pg.get_by_label('Observações da inspeção').fill('Vista rápida'); pg.get_by_role('button',name='Concluir inspeção').click(); pg.wait_for_selector('text=Concluída')
    print('concluída; botões desativados:', pg.get_by_role('button',name='Conforme').is_disabled())
    with pg.expect_download(timeout=30000) as d: pg.get_by_role('button',name='Gerar PDF desta inspeção').click()
    d.value.save_as(os.path.join(OUT, 'insp.pdf')); print(d.value.suggested_filename)
    pg.goto('http://localhost:4173/#/relatorios')
    with pg.expect_download(timeout=30000) as d: pg.get_by_role('button',name='Gerar PDF').nth(3).click()
    d.value.save_as(os.path.join(OUT, 'histinsp.pdf')); print(d.value.suggested_filename)
    b.close()
finally: srv.terminate()
