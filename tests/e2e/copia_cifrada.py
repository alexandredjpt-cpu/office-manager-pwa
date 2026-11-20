import os
ROOT = os.environ['E2E_ROOT']; OUT = os.environ['E2E_DIR']; CHROME = os.environ.get('E2E_CHROME') or None
import subprocess, time
from playwright.sync_api import sync_playwright
srv=subprocess.Popen(['npx','vite','preview','--port','4173','--strictPort'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
time.sleep(4)
try:
  with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CHROME,args=['--no-sandbox'])
    ctx=b.new_context(viewport={'width':390,'height':900},accept_downloads=True); pg=ctx.new_page()
    pg.add_init_script("Object.defineProperty(navigator,'canShare',{value:undefined}); Object.defineProperty(navigator,'share',{value:undefined});")
    pg.on('pageerror',lambda e:print('PAGEERR',e))
    pg.goto('http://localhost:4173/'); pg.wait_for_selector('text=Office Manager')
    pg.get_by_role('button',name='Criar dados de exemplo').click(); pg.wait_for_selector('text=Alertas')
    pg.goto('http://localhost:4173/#/copia'); pg.get_by_text('Proteger a cópia com palavra-passe').click()
    pg.get_by_label('Palavra-passe',exact=True).fill('segredo-123'); pg.get_by_label('Repetir palavra-passe').fill('outra-coisa')
    pg.get_by_role('button',name='Cópia leve (sem documentos)').click(); pg.wait_for_selector('text=não são iguais')
    pg.get_by_label('Repetir palavra-passe').fill('segredo-123')
    with pg.expect_download() as d: pg.get_by_role('button',name='Cópia leve (sem documentos)').click()
    nome=d.value.suggested_filename; caminho=os.path.join(OUT,nome); d.value.save_as(caminho)
    assert nome.endswith('-cifrada.omc'), nome
    with open(caminho,'rb') as f: assert f.read(8)==b'OMCIFRA1'
    pg.goto('http://localhost:4173/#/copia'); pg.locator('input[type=file]').set_input_files(caminho)
    pg.wait_for_selector('text=Cópia protegida'); pg.get_by_label('Palavra-passe da cópia').fill('errada-123'); pg.get_by_role('button',name='Abrir').click()
    pg.wait_for_selector('text=Palavra-passe errada')
    pg.get_by_label('Palavra-passe da cópia').fill('segredo-123'); pg.get_by_role('button',name='Abrir').click()
    pg.wait_for_selector('text=Substituir todos os dados?'); pg.get_by_role('button',name='Substituir').click(); pg.wait_for_selector('text=Restauro concluído.')
    print('cópia cifrada: exporta .omc, recusa palavra-passe errada, restaura com a certa')
    b.close()
finally: srv.terminate()
