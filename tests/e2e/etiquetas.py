import os
ROOT = os.environ['E2E_ROOT']; OUT = os.environ['E2E_DIR']; CHROME = os.environ.get('E2E_CHROME') or None
import subprocess, time, glob
from playwright.sync_api import sync_playwright
srv=subprocess.Popen(['npx','vite','preview','--port','4173','--strictPort'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
time.sleep(4)
U='http://localhost:4173/'
MOCK="window.BarcodeDetector=class{ static async getSupportedFormats(){return ['qr_code']} constructor(o){} async detect(){ return [{rawValue:sessionStorage.getItem('qr')||'',format:'qr_code'}] } };"
def ok(c,m):
    print(('ok ' if c else 'FALHA ')+m)
    if not c: raise SystemExit(1)
try:
  with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CHROME,args=['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'])
    ctx=b.new_context(viewport={'width':390,'height':900},permissions=['camera'],accept_downloads=True); pg=ctx.new_page()
    pg.add_init_script(MOCK); pg.on('pageerror',lambda e:print('PAGEERR',e))
    ids=[]
    for nome in ['Sala de pausa','Arquivo (piso -1)','Copa']:
        pg.goto(U+'#/locais/novo'); pg.get_by_label('Nome *').fill(nome); pg.get_by_role('button',name='Criar localização').click()
        pg.wait_for_url('**/#/locais/*-*'); ids.append(pg.url.split('/')[-1].split('?')[0])
    # PDF com as etiquetas de todos os locais
    pg.goto(U+'#/locais'); pg.wait_for_selector('text=Etiquetas QR para as portas (3)')
    with pg.expect_download() as d: pg.get_by_role('button',name='▦ Etiquetas QR para as portas (3)').click()
    pdf=os.path.join(OUT,'etiquetas.pdf'); d.value.save_as(pdf)
    ok(open(pdf,'rb').read(5)==b'%PDF-','PDF gerado')
    # os QR leem-se de verdade (leitor independente da app)
    # Cada etiqueta é recortada e lida à parte (8 por folha: 2 colunas × 4 linhas), para o leitor não se confundir com as vizinhas.
    subprocess.run(['pdftoppm','-r','200','-png',pdf,os.path.join(OUT,'etq')],check=True)
    import cv2
    lidos=set(); mm=200/25.4
    for f in glob.glob(os.path.join(OUT,'etq*.png')):
        img=cv2.imread(f)
        for i in range(8):
            x=int((10+(i%2)*95)*mm); y=int((13.5+(i//2)*67.5)*mm)
            rec=img[y:y+int(67.5*mm), x:x+int(60*mm)]
            for escala in (1,1.5,0.75):
                t,_,_=cv2.QRCodeDetector().detectAndDecode(cv2.resize(rec,None,fx=escala,fy=escala,interpolation=cv2.INTER_NEAREST))
                if t: lidos.add(t); break
    print('lidos:',len(lidos))
    ok(lidos=={U+'#/locais/'+i for i in ids},'os 3 QR do PDF leem-se e apontam para os locais certos')
    # etiqueta de um só local
    pg.goto(U+'#/locais/'+ids[0]); pg.wait_for_selector('[role=tablist]'); pg.wait_for_timeout(300); pg.get_by_role('tab',name='Editar').click(); pg.wait_for_timeout(800)
    pg.get_by_role('tab',name='Editar').click(); pg.get_by_role('button',name='▦ Etiqueta QR deste local').wait_for()
    with pg.expect_download() as d: pg.get_by_role('button',name='▦ Etiqueta QR deste local').click()
    ok(d.value.suggested_filename.startswith('etiquetas-locais-'),'etiqueta de um local')
    # o leitor da app abre o local
    pg.goto(U+'#/pesquisa'); pg.evaluate("v=>sessionStorage.setItem('qr',v)",U+'#/locais/'+ids[1])
    pg.get_by_role('button',name='📷').click(); pg.wait_for_url('**/#/locais/'+ids[1])
    pg.get_by_role('tab',name='Editar').click()
    ok(pg.get_by_label('Nome *').input_value()=='Arquivo (piso -1)','ler a etiqueta abre o local')
    b.close()
finally: srv.terminate()
print('etiquetas: PDF, QR legíveis, um local, leitor abre o local')
