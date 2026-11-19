import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Botão "Instalar" no Android (Chrome/Edge/Samsung Internet). */
export function useInstalar() {
  const [evento, setEvento] = useState<BeforeInstallPromptEvent | null>(null);
  const [instalada, setInstalada] = useState(() => window.matchMedia('(display-mode: standalone)').matches);
  useEffect(() => {
    const antes = (e: Event) => {
      e.preventDefault();
      setEvento(e as BeforeInstallPromptEvent);
    };
    const depois = () => {
      setInstalada(true);
      setEvento(null);
    };
    window.addEventListener('beforeinstallprompt', antes);
    window.addEventListener('appinstalled', depois);
    return () => {
      window.removeEventListener('beforeinstallprompt', antes);
      window.removeEventListener('appinstalled', depois);
    };
  }, []);
  const instalar = evento
    ? async () => {
        await evento.prompt();
        await evento.userChoice;
        setEvento(null);
      }
    : null;
  return { instalada, instalar };
}
