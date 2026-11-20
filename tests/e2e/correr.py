"""Testes no navegador (Playwright) sobre o build de produção. Só manual: `npm run e2e`.

Requisitos: `pip install playwright` e `python -m playwright install chromium`
(ou E2E_CHROME=/caminho/para/chrome). Corre cada cenário com a app servida por `vite preview`.
Uso: python3 -I tests/e2e/correr.py [cenário ...]
"""
import os, subprocess, sys, tempfile, time

AQUI = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(AQUI))
OUT = tempfile.mkdtemp(prefix='om-e2e-')


def fixtures():
    # Gerados na hora: nada de imagens reais no repositório.
    from PIL import Image
    import random
    random.seed(1)
    img = Image.effect_noise((3000, 2000), 64).convert('RGB')
    img.save(os.path.join(OUT, 'foto.jpg'), quality=95)
    with open(os.path.join(OUT, 'doc.pdf'), 'wb') as f:
        f.write(b'%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')


def main():
    fixtures()
    nomes = sys.argv[1:] or sorted(f[:-3] for f in os.listdir(AQUI) if f.endswith('.py') and f != 'correr.py')
    env = {**os.environ, 'E2E_ROOT': ROOT, 'E2E_DIR': OUT}
    falhas = []
    for n in nomes:
        t = time.time()
        r = subprocess.run([sys.executable, '-I', os.path.join(AQUI, f'{n}.py')], env=env, capture_output=True, text=True, timeout=600)
        erro = r.returncode != 0 or 'PAGEERR' in r.stdout or 'Traceback' in r.stderr
        print(f"{'FALHOU' if erro else 'ok    '} {n} ({time.time() - t:.0f}s)")
        if erro:
            falhas.append(n)
            print('\n'.join((r.stdout + r.stderr).strip().splitlines()[-8:]))
    print(f'\n{len(nomes) - len(falhas)}/{len(nomes)} cenários passaram. Ficheiros gerados em {OUT}')
    sys.exit(1 if falhas else 0)


if __name__ == '__main__':
    main()
