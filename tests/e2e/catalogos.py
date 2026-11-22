import os
ROOT = os.environ['E2E_ROOT']; OUT = os.environ['E2E_DIR']; CHROME = os.environ.get('E2E_CHROME') or None
import subprocess, time
from playwright.sync_api import sync_playwright
srv=subprocess.Popen(['npx','vite','preview','--port','4173','--strictPort'],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
time.sleep(4)
falhas=[]
def ok(c,m):
    print(('ok ' if c else 'FALHA ')+m)
    if not c: falhas.append(m)
U='http://localhost:4173/'
try:
  with sync_playwright() as p:
    b=p.chromium.launch(executable_path=CHROME,args=['--no-sandbox'])
    ctx=b.new_context(viewport={'width':390,'height':900},permissions=['clipboard-read','clipboard-write'])
    pg=ctx.new_page(); pg.on('pageerror',lambda e:print('PAGEERR',e))
    # destinatário guardado pela versão anterior (localStorage) passa para a base de dados
    pg.goto(U); pg.evaluate("localStorage.setItem('om.havi.email','pedidos@exemplo.test')")  # privacy-ok (fictício)
    pg.goto(U+'#/encomendas'); pg.get_by_role('button',name='Caixas de encomenda (HAVI, Nespresso…)').click()
    pg.wait_for_selector('text=Caixas de encomenda')
    # a caixa única da HAVI passou a lista, e as caixas novas foram criadas
    for nome in ['HAVI','Nespresso','Delta']: pg.locator('p.font-semibold',has_text=nome).first.wait_for(timeout=5000)
    ok(True,'HAVI, Nespresso e Delta na lista')
    pg.locator('p.font-semibold',has_text='HAVI').click(); pg.wait_for_selector('text=Dia de entrega')
    pg.get_by_role('button',name='Definições').click()
    pg.wait_for_selector('text=pedidos@exemplo.test')  # privacy-ok (fictício)
    ok(True,'destinatário antigo migrado para a caixa HAVI')
    # catálogo: colar tabela (códigos sem pontos nem espaços, sem quantidades)
    pg.get_by_role('button',name='Catálogo (0)').click()
    pg.get_by_label('Tabela para importar').fill('WRIN Qtd Descrição\n10325001 2 cx SUMO PERA\n09211.780 1 pac TOALHETE\n2627 010 6 cx CHA PRETO')
    pg.get_by_role('button',name='Importar').click(); pg.wait_for_selector('text=Importados 3 produto(s)')
    ok(pg.get_by_role('button',name='Catálogo (3)').count()==1,'3 produtos importados')
    ok(pg.locator('text=09211780').count()==1 and pg.locator('text=2627010').count()==1,'códigos sem pontos nem espaços')
    # remover pede confirmação
    li=pg.locator('li',has_text='TOALHETE'); li.get_by_role('button',name='Remover').click()
    ok(pg.get_by_role('button',name='Catálogo (3)').count()==1,'um toque não remove')
    li.get_by_role('button',name='Remover mesmo').click(); pg.wait_for_selector('role=button[name="Catálogo (2)"]')
    ok(True,'segundo toque remove')
    # encomendar: quantidades ficam guardadas ao sair do ecrã
    pg.get_by_role('button',name='Encomendar').click()
    pg.get_by_label('Quantidade de CHA PRETO').fill('6')
    pg.get_by_role('button',name='Definições').click()
    pg.get_by_label('Novo destinatário').fill('copia@exemplo.test'); pg.get_by_role('button',name='Adicionar').click()  # privacy-ok (fictício)
    pg.wait_for_selector('text=copia@exemplo.test')  # privacy-ok (fictício)
    caixa=pg.url
    pg.goto(U+'#/mais'); pg.wait_for_selector('text=Versão da app'); pg.goto(caixa); pg.wait_for_selector('text=Dia de entrega')
    ok(pg.get_by_label('Quantidade de CHA PRETO').input_value()=='6','quantidade guardada ao sair')
    pg.get_by_role('button',name='Definições').click()
    ok(pg.locator('text=copia@exemplo.test').count()==1,'destinatário novo guardado')  # privacy-ok (fictício)
    pg.get_by_role('button',name='Encomendar').click()
    # dia de entrega: proposto e alterável (feriados); aviso fora de terça/sexta
    pg.get_by_label('Dia de entrega').fill('2026-12-02'); pg.wait_for_selector('text=só entrega terça e sexta')
    pg.get_by_label('Dia de entrega').fill('2026-12-04')
    ok(pg.locator('text=só entrega terça e sexta').count()==0,'sexta sem aviso')
    # texto próprio com {{data}} e {{produtos}}
    pg.get_by_role('button',name='Definições').click()
    pg.get_by_label('Texto do e-mail').fill('Bom dia,\nDescarga de dia {{data}}.\n{{produtos}}\nObrigado'); pg.get_by_label('Texto do e-mail').blur()
    pg.wait_for_timeout(300); pg.get_by_role('button',name='Encomendar').click()
    pg.get_by_label('Dia de entrega').fill('2026-12-04')
    pg.locator('summary',has_text='Ver o e-mail').click()
    corpo=pg.locator('details',has_text='Ver o e-mail').inner_text()
    ok('Descarga de dia 4 de dezembro.' in corpo and '2627010 --- 6 --- CHA PRETO' in corpo,'e-mail com a data e a linha do produto')
    # copiar regista o pedido; repetir repõe as quantidades
    pg.get_by_role('button',name='Copiar pedido').click(); pg.wait_for_selector('text=Texto do pedido copiado.')
    ok('2627010 --- 6 --- CHA PRETO' in pg.evaluate('navigator.clipboard.readText()'),'texto na área de transferência')
    pg.wait_for_selector('text=1 produto(s)')
    pg.get_by_role('button',name='Limpar quantidades').click()
    ok(pg.get_by_label('Quantidade de CHA PRETO').input_value()=='','quantidades limpas')
    pg.get_by_role('button',name='Repetir',exact=True).click()
    ok(pg.get_by_label('Quantidade de CHA PRETO').input_value()=='6','repetir o último pedido')
    pg.wait_for_timeout(400); pg.reload(); pg.wait_for_selector('text=Dia de entrega')
    ok(pg.get_by_label('Quantidade de CHA PRETO').input_value()=='6','quantidades mantêm-se ao recarregar')
    pg.get_by_role('button',name='Definições').click()
    ok('Descarga de dia' in pg.get_by_label('Texto do e-mail').input_value(),'texto próprio guardado')
    pg.get_by_role('button',name='Encomendar').click()
    # quantidades habituais e repetir o último pedido com um toque
    pg.get_by_role('button',name='Guardar estas quantidades como habituais').click(); pg.wait_for_selector('text=1 produto(s) com quantidade habitual')
    pg.get_by_role('button',name='Limpar quantidades').click()
    pg.get_by_role('button',name='Quantidades habituais').click()
    ok(pg.get_by_label('Quantidade de CHA PRETO').input_value()=='6','pedido preenchido com as habituais')
    pg.get_by_role('button',name='Limpar quantidades').click()
    pg.get_by_role('button',name='Repetir o último pedido').click()
    ok(pg.get_by_label('Quantidade de CHA PRETO').input_value()=='6','repetir o último pedido (botão de cima)')
    # lembrete na agenda, só para as caixas com dias de entrega
    pg.goto(U+'#/agenda'); pg.locator('text=Encomendar à HAVI para chegar').first.wait_for(timeout=5000)
    ok(pg.locator('text=Encomendar à Delta para chegar').count()==0,'lembrete da HAVI na agenda; Delta sem dias de entrega não avisa')
    # cada caixa tem o seu catálogo; o mesmo código pode existir nas duas
    pg.goto(U+'#/catalogos'); pg.locator('p.font-semibold',has_text='Delta').click()
    pg.get_by_role('button',name='Catálogo (0)').click()
    pg.get_by_label('Tabela para importar').fill('2627 010 6 cx CAFE DELTA')
    pg.get_by_role('button',name='Importar').click(); pg.wait_for_selector('text=Importados 1 produto(s)')
    ok(pg.locator('text=CAFE DELTA').count()==1 and pg.locator('text=CHA PRETO').count()==0,'catálogo da Delta à parte do da HAVI')
    # criar uma caixa nova e apagá-la
    pg.goto(U+'#/catalogos'); pg.get_by_role('button',name='Nova caixa').click()
    pg.get_by_label('Nome da caixa *').fill('Papelaria'); pg.get_by_role('button',name='Criar',exact=True).click()
    pg.wait_for_selector('text=Papelaria'); ok('/catalogos/' in pg.url,'caixa nova criada e aberta')
    pg.get_by_role('button',name='Definições').click(); pg.get_by_role('button',name='Apagar esta caixa').click()
    pg.get_by_role('button',name='Apagar mesmo').click(); pg.wait_for_selector('text=Caixas de encomenda')
    ok(pg.locator('p.font-semibold',has_text='Papelaria').count()==0,'caixa apagada')
    # anomalia → encomenda ligada
    pg.goto(U); pg.get_by_role('button',name='Criar dados de exemplo').click(); pg.wait_for_selector('text=anomalia aberta')
    pg.goto(U+'#/anomalias'); pg.get_by_text('Wi-Fi instável (exemplo)').click()
    pg.get_by_role('button',name='🛒 Criar encomenda para isto').click(); pg.wait_for_selector('text=Para a anomalia')
    pg.locator('select').last.select_option('__novo__'); pg.get_by_label('Nome do novo fornecedor *').fill('Ferragens (teste)')
    pg.get_by_role('button',name='Criar rascunho').click(); pg.wait_for_url('**/#/encomendas/*-*')
    pg.wait_for_selector('text=Compra para a anomalia')
    pg.locator('button',has_text='Compra para a anomalia').click(); pg.wait_for_selector('text=Compras')
    pg.locator('text=Ferragens (teste)').first.wait_for(timeout=5000)
    pg.get_by_text('criada (Ferragens (teste)).').first.wait_for(timeout=5000)
    ok(True,'encomenda no histórico da anomalia')
    b.close()
finally: srv.terminate()
if falhas: raise SystemExit('falhas: '+'; '.join(falhas))
print('catalogos: migração da HAVI, várias caixas, catálogo, quantidades, entrega, texto, copiar, repetir, habituais, lembrete e anomalia→encomenda')
