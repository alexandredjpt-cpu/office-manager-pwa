import os
ROOT = os.environ['E2E_ROOT']; OUT = os.environ['E2E_DIR']; CHROME = os.environ.get('E2E_CHROME') or None
import subprocess, time, re
from playwright.sync_api import sync_playwright
srv=subprocess.Popen(['npx','vite','preview','--port','4173','--strictPort'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
time.sleep(4)
try:
  with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CHROME,args=['--no-sandbox'])
    ctx=b.new_context(viewport={'width':390,'height':900},accept_downloads=True); pg=ctx.new_page()
    pg.add_init_script("Object.defineProperty(navigator,'canShare',{value:undefined}); Object.defineProperty(navigator,'share',{value:undefined});")
    pg.on('pageerror',lambda e:print('PAGEERR',e)); pg.on('console',lambda m:print('CON',m.text[:200]) if m.type=='error' else None)
    pg.goto('http://localhost:4173/'); pg.wait_for_selector('text=Office Manager')
    pg.get_by_role('button',name='Criar dados de exemplo').click(); pg.wait_for_selector('text=Alertas')
    # A1
    pg.goto('http://localhost:4173/#/relatorios'); pg.wait_for_selector('text=Diferenças entre contagens')
    card=pg.locator('div.cartao:has(h3:text-is("Diferenças entre contagens"))')
    card.get_by_role('checkbox').check()
    with pg.expect_download() as d: card.get_by_role('button',name='PDF').click()
    print('A1 pdf:',d.value.suggested_filename)
    with pg.expect_download() as d: card.get_by_role('button',name='Excel').click()
    print('A1 xlsx:',d.value.suggested_filename)
    # A2: fornecedor + documento
    pg.goto('http://localhost:4173/#/fornecedores/novo'); pg.get_by_label('Nome *').fill('Papelaria Exemplar'); pg.get_by_label('Nome *').locator('xpath=ancestor::div[contains(@class,"cartao")]').get_by_role('button').first.click(); pg.wait_for_timeout(800)
    pg.goto('http://localhost:4173/#/fornecedores'); pg.get_by_text('Papelaria Exemplar').first.click(); pg.wait_for_selector('text=Documentos')
    pg.locator('input[type=file][accept*="pdf"]').set_input_files(os.path.join(OUT, 'doc.pdf')); pg.wait_for_timeout(800)
    pg.goto('http://localhost:4173/#/pesquisa')
    pg.locator('input[type=search]').fill('exempl'); pg.wait_for_timeout(400)
    print('A2 grupos:',pg.locator('h3').all_inner_texts())
    pg.locator('input[type=search]').fill('doc'); pg.wait_for_timeout(300); print('A2 doc:',pg.locator('h3').all_inner_texts())
    # A3
    pg.goto('http://localhost:4173/#/locais'); pg.get_by_text('Sala (exemplo)').first.click(); pg.wait_for_selector('[role=tablist]'); pg.get_by_role('tab',name='O que tem').click(); 
    pg.get_by_role('button',name='🔍 Iniciar inspeção deste local').click(); pg.get_by_role('dialog').get_by_role('button',name='Iniciar').click()
    pg.wait_for_url(re.compile('#/inspecoes/')); print('A3 inspeção aberta:',pg.url.split('#')[1][:12])
    pg.go_back(); pg.wait_for_selector('text=Continuar inspeção em curso'); print('A3 continuar: ok')
    # A4: planta do Arrumos com ponto do local Sala
    pg.goto('http://localhost:4173/#/locais'); pg.get_by_text('Arrumos (exemplo)').first.click(); pg.wait_for_selector('[role=tablist]'); pg.get_by_role('tab',name='Editar').click(); pg.wait_for_selector('text=Documentos')
    pg.locator('input[type=file][accept*="pdf"]').set_input_files(os.path.join(OUT, 'foto.jpg')); pg.wait_for_selector('img[alt=Planta]')
    pg.get_by_label('Colocar na planta').select_option(label='Sala (exemplo)')
    im=pg.locator('img[alt=Planta]'); box=im.bounding_box(); im.click(position={'x':box['width']*0.5,'y':box['height']*0.5})
    pg.wait_for_selector('text=Abrir local'); print('A4 inventário:',pg.locator('ul.max-h-48 li').all_inner_texts() or pg.get_by_text('Sem artigos contados').count())
    # A5: e-mail na anomalia
    pg.goto('http://localhost:4173/#/anomalias'); pg.locator('main li button').first.click(); pg.wait_for_selector('text=Preparar e-mail')
    pg.get_by_role('button',name=re.compile('Preparar e-mail')).click()
    print('A5 assunto:',pg.get_by_label('Assunto').input_value())
    n=len(pg.get_by_label('Modelo').locator('option').all_inner_texts()); print('A5 modelos:',n)
    b.close()
finally: srv.terminate()
