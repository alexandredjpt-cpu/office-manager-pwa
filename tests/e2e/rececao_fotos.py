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
    # encomenda até «encomendada» (fornecedor → rascunho → pendente → aprovada → encomendada)
    pg.goto('http://localhost:4173/#/fornecedores/novo'); pg.get_by_label('Nome *').fill('Papelaria R'); pg.get_by_role('button',name='Criar fornecedor').click(); pg.wait_for_selector('text=Papelaria R')
    pg.goto('http://localhost:4173/#/encomendas'); pg.get_by_role('button',name='Nova encomenda').click()
    pg.locator('[role=dialog] select').select_option(label='Papelaria R'); pg.get_by_role('button',name='Criar rascunho').click(); pg.wait_for_selector('text=EN-000001')
    pg.get_by_role('button',name=re.compile('Juntar da lista de compras')).click(); pg.wait_for_selector('text=Juntei')
    pg.get_by_role('button',name='Submeter para aprovação').click()
    for _ in range(5):
        pg.locator('[role=dialog] select').select_option(label='+ Novo contacto…')
        try: pg.locator('[role=dialog]').get_by_label('Nome *').wait_for(timeout=2000); break
        except Exception: pass
    pg.locator('[role=dialog]').get_by_label('Nome *').fill('Chefe Teste')
    pg.locator('[role=dialog]').get_by_role('button',name='Submeter',exact=True).click(); pg.wait_for_selector('text=Pendente de aprovação')
    pg.get_by_role('button',name='Registar aprovação').first.click()
    pg.locator('[role=dialog]').get_by_role('button',name='Registar aprovação').click(); pg.wait_for_selector('text=Aprovada por Chefe Teste')
    pg.get_by_role('button',name=re.compile('Marcar como encomendada')).click(); pg.wait_for_selector('text=Registar receção')
    # receção parcial com local
    pg.locator('input[placeholder=Aceite]').first.fill('1')
    pg.get_by_label('Local onde entra o stock aceite').select_option(index=1)
    pg.get_by_role('button',name='Registar receção').click(); pg.wait_for_selector('text=Receção registada.')
    pg.wait_for_selector('text=Receções registadas'); print('cartão das receções visível')
    # foto da fatura presa à receção
    cartao=pg.locator('div.cartao:has(h3:text-is("Receções registadas"))')
    cartao.locator('input[type=file][multiple]').set_input_files(os.path.join(OUT,'foto.jpg'))
    pg.wait_for_selector('text=Fatura ou guia (1)',timeout=20000); print('foto anexada à receção')
    cartao.locator('input[type=file][multiple]').set_input_files(os.path.join(OUT,'foto.jpg'))
    pg.wait_for_selector('text=Fatura ou guia (2)'); print('segunda foto ok')
    # sobrevive a recarregar
    pg.reload(); pg.wait_for_selector('text=Fatura ou guia (2)'); print('fotos persistem após recarregar')
    b.close()
finally: srv.terminate()
