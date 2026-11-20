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
    pg.goto('http://localhost:4173/#/fornecedores/novo'); pg.get_by_label('Nome *').fill('Papelaria T'); pg.get_by_role('button',name='Criar fornecedor').click(); pg.wait_for_selector('text=Papelaria T')
    pg.goto('http://localhost:4173/#/encomendas'); pg.get_by_role('button',name='Nova encomenda').click()
    pg.locator('[role=dialog] select').select_option(label='Papelaria T'); pg.get_by_role('button',name='Criar rascunho').click(); pg.wait_for_selector('text=EN-000001')
    pg.get_by_role('button',name=re.compile('Juntar da lista de compras')).click(); pg.wait_for_selector('text=Juntei')
    pg.get_by_role('button',name='Submeter para aprovação').click()
    pg.locator('[role=dialog] select').select_option(label='+ Novo contacto…')
    pg.locator('[role=dialog]').get_by_label('Nome *').fill('Chefe Teste'); pg.locator('[role=dialog]').get_by_label('E-mail').fill('chefe@exemplo.pt'); pg.locator('[role=dialog]').get_by_label(re.compile('Telefone')).fill('912345678')  # privacy-ok (dados fictícios)
    pg.locator('[role=dialog]').get_by_role('button',name='Submeter',exact=True).click()
    pg.wait_for_selector('text=Pedido de aprovação'); print('pendente com pedido:', 'Pendente de aprovação' in pg.inner_text('main'))
    print(pg.locator('textarea').first.input_value()[:90].replace('\n',' / '))
    print('whatsapp:', pg.locator('textarea').nth(1).input_value()[:80])
    print('botão whatsapp ativo:', pg.get_by_role('button',name=re.compile('2. Avisar por WhatsApp')).is_enabled())
    pg.get_by_role('button',name='Registar aprovação').first.click()
    print('prefill:', pg.locator('[role=dialog] input').first.input_value())
    pg.locator('[role=dialog]').get_by_role('button',name='Registar aprovação').click(); pg.wait_for_selector('text=Aprovada por Chefe Teste'); print('aprovada ok')
    pg.goto('http://localhost:4173/#/contactos'); pg.wait_for_selector('text=Chefe Teste'); print('contacto listado')
    b.close()
finally: srv.terminate()
