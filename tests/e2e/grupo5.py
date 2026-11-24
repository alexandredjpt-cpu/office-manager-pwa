"""Grupo 5: documentos ligados a vários registos (com categorias) e sugestão de compra trimestral."""
import os
ROOT = os.environ['E2E_ROOT']; OUT = os.environ['E2E_DIR']; CHROME = os.environ.get('E2E_CHROME') or None
import subprocess, time, re
from playwright.sync_api import sync_playwright
srv = subprocess.Popen(['npx', 'vite', 'preview', '--port', '4173', '--strictPort'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(4)
U = 'http://localhost:4173/'
def ok(cond, txt):
  print(('ok ' if cond else 'FALHA ') + txt)
  if not cond: raise SystemExit(1)
try:
  with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 390, 'height': 900}, accept_downloads=True); pg = ctx.new_page()
    pg.on('pageerror', lambda e: print('PAGEERR', e)); pg.on('console', lambda m: print('CON', m.text[:200]) if m.type == 'error' else None)
    pg.goto(U); pg.wait_for_selector('text=Office Manager')
    pg.get_by_role('button', name='Criar dados de exemplo').click(); pg.wait_for_selector('text=Alertas')

    # 3 cadeiras iguais
    ids = []
    for i in range(3):
      pg.goto(U + '#/equipamentos/novo'); pg.get_by_label('Nome *').fill('Cadeira'); pg.get_by_label('Marca').fill('Marca X'); pg.get_by_label('Modelo').fill('M1')
      pg.get_by_role('button', name='Criar equipamento').click(); pg.wait_for_url('**/#/equipamentos/*-*'); ids.append(pg.url.split('/')[-1].split('?')[0])

    # documento com categoria, ligado aos iguais sem copiar
    pg.goto(U + f'#/equipamentos/{ids[0]}?aba=tecnico'); pg.wait_for_selector('text=Documentos (0)')
    pg.get_by_label('Categoria dos documentos a anexar').select_option('manual')
    pg.locator('input[type=file][accept*="pdf"]').set_input_files(os.path.join(OUT, 'doc.pdf')); pg.wait_for_selector('text=Documentos (1)')
    ok(pg.get_by_label('Categoria de doc.pdf').input_value() == 'manual', 'categoria escolhida ao anexar')
    pg.get_by_role('button', name='Ligar a outros').click()
    pg.get_by_role('button', name=re.compile('Escolher os iguais a este \\(2')).click()
    pg.get_by_role('button', name='Ligar a 2').click(); pg.wait_for_selector('text=Ligado a mais 2 registo(s).')
    pg.goto(U + f'#/equipamentos/{ids[2]}?aba=tecnico'); pg.wait_for_selector('text=Documentos (1)')
    pg.get_by_text(re.compile('Anexado em EQ-')).first.wait_for(timeout=5000)
    ok(pg.get_by_text(re.compile('Anexado em EQ-')).count() == 1, 'documento aparece na outra cadeira, ligado')
    pg.get_by_role('button', name='Tirar daqui').click(); pg.locator('[role=dialog]').get_by_role('button', name='Tirar daqui').click(); pg.wait_for_selector('text=Documentos (0)')
    pg.goto(U + f'#/equipamentos/{ids[0]}?aba=tecnico'); pg.wait_for_selector('text=/Também ligado a 1/'); ok(True, 'tirar só desliga essa cadeira')
    # ligar a um local
    pg.get_by_role('button', name='Ligar a outros').click(); pg.get_by_label('Tipo de registo').select_option('localizacao')
    pg.locator('[role=dialog] label').filter(has_text='Sala (exemplo)').locator('input').check(); pg.get_by_role('button', name='Ligar a 1').click(); pg.wait_for_selector('text=Ligado a mais 1 registo(s).')
    pg.goto(U + '#/locais'); pg.get_by_text('Sala (exemplo)').first.click(); pg.wait_for_selector('[role=tablist]'); pg.get_by_role('tab', name='Editar').click(); pg.wait_for_selector('text=/Anexado em EQ-/'); ok(True, 'aparece também no local')
    ok(pg.locator('img[alt=Planta]').count() == 0, 'documento ligado não vira planta do local')

    # sugestão trimestral
    pg.goto(U + '#/stock?ver=sugestao'); pg.wait_for_selector('text=/descidas entre contagens/')
    ok(pg.get_by_text('Ainda não há contagens suficientes').count() == 1, 'sem dados: não inventa números')
    ok(pg.get_by_text(re.compile('Sem dados suficientes \\(')).count() == 1, 'lista os artigos sem dados')
    b.close()
finally:
  srv.terminate()
