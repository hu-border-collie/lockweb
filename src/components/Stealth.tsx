import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
export const StealthContext = createContext(false);
export const useStealth = () => useContext(StealthContext);

export function useConcealHold(stealth: boolean, onActivate?: () => void) {
  const [reveal, setReveal] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const held = useRef(false);
  const stop = () => {
    clearTimeout(timer.current);
    setReveal(false);
  };
  useEffect(() => {
    clearTimeout(timer.current);
    setReveal(false);
    held.current = false;
  }, [stealth]);
  useEffect(() => {
    const clear = () => {
      clearTimeout(timer.current);
      setReveal(false);
      held.current = false;
    };
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", clear);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", clear);
    };
  }, []);
  return {
    concealed: stealth && !reveal,
    handlers: {
      onPointerDown: (e: PointerEvent<HTMLElement>) => {
        if (!stealth || e.button !== 0) return;
        held.current = false;
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          held.current = true;
          setReveal(true);
        }, 350);
      },
      onPointerUp: stop,
      onPointerCancel: stop,
      onPointerLeave: stop,
      onBlur: stop,
      onContextMenu: (e: MouseEvent) => {
        if (stealth) e.preventDefault();
      },
      onKeyDown: (e: KeyboardEvent) => {
        if (stealth && e.key === " ") {
          e.preventDefault();
          held.current = true;
          setReveal(true);
        }
      },
      onKeyUp: (e: KeyboardEvent) => {
        if (e.key === " ") {
          e.preventDefault();
          stop();
          held.current = false;
        }
      },
      onClick: () => {
        if (held.current) {
          held.current = false;
          return;
        }
        onActivate?.();
      },
    },
  };
}
