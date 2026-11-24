import os
ROOT = os.environ['E2E_ROOT']; OUT = os.environ['E2E_DIR']; CHROME = os.environ.get('E2E_CHROME') or None
import subprocess, time
from playwright.sync_api import sync_playwright
srv=subprocess.Popen(['npx','vite','preview','--port','4173','--strictPort'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
time.sleep(4)
U='http://localhost:4173/'
falhas=[]
def ok(c,m):
    print(('ok ' if c else 'FALHA ')+m)
    if not c: falhas.append(m)
try:
  with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CHROME,args=['--no-sandbox'])
    pg=b.new_context(viewport={'width':390,'height':900}).new_page(); pg.on('pageerror',lambda e:print('PAGEERR',e))
    # com dados de exemplo, para haver o que consultar
    pg.goto(U); pg.get_by_role('button',name='Criar dados de exemplo').click(); pg.wait_for_selector('text=anomalia aberta')
    pg.goto(U+'#/equipamentos'); pg.wait_for_selector('role=button[name="Novo equipamento"]')
    ok(True,'gestor vê o botão de criar')
    # passar a consulta
    pg.goto(U+'#/mais'); pg.get_by_role('button',name='Só consulta').wait_for()
    pg.get_by_role('button',name='Só consulta').click()
    pg.wait_for_selector('text=Modo de consulta: podes ver tudo')
    ok(True,'faixa de consulta em todos os ecrãs')
    pg.goto(U+'#/equipamentos'); pg.wait_for_selector('text=EQ-')
    ok(pg.get_by_role('button',name='Novo equipamento').count()==0,'botão de criar escondido')
    for rota,rotulo in [('#/anomalias','Nova anomalia'),('#/locais','Nova localização'),('#/contactos','Novo contacto')]:
        pg.goto(U+rota); pg.wait_for_timeout(300)
        ok(pg.get_by_role('button',name=rotulo).count()==0,f'{rotulo} escondido')
    # voltar a gestor devolve tudo
    pg.goto(U+'#/mais'); pg.get_by_role('button',name='Gestor').click()
    pg.wait_for_selector('text=Modo de consulta: podes ver tudo',state='detached')
    pg.goto(U+'#/equipamentos'); pg.wait_for_selector('role=button[name="Novo equipamento"]')
    ok(True,'voltar a gestor devolve os botões')
    b.close()
finally: srv.terminate()
if falhas: raise SystemExit('falhas: '+'; '.join(falhas))
print('papel: gestor vê tudo, consulta esconde criar e mostra a faixa')
