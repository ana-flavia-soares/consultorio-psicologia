import { useEffect, useRef, useState } from 'react';

export const IDLE_MINUTES = 10;

/**
 * Encerra a sessão depois de um tempo sem uso.
 * Protege o computador esquecido aberto no consultório: ao sair, a chave do
 * cofre é descartada da memória e é preciso entrar e desbloquear de novo.
 * Um minuto antes, avisa (devolve true), para não perder texto não salvo.
 */
export function useIdleTimeout(active: boolean, onTimeout: () => void, minutes = IDLE_MINUTES): { warning: boolean; stay: () => void } {
  const last = useRef(Date.now());
  const cb = useRef(onTimeout);
  cb.current = onTimeout;
  const [warning, setWarning] = useState(false);

  useEffect(() => {
    if (!active) {
      setWarning(false);
      return;
    }
    last.current = Date.now();
    const touch = () => {
      last.current = Date.now();
      setWarning(false);
    };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const check = () => {
      const idle = Date.now() - last.current;
      if (idle >= minutes * 60_000) {
        setWarning(false);
        cb.current();
      } else if (idle >= (minutes - 1) * 60_000) {
        setWarning(true);
      }
    };
    const timer = window.setInterval(check, 5_000);
    // Ao voltar para a aba depois de muito tempo, confere na hora.
    document.addEventListener('visibilitychange', check);
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch));
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, [active, minutes]);

  return {
    warning,
    stay: () => {
      last.current = Date.now();
      setWarning(false);
    },
  };
}
