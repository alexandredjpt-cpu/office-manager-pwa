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
    # B1
    pg.goto('http://localhost:4173/#/fornecedores/novo'); pg.get_by_label('Nome *').fill('Papelaria Exemplar'); pg.get_by_label('NIF').fill('123456780')
    pg.get_by_label('Morada').fill('Rua Fictícia 1'); pg.get_by_label('Prazo de pagamento').fill('30 dias')
    pg.locator('div.cartao').first.get_by_role('button').last.click(); pg.wait_for_timeout(400)
    print('B1 erro NIF:', pg.get_by_text('NIF inválido').count()>0)
    pg.get_by_label('NIF').fill('501964843'); pg.locator('div.cartao').first.get_by_role('button').last.click(); pg.wait_for_timeout(800)
    print('B1 url:',pg.url.split('#')[1][:14], '| histórico:', pg.get_by_text('Histórico de compras').count())
    # B2: preparar e-mail da anomalia (intercept navigation)
    pg.add_init_script("")
    pg.goto('http://localhost:4173/#/anomalias'); pg.locator('main li button').first.click(); pg.wait_for_selector('text=Preparar e-mail')
    pg.get_by_role('button',name=re.compile('Preparar e-mail')).click()
    pg.locator('select:has(option:text-is("Escolho na app de e-mail"))').select_option(label='Papelaria Exemplar')
    pg.route('**/*', lambda r: r.continue_())
    pg.evaluate("window.__href=null; Object.defineProperty(window,'location',{configurable:true,value:{...window.location}})") if False else None
    pg.get_by_role('button',name='Abrir na app de e-mail').click(); pg.wait_for_timeout(800)
    pg.goto('http://localhost:4173/#/emails'); pg.wait_for_selector('text=E-mails preparados'); pg.wait_for_timeout(300)
    print('B2 registos:', pg.locator('main li').count(), pg.locator('main li').first.inner_text().replace('\n',' | ')[:120] if pg.locator('main li').count() else '')
    # B3
    pg.goto('http://localhost:4173/#/agenda'); pg.get_by_role('tab',name='Mês').click()
    print('B3 células:', pg.locator('button[aria-label^="Dia "]').count())
    pg.get_by_role('button',name='Mês seguinte').click(); pg.get_by_role('tab',name='Semana').click()
    print('B3 semana dias:', pg.locator('section h3').count())
    pg.reload(); pg.wait_for_selector('text=Agenda'); print('B3 vista lembrada:', pg.get_by_role('tab',name='Semana').get_attribute('aria-selected'))
    # B4
    pg.goto('http://localhost:4173/#/locais'); pg.get_by_text('Sala (exemplo)').first.click(); pg.wait_for_selector('[role=tablist]'); pg.get_by_role('tab', name='Editar').click(); pg.get_by_placeholder('Ex.: 0, 1, Cave').fill('1')
    pg.get_by_role('button',name='Guardar alterações').click(); pg.wait_for_timeout(800); print('B4 msgs:', pg.locator('[role=status], .text-red-800, .text-teal-900').all_inner_texts()[:3])
    pg.goto('http://localhost:4173/#/locais'); pg.wait_for_timeout(600); print('B4 linha:', pg.get_by_text('Divisão · Piso 1').count()); pg.get_by_label('Piso').select_option('1')
    print('B4 locais piso 1:', pg.locator('main li').count())
    pg.goto('http://localhost:4173/#/relatorios'); pg.get_by_label('Piso das inspeções').select_option('1')
    with pg.expect_download() as d: pg.locator('div.cartao:has(h3:text-is("Histórico de inspeções"))').get_by_role('button',name='Gerar PDF').click()
    print('B4 pdf:', d.value.suggested_filename)
    b.close()
finally: srv.terminate()
