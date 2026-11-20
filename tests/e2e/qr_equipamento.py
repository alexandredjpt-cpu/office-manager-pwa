"""QR do fabricante no equipamento: reconhece campos, confirma, não substitui sem querer, e a Pesquisa encontra pelo nº de série."""
import os
ROOT = os.environ['E2E_ROOT']; OUT = os.environ['E2E_DIR']; CHROME = os.environ.get('E2E_CHROME') or None
import subprocess, time
from playwright.sync_api import sync_playwright
srv=subprocess.Popen(['npx','vite','preview','--port','4173','--strictPort'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
time.sleep(4)
U='http://localhost:4173/'
MOCK="""
window.BarcodeDetector=class{ static async getSupportedFormats(){return ['qr_code']} constructor(o){} async detect(){ return [{rawValue:sessionStorage.getItem('qr')||'Brand: Acme\\nModel: X-200\\nS/N: AB12345\\nVoltage: 230V',format:'qr_code'}] } };
"""
def ok(cond, txt):
  print(('ok ' if cond else 'FALHA ')+txt)
  if not cond: raise SystemExit(1)
try:
  with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CHROME,args=['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'])
    ctx=b.new_context(viewport={'width':390,'height':900},permissions=['camera']); pg=ctx.new_page()
    pg.add_init_script(MOCK)
    pg.on('pageerror',lambda e:print('PAGEERR',e)); pg.on('console',lambda m:print('CON',m.text[:200]) if m.type=='error' else None)
    pg.goto(U); pg.wait_for_selector('text=Office Manager')
    pg.goto(U+'#/equipamentos/novo'); pg.get_by_role('button',name='▦ Ler QR do equipamento').click(); pg.wait_for_selector('role=button[name="Preencher"]')
    ok(pg.locator('text=Marca: Acme').count()==1 and pg.locator('text=Nº de série: AB12345').count()==1, 'campos reconhecidos')
    pg.screenshot(path=os.path.join(OUT,'qr-modal.png'))
    pg.get_by_role('button',name='Preencher').click()
    ok(pg.get_by_label('Marca').input_value()=='Acme' and pg.get_by_label('Modelo').input_value()=='X-200', 'marca e modelo preenchidos')
    ok(pg.locator('label:has-text("Nº de série") input').first.input_value()=='AB12345', 'nº de série preenchido')
    pg.get_by_label('Nome *').fill('Impressora'); pg.get_by_role('button',name='Criar equipamento').click(); pg.wait_for_url('**/#/equipamentos/*-*')
    # equipamento existente: marca diferente não é substituída por defeito
    pg.evaluate("sessionStorage.setItem('qr','Brand: OutraMarca\\nS/N: AB12345')")
    pg.get_by_role('tab',name='Técnico').click(); pg.get_by_role('button',name='▦ Ler QR do equipamento').click(); pg.wait_for_selector('text=Substitui «Acme»')
    ok(not pg.get_by_role('checkbox').first.is_checked(), 'substituição desmarcada por defeito')
    pg.get_by_role('button',name='Preencher').click()
    ok(pg.get_by_label('Marca').input_value()=='Acme', 'marca mantida')
    # endereço web vai para as notas
    pg.evaluate("sessionStorage.setItem('qr','https://suporte.exemplo.com/p?model=X-200')")
    pg.get_by_role('button',name='▦ Ler QR do equipamento').click(); pg.wait_for_selector('text=endereço do fabricante')
    pg.get_by_role('button',name='Preencher').click(); pg.get_by_role('button',name='Guardar alterações').click(); pg.wait_for_selector('text=Guardado.')
    pg.get_by_role('tab',name='Geral').click()
    ok('QR do fabricante: https://suporte.exemplo.com' in pg.get_by_label('Notas').input_value(), 'endereço guardado nas notas')
    # pesquisa pelo QR
    pg.evaluate("sessionStorage.setItem('qr','Model: X-200\\nS/N: AB12345')")
    pg.goto(U+'#/pesquisa'); pg.get_by_role('button',name='📷').click(); pg.wait_for_url('**/#/equipamentos/*-*')
    ok(True, 'pesquisa pelo QR abre o equipamento')
    b.close()
finally: srv.terminate()
