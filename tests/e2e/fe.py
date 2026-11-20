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
    pg.goto('http://localhost:4173/#/equipamentos'); pg.get_by_text('EQ-000001').first.click(); pg.get_by_role('tab',name='Técnico').click(); pg.wait_for_selector('text=Documentos (0)')
    pg.locator('input[type=file][accept*="pdf"]').set_input_files(os.path.join(OUT, 'doc.pdf')); pg.wait_for_selector('text=Documentos (1)'); print('documento anexado:', 'doc.pdf' in pg.inner_text('main'))
    pg.locator('input[type=file][accept*="pdf"]').set_input_files(os.path.join(OUT, 'foto.jpg')); pg.wait_for_selector('text=Documentos (2)')
    # fornecedor + encomenda + email
    pg.goto('http://localhost:4173/#/fornecedores/novo'); pg.get_by_label('Nome *').fill('Papelaria Teste'); pg.get_by_label('Pessoa de contacto').fill('Ana'); pg.get_by_role('button',name='Criar fornecedor').click(); pg.wait_for_selector('text=Papelaria Teste')
    pg.goto('http://localhost:4173/#/encomendas'); pg.get_by_role('button',name='Nova encomenda').click()
    pg.locator('[role=dialog] select').select_option(label='Papelaria Teste'); pg.get_by_role('button',name='Criar rascunho').click(); pg.wait_for_selector('text=EN-000001')
    pg.get_by_role('button',name=re.compile('Juntar da lista de compras')).click(); pg.wait_for_selector('text=Juntei')
    pg.get_by_role('button',name=re.compile('Preparar e-mail')).click(); pg.wait_for_selector('text=Modelo')
    print(pg.locator('textarea').first.input_value()[:160].replace('\n',' / '))
    print('assunto:', pg.locator('input').filter(has_text='').nth(0).count()>=0)
    pg.get_by_role('button',name='Copiar texto').click()
    # modelos
    pg.goto('http://localhost:4173/#/modelos'); pg.get_by_role('button',name='Duplicar').first.click(); pg.get_by_role('button',name='Guardar',exact=True).click(); pg.wait_for_selector('text=Pedido de encomenda (meu)'); print('modelo duplicado')
    # copia leve
    pg.goto('http://localhost:4173/#/copia'); 
    with pg.expect_download() as d: pg.get_by_role('button',name=re.compile('Cópia leve')).click()
    print('ficheiro:', d.value.suggested_filename)
    b.close()
finally: srv.terminate()
