/** Largura e altura de uma imagem (lê o cabeçalho através do navegador; não altera o ficheiro). */
export function dimensoesImagem(blob: Blob): Promise<{ l: number; a: number }> {
  return new Promise((ok, falha) => {
    const url = URL.createObjectURL(blob);
    const im = new Image();
    im.onload = () => { URL.revokeObjectURL(url); ok({ l: im.naturalWidth, a: im.naturalHeight }); };
    im.onerror = () => { URL.revokeObjectURL(url); falha(new Error('Não consegui abrir a imagem.')); };
    im.src = url;
  });
}
