"""Grupo 4: leitor (ler de fotografia), ficha do equipamento em abas e desenhar nas fotos."""
import os
ROOT = os.environ['E2E_ROOT']; OUT = os.environ['E2E_DIR']; CHROME = os.environ.get('E2E_CHROME') or None
import subprocess, time
from playwright.sync_api import sync_playwright
srv=subprocess.Popen(['npx','vite','preview','--port','4173','--strictPort'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
time.sleep(4)
U='http://localhost:4173/'
# Câmara que nunca foca (vídeo não lê nada); só a fotografia tem código.
MOCK="""
window.BarcodeDetector=class{ static async getSupportedFormats(){return ['code_39','ean_13']} constructor(o){} async detect(src){ return (src instanceof HTMLVideoElement) ? [] : [{rawValue:'001777',format:'code_39'}] } };
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
    pg.get_by_role('button',name='Criar dados de exemplo').click(); pg.wait_for_selector('text=anomalia aberta')

    # Leitor: a câmara não lê; «Ler de uma fotografia» lê
    pg.goto(U+'#/equipamentos'); pg.get_by_text('Router (exemplo)').click(); pg.wait_for_selector('role=tab[name="Geral"]')
    ok(pg.get_by_role('tab',name='Geral').get_attribute('aria-selected')=='true', 'abre na aba Geral')
    pg.get_by_role('tab',name='Património').click()
    pg.locator('label:has-text("Nº de imobilizado")').get_by_role('button',name='📷').click(); pg.wait_for_selector('text=Ler de uma fotografia')
    pg.wait_for_timeout(1500)
    ok(pg.get_by_label('Nº de imobilizado').input_value()=='', 'vídeo sem foco não lê')
    pg.locator('input[type=file][capture]').last.set_input_files(os.path.join(OUT,'foto.jpg'))
    pg.wait_for_function("[...document.querySelectorAll('input')].some(i=>i.value==='001777')",timeout=15000)
    ok(True, 'lido a partir da fotografia')
    ok(pg.locator('text=Há alterações por guardar').count()==1, 'aviso de alterações por guardar')
    pg.get_by_role('tab',name='Técnico').click(); pg.wait_for_selector('text=Manutenção preventiva')
    ok(pg.locator('text=Há alterações por guardar').count()==1, 'alteração mantém-se ao mudar de aba')
    pg.get_by_role('button',name='Guardar alterações').click(); pg.wait_for_selector('text=Guardado.')
    ok(pg.locator('text=Há alterações por guardar').count()==0, 'guardado em qualquer aba')
    pg.get_by_role('tab',name='Histórico').click(); pg.wait_for_selector('text=Anomalia: Wi-Fi instável (exemplo)')
    ok(pg.locator('text=Registado na app').count()==1, 'histórico com registo e anomalia')
    pg.screenshot(path=os.path.join(OUT,'g4-historico.png'), full_page=True)
    pg.goto(U+'#/agenda'); pg.get_by_text('Fim da garantia: Router (exemplo)').first.click(); pg.wait_for_selector('role=tab[name="Património"][selected=true]')
    ok(True, 'alerta de garantia abre o Património')

    # Desenhar numa fotografia
    pg.get_by_role('tab',name='Geral').click()
    pg.locator('input[type=file][capture]').first.set_input_files(os.path.join(OUT,'foto.jpg')); pg.wait_for_selector('text=Fotografias (1)',timeout=60000)
    pg.get_by_role('button',name='Ver fotografia').click(); pg.get_by_role('button',name='✏️ Desenhar').click()
    cv=pg.get_by_label('Fotografia para desenhar'); pg.wait_for_timeout(500); bb=cv.bounding_box()
    pg.get_by_role('button',name='➚ Seta').click()
    pg.mouse.move(bb['x']+bb['width']*0.2,bb['y']+bb['height']*0.2); pg.mouse.down(); pg.mouse.move(bb['x']+bb['width']*0.6,bb['y']+bb['height']*0.6,steps=8); pg.mouse.up()
    pg.get_by_role('button',name='◯ Círculo').click()
    pg.mouse.move(bb['x']+bb['width']*0.5,bb['y']+bb['height']*0.5); pg.mouse.down(); pg.mouse.move(bb['x']+bb['width']*0.8,bb['y']+bb['height']*0.8,steps=8); pg.mouse.up()
    pg.screenshot(path=os.path.join(OUT,'g4-anotar.png'))
    pg.get_by_role('button',name='Guardar',exact=True).click(); pg.wait_for_selector('text=com desenhos',timeout=20000)
    ok(pg.locator('text=Fotografias (1)').count()==1, 'continua uma só fotografia')
    pg.get_by_role('button',name='↺ Repor original').click(); pg.wait_for_timeout(500)
    ok(pg.locator('text=com desenhos').count()==0, 'original reposta')
    b.close()
finally: srv.terminate()
