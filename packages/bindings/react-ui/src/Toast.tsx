"use client";

// Transient notices, and the connection banner.
//
// Two different things on purpose. A toast is for something that happened and is
// over (copied, exported, saved) — it self-dismisses because nothing depends on
// the user reading it. Being offline is a *condition*, not an event: it persists
// until it changes, so it gets a banner that stays put and disappears on its own
// when connectivity returns. Auto-dismissing that would be a lie.
//
// Errors that belong to a turn are NOT toasts — they render inline in the thread
// where the failed turn is, because that is where the retry lives.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Toast = { id: string; message: string; tone?: "info" | "positive" | "negative" | "warning" };

type ToastApi = { show: (message: string, tone?: Toast["tone"]) => void };

const ToastContext = createContext<ToastApi | null>(null);

/** Fire a toast. Safe to call without a provider — it simply does nothing. */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? { show: () => {} };
}

export function ToastProvider({ children, timeoutMs = 4000 }: { children: ReactNode; timeoutMs?: number }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback(
    (message: string, tone: Toast["tone"] = "info") => {
      const id = `t_${Math.random().toString(36).slice(2, 9)}`;
      setToasts((prev) => [...prev, { id, message, tone }]);
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), timeoutMs);
    },
    [timeoutMs],
  );

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* aria-live so a screen reader hears it; the region exists even when
          empty, because one created at announcement time is not announced. */}
      <div className="sc-toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`sc-toast${t.tone && t.tone !== "info" ? ` sc-toast--${t.tone}` : ""}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/**
 * Offline banner.
 *
 * `navigator.onLine` only reports whether the machine has a network interface,
 * not whether the agent's backend is reachable — it is a cheap signal that
 * catches the common case (laptop lid, tunnel, dropped wifi) and nothing more.
 * A real reachability check belongs to the host, which knows its own endpoint.
 */
export function ConnectionBanner({ label = "You're offline — messages will fail to send." }: { label?: string }) {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    // Read on mount rather than in useState: navigator is absent during SSR and
    // the server render must not disagree with the first client render.
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  if (!offline) return null;
  return (
    <div className="sc-connbanner" role="alert">
      {label}
    </div>
  );
}
