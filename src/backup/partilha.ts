/**
 * Envia um ficheiro pela folha de partilha do Android (e-mail, Drive, etc.).
 * Se o browser não suportar partilha de ficheiros, descarrega-o.
 */
export async function partilharOuDescarregar(blob: Blob, nome: string): Promise<'partilhado' | 'descarregado' | 'cancelado'> {
  const ficheiro = new File([blob], nome, { type: blob.type || 'application/octet-stream' });
  if (navigator.canShare?.({ files: [ficheiro] })) {
    try {
      await navigator.share({ files: [ficheiro], title: nome });
      return 'partilhado';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelado';
      // outro erro: cai para descarga
    }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: nome });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'descarregado';
}

/** Pede ao browser para não libertar o armazenamento. Devolve o estado final. */
export async function pedirPersistencia(): Promise<boolean | null> {
  if (!navigator.storage?.persist) return null;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}
