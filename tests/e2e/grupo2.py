"""Grupo 2: código de barras nos artigos, inspeção rápida, exportar tudo para Excel, ditado (simulado) e fotos partilhadas."""
import os
ROOT = os.environ['E2E_ROOT']; OUT = os.environ['E2E_DIR']; CHROME = os.environ.get('E2E_CHROME') or None
import subprocess, time, zipfile
from playwright.sync_api import sync_playwright
srv=subprocess.Popen(['npx','vite','preview','--port','4173','--strictPort'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
time.sleep(4)
U='http://localhost:4173/'
MOCK="""
window.BarcodeDetector=class{ static async getSupportedFormats(){return ['ean_13','code_128']} constructor(o){} async detect(){ return [{rawValue:sessionStorage.getItem('cod')||'5601234567890',format:'ean_13'}] } };
const VozFalsa=class{ start(){ setTimeout(()=>{ this.onresult&&this.onresult({resultIndex:0,results:[Object.assign([{transcript:sessionStorage.getItem('voz')||''}],{isFinal:true})]}); this.onend&&this.onend(); },300) } stop(){} abort(){} };
for (const k of ['SpeechRecognition','webkitSpeechRecognition']) Object.defineProperty(window,k,{value:VozFalsa,configurable:true,writable:true});
"""
def ok(cond, txt):
  print(('ok ' if cond else 'FALHA ')+txt)
  if not cond: raise SystemExit(1)
try:
  with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CHROME,args=['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'])
    ctx=b.new_context(viewport={'width':390,'height':900},permissions=['camera'],accept_downloads=True); pg=ctx.new_page()
    pg.add_init_script(MOCK)
    pg.on('pageerror',lambda e:print('PAGEERR',e)); pg.on('console',lambda m:print('CON',m.text[:200]) if m.type=='error' else None)
    pg.goto(U); pg.wait_for_selector('text=Office Manager')
    pg.get_by_role('button',name='Criar dados de exemplo').click(); pg.wait_for_selector('text=anomalia aberta')

    # 7 — EAN: código desconhecido → criar artigo com o código; depois ler abre para contar
    pg.goto(U+'#/stock'); pg.get_by_role('button',name='📷').click(); pg.wait_for_selector('text=Nenhum artigo com o código')
    pg.get_by_role('button',name='Criar artigo').click(); pg.wait_for_url('**/#/stock/novo?codigo=*')
    ok(pg.get_by_label('Código de barras').input_value()=='5601234567890', 'código vindo da leitura')
    pg.get_by_label('Nome *').fill('Café em grão'); pg.get_by_role('button',name='Criar artigo').click(); pg.wait_for_url('**/#/stock/*-*')
    pg.goto(U+'#/pesquisa'); pg.get_by_role('button',name='📷').click(); pg.wait_for_url('**contar=1')
    ok(pg.locator('h2').first.inner_text().startswith('AR-'), 'pesquisa por leitura abre o artigo')
    ok(pg.evaluate("document.activeElement && document.activeElement.inputMode==='decimal'"), 'teclado na quantidade')
    pg.keyboard.type('7'); pg.get_by_role('button',name='Registar contagem').click(); pg.wait_for_timeout(500)
    ok('7' in pg.locator('text=Stock').first.locator('xpath=..').inner_text(), 'contagem registada')

    # 8 — inspeção rápida
    pg.goto(U+'#/inspecoes'); pg.locator('select').first.select_option(label='Sala (exemplo)'); pg.get_by_role('button',name='Iniciar inspeção').click()
    pg.wait_for_url('**/#/inspecoes/*'); pg.get_by_role('button',name='⚡ Inspeção rápida (um de cada vez)').click()
    pg.wait_for_selector('text=Sair do modo rápido'); pg.wait_for_timeout(300)
    pg.screenshot(path=os.path.join(OUT,'g2-rapida.png'))
    ok(pg.locator('text=Router (exemplo)').count()>=1, 'mostra o equipamento em ecrã cheio')
    pg.get_by_role('button',name='⚠ Com problema').click(); pg.wait_for_selector('text=O que se passa?')
    pg.get_by_label('O que se passa?').fill('Luz vermelha acesa')
    pg.locator('input[type=file][capture]').set_input_files(os.path.join(OUT,'foto.jpg')); pg.wait_for_selector('text=Fotografias (1)',timeout=20000)
    pg.get_by_role('button',name='Criar anomalia agora (as fotos passam para ela)').click(); pg.wait_for_url('**/#/anomalias/nova*')
    ok(pg.locator('input').first.input_value()=='Luz vermelha acesa', 'anomalia com o texto da observação')
    pg.locator('select').nth(2).select_option('alta'); pg.get_by_role('button',name='Registar anomalia').click()
    pg.wait_for_url('**rapida=1'); pg.wait_for_selector('text=Todos avaliados')
    ok(True, 'voltou ao modo rápido e terminou')
    pg.get_by_role('button',name='Concluir inspeção').click(); pg.wait_for_selector('text=Concluída')
    pg.goto(U+'#/anomalias'); pg.get_by_text('Luz vermelha acesa').click(); pg.wait_for_selector('text=Fotografias (1)')
    ok(True, 'foto da inspeção passou para a anomalia')

    # 11 — tudo para Excel
    pg.goto(U+'#/relatorios')
    with pg.expect_download() as d: pg.get_by_role('button',name='Exportar tudo para Excel').click()
    caminho=os.path.join(OUT,d.value.suggested_filename); d.value.save_as(caminho)
    z=zipfile.ZipFile(caminho); folhas=[n for n in z.namelist() if n.startswith('xl/worksheets/sheet')]
    ok(len(folhas)>=28 and 'Café em grão' in ''.join(z.read(n).decode() for n in folhas), f'Excel com {len(folhas)} folhas')
    # 11b — stock para Excel: nomes de locais em vez de identificadores
    with pg.expect_download() as d2: pg.get_by_role('button',name='Exportar o stock para Excel').click()
    cs=os.path.join(OUT,d2.value.suggested_filename); d2.value.save_as(cs)
    zs=zipfile.ZipFile(cs); texto=''.join(zs.read(n).decode() for n in zs.namelist() if n.startswith('xl/'))
    ok(d2.value.suggested_filename.startswith('stock-') and 'Stock por local' in texto and 'Total por artigo' in texto,'ficheiro de stock com as duas folhas')
    ok('Café em grão' in texto and 'Abaixo do mínimo' in texto,'artigos e situação no ficheiro de stock')

    # 1 — ditado (reconhecimento simulado) com sugestão de local
    pg.evaluate("sessionStorage.setItem('voz','Tomada solta nos arrumos. Faz faísca')")
    pg.goto(U+'#/anomalias/nova'); pg.get_by_role('button',name='🎤 Ditar a anomalia').click(); pg.wait_for_selector('text=É este o local?')
    ok(pg.locator('input').first.input_value()=='Tomada solta nos arrumos.', 'título ditado')
    pg.get_by_role('button',name='Sim',exact=True).click()
    ok(pg.locator('select').first.locator('option:checked').inner_text()=='Arrumos (exemplo)', 'local confirmado')
    pg.evaluate("sessionStorage.setItem('voz','pedir pilhas')"); pg.goto(U); pg.wait_for_selector('text=Notas rápidas')
    pg.get_by_role('button',name='🎤 Ditar nota').click(); pg.wait_for_timeout(600)
    ok(pg.get_by_label('Nova nota').input_value()=='pedir pilhas', 'nota ditada')

    # 2 — fotos partilhadas (POST ao service worker, como o Android faz)
    pg.goto(U); pg.wait_for_function("navigator.serviceWorker.controller!==null || (location.reload(), false)",timeout=20000, polling=2000)
    with open(os.path.join(OUT,'foto.jpg'),'rb') as f: dados=list(f.read())
    estado=pg.evaluate("""async (bytes)=>{ const fd=new FormData(); fd.append('fotos', new File([new Uint8Array(bytes)],'a.jpg',{type:'image/jpeg'})); fd.append('fotos', new File([new Uint8Array(bytes)],'b.jpg',{type:'image/jpeg'}));
      const r=await fetch('./partilhar',{method:'POST',body:fd}); return r.url + ' ' + r.status }""", dados)
    print('resposta', estado)
    pg.goto(U+'#/anomalias/nova?partilha=1'); pg.wait_for_selector('text=Fotografias partilhadas (2)')
    pg.locator('input').first.fill('Mancha no teto'); pg.locator('select').first.select_option(index=1); pg.locator('select').nth(2).select_option('baixa')
    pg.get_by_role('button',name='Registar anomalia').click(); pg.wait_for_selector('text=Fotografias (2)',timeout=90000)
    ok(pg.evaluate("caches.has('om-partilha')")==False, 'área temporária limpa')
    pg.goto(U+'#/anomalias/nova?partilha=1'); pg.wait_for_timeout(800)
    ok(pg.locator('text=Fotografias partilhadas').count()==0, 'fotos não se repetem')
    b.close()
finally: srv.terminate()
