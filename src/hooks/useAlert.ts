import { useState, useCallback, useRef } from "react";
import { useInterval } from "#hooks/useInterval";

export interface Alert {
  message: string;
  color: string;
  flash: boolean;
}

export function useAlert(): {
  alert: Alert | null;
  setAlert: (message: string, color: string, durationSec?: number, flash?: boolean) => void;
  dismissAlert: () => void;
} {
  const [alert, setAlertState] = useState<Alert | null>(null);
  const expiresAt = useRef(0);

  const setAlert = useCallback((message: string, color: string, durationSec = 5, flash = false) => {
    setAlertState({ message, color, flash });
    // durationSec=0 means persistent (no auto-dismiss)
    expiresAt.current = durationSec > 0 ? Date.now() + durationSec * 1000 : 0;
  }, []);

  const dismissAlert = useCallback(() => {
    setAlertState(null);
    expiresAt.current = 0;
  }, []);

  useInterval(() => {
    if (alert && expiresAt.current > 0 && Date.now() >= expiresAt.current) {
      setAlertState(null);
      expiresAt.current = 0;
    }
  }, 500);

  return { alert, setAlert, dismissAlert };
}
