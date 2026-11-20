import os
ROOT = os.environ['E2E_ROOT']; OUT = os.environ['E2E_DIR']; CHROME = os.environ.get('E2E_CHROME') or None
import subprocess, time
from playwright.sync_api import sync_playwright
srv=subprocess.Popen(['npx','vite','preview','--port','4173','--strictPort'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
time.sleep(4)
MOCK="""
window.__codigo=sessionStorage.getItem('cod')||'IMB-7781'; let n=0;
window.BarcodeDetector=class{ static async getSupportedFormats(){return ['code_128','qr_code']} constructor(o){window.__formatos=o.formats} async detect(){ n++; return n>3?[{rawValue:window.__codigo,format:'code_128'}]:[] } };
"""
try:
  with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CHROME,args=['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'])
    ctx=b.new_context(viewport={'width':390,'height':900},permissions=['camera']); pg=ctx.new_page()
    pg.add_init_script(MOCK)
    pg.on('pageerror',lambda e:print('PAGEERR',e)); pg.on('console',lambda m:print('CON',m.text[:200]) if m.type=='error' else None)
    pg.goto('http://localhost:4173/'); pg.wait_for_selector('text=Office Manager')
    pg.get_by_role('button',name='Criar dados de exemplo').click(); pg.wait_for_selector('text=Alertas')
    pg.goto('http://localhost:4173/#/equipamentos/novo'); pg.get_by_label('Nome *').fill('Portátil teste')
    pg.locator('label:has-text("Nº de imobilizado")').get_by_role('button',name='📷').click()
    pg.wait_for_function("()=>document.querySelector('input[value=\"IMB-7781\"]')!==null || [...document.querySelectorAll('input')].some(i=>i.value==='IMB-7781')",timeout=10000)
    print('lido no campo: sim | formatos:', pg.evaluate("window.__formatos"))
    print('câmara parada:', pg.evaluate("[...document.querySelectorAll('video')].length"))
    pg.get_by_role('button',name='Criar equipamento').click(); pg.wait_for_timeout(800)
    # pesquisa por leitura abre o equipamento
    pg.goto('http://localhost:4173/#/pesquisa'); pg.get_by_role('button',name='📷').click()
    pg.wait_for_url('**/#/equipamentos/*',timeout=10000); print('pesquisa abriu:', pg.locator('h2').first.inner_text())
    # código desconhecido vai para a caixa de pesquisa
    pg.evaluate("sessionStorage.setItem('cod','DESCONHECIDO')"); pg.goto('http://localhost:4173/#/pesquisa'); pg.reload(); pg.get_by_role('button',name='📷').click(); pg.wait_for_timeout(2500)
    print('desconhecido na caixa:', pg.locator('input[type=search]').input_value())
    b.close()
finally: srv.terminate()
