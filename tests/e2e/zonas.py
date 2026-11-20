import os
ROOT = os.environ['E2E_ROOT']; OUT = os.environ['E2E_DIR']; CHROME = os.environ.get('E2E_CHROME') or None
import subprocess, time, re
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw

# Plantas geradas na hora (nada real no repositório): uma "antiga" e a mesma a 2× com margem (a "nova").
def planta(l, a, escala=1, margem=0):
  im = Image.new('RGB', (l, a), 'white'); d = ImageDraw.Draw(im)
  def r(x0, y0, x1, y1): d.rectangle([margem + x0 * escala, margem + y0 * escala, margem + x1 * escala, margem + y1 * escala], outline='black', width=3 * escala)
  r(20, 20, 1980, 980); r(20, 20, 800, 500); r(800, 20, 1400, 500); r(20, 500, 900, 980)
  return im
planta(2000, 1000).save(os.path.join(OUT, 'planta-a.png'))
planta(4400, 2400, 2, 200).save(os.path.join(OUT, 'planta-b.png'))
Image.new('RGB', (11000, 10000), 'white').save(os.path.join(OUT, 'planta-enorme.png'))

srv = subprocess.Popen(['npx', 'vite', 'preview', '--port', '4173', '--strictPort'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(4)
try:
  with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
    pg = b.new_page(viewport={'width': 390, 'height': 860}, device_scale_factor=2.6, has_touch=True)
    pg.on('pageerror', lambda e: print('PAGEERR', e)); pg.on('console', lambda m: print('CON', m.text[:200]) if m.type == 'error' else None)
    pg.goto('http://localhost:4173/'); pg.wait_for_selector('text=Office Manager')
    pg.get_by_role('button', name='Criar dados de exemplo').click(); pg.wait_for_selector('text=Alertas')
    pg.goto('http://localhost:4173/#/locais'); pg.get_by_text('Sala (exemplo)').first.click(); pg.wait_for_selector('text=Planta')
    fich = pg.locator('input[type=file][accept*="pdf"]')
    fich.set_input_files(os.path.join(OUT, 'planta-enorme.png')); pg.wait_for_selector('text=o máximo para uma planta'); print('recusa >100 MP: True')
    fich.set_input_files(os.path.join(OUT, 'planta-a.png')); pg.wait_for_selector('text=Documentos (1)'); pg.wait_for_selector('img[alt=Planta]')
    pg.wait_for_selector('text=Imagem da planta: 2000×1000 px'); print('dimensões mostradas: True')
    im = pg.locator('img[alt=Planta]')
    def toca(fx, fy):
      bb = im.bounding_box(); im.click(position={'x': bb['width'] * fx, 'y': bb['height'] * fy})
    # ponto existente
    pg.get_by_label('Colocar na planta').select_option(index=1); toca(0.3, 0.4)
    mk = pg.locator('button[aria-label^="Marcador"]').first; mk.wait_for()
    estilo0 = mk.get_attribute('style'); print('marcador:', estilo0)
    pg.locator('main').click(position={'x': 5, 'y': 5})
    # nova zona: 4 cantos
    pg.get_by_role('button', name='+ Nova zona').click(); pg.get_by_label('Nome da zona').fill('Sala de reuniões')
    for fx, fy in [(0.2, 0.3), (0.45, 0.3), (0.45, 0.55), (0.2, 0.55)]: toca(fx, fy)
    print('pontos da zona:', pg.locator('button[aria-label^="Ponto "]').count())
    pg.get_by_role('button', name='Concluir zona').click(); pg.wait_for_selector('text=Zonas nesta planta (1)')
    print('marcador não mudou:', pg.locator('button[aria-label^="Marcador"]').first.get_attribute('style') == estilo0)
    pg.screenshot(path=os.path.join(OUT, 'zona-planta-inteira.png'))
    # abrir a zona tocando nela
    toca(0.40, 0.50); pg.wait_for_selector('text=← Planta inteira')
    zoom = int(re.search(r'Ampliar: (\d+)%', pg.inner_text('main')).group(1)); print('zoom da zona (ajustado a 25% da largura):', zoom, 300 < zoom < 400)
    print('nitidez:', pg.locator('text=/Nitidez/').first.inner_text())
    print('nome do ponto visível na zona:', pg.locator('button[aria-label^="Marcador"] span.bg-white\\/90').count())
    print('mascara:', pg.locator('svg path[fill-rule=evenodd]').count())
    pg.screenshot(path=os.path.join(OUT, 'zona-ampliada.png'))
    # editar: arrastar o 2.º ponto
    pg.get_by_role('button', name='Editar zona (nome e contorno)').click()
    v = pg.locator('button[aria-label="Ponto 2 da zona"]'); bb = v.bounding_box()
    cx, cy = bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2
    pg.mouse.move(cx, cy); pg.mouse.down(); pg.mouse.move(cx + 25, cy + 10, steps=6); pg.mouse.up()
    bb2 = v.bounding_box(); print('ponto arrastado:', round(bb2['x'] - bb['x']), round(bb2['y'] - bb['y']))
    pg.get_by_role('button', name='Guardar', exact=True).click(); pg.wait_for_selector('text=Zona guardada.')
    print('marcador continua igual:', pg.locator('button[aria-label^="Marcador"]').first.get_attribute('style') == estilo0)
    pg.get_by_role('button', name='← Planta inteira').last.click(); pg.wait_for_selector('text=Ampliar: 100%'); print('voltou à planta inteira: True')
    # contorno cruzado não grava
    pg.get_by_role('button', name='+ Nova zona').click(); pg.get_by_label('Nome da zona').fill('Laço')
    for fx, fy in [(0.6, 0.2), (0.8, 0.6), (0.8, 0.2), (0.6, 0.6)]: toca(fx, fy)
    print('cruzado bloqueado:', pg.get_by_text('As linhas cruzam-se').count() > 0, pg.get_by_role('button', name='Concluir zona').is_disabled())
    pg.get_by_role('button', name='Cancelar', exact=True).click()
    # trocar imagem com alinhamento: cantos do edifício (20,20) e (1980,980)
    fich.set_input_files(os.path.join(OUT, 'planta-b.png')); pg.wait_for_selector('text=Documentos (2)')
    pg.get_by_role('button', name=re.compile('Trocar para outra imagem')).click(); pg.wait_for_selector('text=Trocar imagem da planta')
    pg.get_by_label('Imagem nova').select_option(index=1)
    img = pg.locator('img[alt=Planta]').first
    def tocaImg(fx, fy):
      bb = img.bounding_box(); img.click(position={'x': bb['width'] * fx, 'y': bb['height'] * fy}); pg.wait_for_timeout(250)
    tocaImg(20 / 2000, 20 / 1000); tocaImg(1980 / 2000, 980 / 1000)
    print('cantos marcados:', pg.locator('span.bg-fuchsia-600').count())
    pg.get_by_role('button', name='Seguinte: imagem nova').click(); pg.wait_for_timeout(500)
    img = pg.locator('img[alt=Planta]').first
    tocaImg((200 + 40) / 4400, (200 + 40) / 2400); tocaImg((200 + 3960) / 4400, (200 + 1960) / 2400)
    pg.get_by_role('button', name='Ver como fica').click(); pg.wait_for_selector('text=/Escala ×/')
    print('previsão:', pg.locator('text=/Escala ×/').inner_text())
    pg.get_by_role('button', name='Confirmar troca').click(); pg.wait_for_selector('text=/Imagem trocada/')
    print(pg.locator('text=/Imagem trocada/').inner_text()[:90])
    pg.wait_for_selector('text=Imagem da planta: 4400×2400 px'); print('planta nova em uso: True')
    # o ponto ficou no mesmo sítio do edifício: (0.3,0.4) na antiga → (200+600·2)/4400, (200+400·2)/2400
    st = pg.locator('button[aria-label^="Marcador"]').first.get_attribute('style'); print('marcador na nova:', st)
    left = float(re.search(r'left: ([\d.]+)%', st).group(1)); top = float(re.search(r'top: ([\d.]+)%', st).group(1))
    print('alinhado:', abs(left - 100 * 1400 / 4400) < 0.6, abs(top - 100 * 1000 / 2400) < 0.6)
    print('zona passou:', pg.get_by_text('Zonas nesta planta (1)').count() == 1)
    b.close()
finally:
  srv.terminate()
