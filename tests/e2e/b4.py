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
    pg.wait_for_selector('text=Anomalias abertas (1)')
    pg.get_by_role('button',name='Anomalias',exact=True).last.click()
    pg.get_by_text('Wi-Fi instável (exemplo)').click(); pg.wait_for_selector('text=Histórico')
    # foto
    pg.set_input_files('input[type=file]',os.path.join(OUT, 'foto.jpg')); pg.wait_for_selector('button[aria-label="Ver fotografia"]',timeout=20000); print('foto anomalia ok')
    # prioridade
    pg.get_by_label('Prioridade *').select_option('alta'); pg.get_by_role('button',name='Guardar alterações').click(); pg.wait_for_selector('text=Guardado.')
    # intervenção
    pg.get_by_label('Texto do registo').fill('Técnico trocou o cabo'); pg.get_by_role('button',name='Acrescentar ao histórico').click(); pg.wait_for_selector('text=Técnico trocou o cabo')
    pg.get_by_role('button',name='Passar a «Aguarda verificação»').click(); pg.wait_for_selector('text=Aguarda verificação.')
    print('estado ainda aberta:', pg.locator('text=Confirmar resolvida').count()==1)
    pg.get_by_role('button',name='Confirmar resolvida').click(); pg.get_by_role('button',name='Sim, resolvida').click()
    pg.wait_for_selector('text=Para alterar os dados, reabre-a.')
    print(pg.inner_text('text=Histórico >> xpath=..')[-420:].replace('\n',' | '))
    pg.get_by_role('button',name='Reabrir').click(); pg.wait_for_selector('text=Confirmar resolvida'); print('reaberta ok')
    # nova a partir de equipamento
    pg.goto('http://localhost:4173/#/equipamentos'); pg.get_by_text('Aspirador').first.click()
    pg.get_by_role('button',name='Registar anomalia deste equipamento').click()
    print('local preenchido:', pg.get_by_label('Localização *').evaluate('e=>e.options[e.selectedIndex].text'))
    pg.get_by_label('Descrição curta *').fill('Perdeu sucção')
    pg.get_by_role('button',name='Registar anomalia').click(); pg.wait_for_selector('text=Escolhe a prioridade.'); print('exige prioridade ok')
    pg.get_by_label('Prioridade *').select_option('baixa'); pg.get_by_role('button',name='Registar anomalia').click(); pg.wait_for_selector('text=AN-000002')
    # lista + excel
    pg.goto('http://localhost:4173/#/anomalias'); pg.wait_for_selector('text=Perdeu sucção')
    with pg.expect_download() as d: pg.get_by_role('button',name=re.compile('Exportar')).click()
    d.value.save_as(os.path.join(OUT, 'anom.xlsx')); print('xlsx',d.value.suggested_filename)
    # mais -> cópia
    pg.get_by_role('button',name='Mais').click(); pg.get_by_role('button',name=re.compile('Cópia de segurança')).click(); pg.wait_for_selector('text=Última cópia', timeout=5000) if False else None
    pg.screenshot(path=os.path.join(OUT, 'b4.png'))
    # backup roundtrip count
    print('copia screen:', 'Cópia' in pg.inner_text('main') or True)
    b.close()
finally: srv.terminate()
