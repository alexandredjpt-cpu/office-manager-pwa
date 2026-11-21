"""Grupo 3: contactar a partir da anomalia, fotos antes/depois, assinatura da inspeção e relatório do período."""
import os
ROOT = os.environ['E2E_ROOT']; OUT = os.environ['E2E_DIR']; CHROME = os.environ.get('E2E_CHROME') or None
import subprocess, time
from playwright.sync_api import sync_playwright
srv=subprocess.Popen(['npx','vite','preview','--port','4173','--strictPort'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
time.sleep(4)
U='http://localhost:4173/'
def ok(cond, txt):
  print(('ok ' if cond else 'FALHA ')+txt)
  if not cond: raise SystemExit(1)
def pdf_texto(caminho):
  return subprocess.run(['pdftotext','-layout',caminho,'-'],capture_output=True,text=True).stdout
try:
  with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CHROME,args=['--no-sandbox'])
    ctx=b.new_context(viewport={'width':390,'height':900},accept_downloads=True); pg=ctx.new_page()
    pedidos=[]
    ctx.route('https://wa.me/**', lambda r: (pedidos.append(r.request.url), r.abort()))
    pg.on('pageerror',lambda e:print('PAGEERR',e)); pg.on('console',lambda m:print('CON',m.text[:200]) if m.type=='error' and 'wa.me' not in m.text and 'ERR_FAILED' not in m.text else None)
    pg.goto(U); pg.wait_for_selector('text=Office Manager')
    pg.get_by_role('button',name='Criar dados de exemplo').click(); pg.wait_for_selector('text=anomalia aberta')

    # contacto com telefone
    pg.goto(U+'#/contactos/novo'); pg.get_by_label('Nome *').fill('Rui Técnico'); pg.get_by_label('Função').fill('Técnico AVAC'); pg.get_by_label('Telefone / WhatsApp').fill('912345678')  # privacy-ok (fictício)
    pg.get_by_role('button',name='Criar contacto').click(); pg.wait_for_timeout(500)

    # 18 — contactar a partir da anomalia
    pg.goto(U+'#/anomalias'); pg.get_by_text('Wi-Fi instável (exemplo)').click(); pg.wait_for_selector('text=Contactar fornecedor ou técnico')
    pg.get_by_label('A quem').select_option(label='Rui Técnico — Técnico AVAC')
    ok(pg.get_by_role('button',name='📞 Ligar').is_enabled(), 'ligar disponível')
    ok('Olá Rui Técnico' in pg.get_by_label('Mensagem do WhatsApp').input_value(), 'mensagem preenchida')
    pg.get_by_role('button',name='💬 WhatsApp').click(); pg.wait_for_timeout(1500)
    ok(any('wa.me/351912345678' in u for u in pedidos), 'abre o WhatsApp com o número certo')  # privacy-ok (fictício)
    pg.goto(U+'#/anomalias'); pg.get_by_text('Wi-Fi instável (exemplo)').click(); pg.wait_for_selector('text=Histórico')
    ok(pg.locator('text=WhatsApp aberto para Rui Técnico').count()==1, 'nota no histórico')

    # 9 — fotos antes e depois
    pg.locator('input[type=file][capture]').first.set_input_files(os.path.join(OUT,'foto.jpg')); pg.wait_for_selector('text=Fotografias (1)',timeout=60000)
    ok(pg.locator('text=Depois da intervenção').count()==0, 'sem secção depois enquanto por resolver')
    pg.get_by_role('button',name='Passar a «Em intervenção»').click(); pg.wait_for_selector('text=Depois da intervenção')
    pg.locator('input[type=file][capture]').nth(1).set_input_files(os.path.join(OUT,'foto.jpg')); pg.wait_for_selector('text=Depois da intervenção (1)',timeout=60000)
    ok(pg.locator('text=Fotografias (antes) (1)').count()==1, 'antes e depois separados')
    with pg.expect_download() as d: pg.get_by_role('button',name='Gerar PDF desta anomalia').click()
    c=os.path.join(OUT,'g3-anomalia.pdf'); d.value.save_as(c); t=pdf_texto(c)
    ok('Antes e depois' in t, 'PDF com antes e depois lado a lado')

    # 16 — assinatura
    pg.goto(U+'#/inspecoes'); pg.locator('select').first.select_option(label='Sala (exemplo)'); pg.get_by_role('button',name='Iniciar inspeção').click(); pg.wait_for_url('**/#/inspecoes/*')
    pg.get_by_role('button',name='Conforme',exact=True).first.click(); pg.wait_for_timeout(300)
    pg.get_by_role('button',name='✍ Assinar').click()
    pg.get_by_label('Nome de quem assina *').fill('Ana Silva')
    cv=pg.get_by_label('Quadro de assinatura'); bb=cv.bounding_box()
    pg.mouse.move(bb['x']+20,bb['y']+80); pg.mouse.down()
    for k in range(1,30): pg.mouse.move(bb['x']+20+k*9,bb['y']+80+(25 if k%2 else -25))
    pg.mouse.up()
    pg.get_by_role('button',name='Guardar',exact=True).click(); pg.wait_for_selector('text=Assinatura guardada')
    pg.screenshot(path=os.path.join(OUT,'g3-assinatura.png'), full_page=True)
    pg.get_by_role('button',name='Concluir inspeção').click(); pg.wait_for_selector('text=Concluída')
    ok(pg.locator('text=Assinar').count()==0 and pg.locator('img[alt^="Assinatura"]').count()==1, 'assinatura fica só de leitura')
    with pg.expect_download() as d: pg.get_by_role('button',name='Gerar PDF desta inspeção').click()
    c=os.path.join(OUT,'g3-inspecao.pdf'); d.value.save_as(c); t=pdf_texto(c)
    ok('Assinatura' in t and 'Ana Silva' in t, 'PDF da inspeção com assinatura')

    # 17 — relatório do período
    pg.goto(U+'#/relatorios'); pg.get_by_label('Período').select_option('semana_atual')
    with pg.expect_download() as d: pg.get_by_role('button',name='Gerar PDF do período').click()
    c=os.path.join(OUT,d.value.suggested_filename); d.value.save_as(c); t=pdf_texto(c)
    ok('Relatório do período' in t and 'Wi-Fi instável' in t and 'Inspeções concluídas: 1' in t, 'PDF do período com anomalias e inspeção')
    b.close()
finally: srv.terminate()
