"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * Whether the element is on screen and the tab is visible. Demos loop only
 * while this is true, so nothing animates offscreen or in a background tab.
 */
export function useInView(ref: RefObject<Element | null>, threshold = 0.25): boolean {
  const [onScreen, setOnScreen] = useState(false);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setOnScreen(Boolean(entry?.isIntersecting)), { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, threshold]);

  useEffect(() => {
    const sync = () => setVisible(document.visibilityState === "visible");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  return onScreen && visible;
}

/** True once the element has been on screen, and stays true. */
export function useSeen(ref: RefObject<Element | null>, threshold = 0.35): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) setSeen(true);
    }, { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, threshold, seen]);
  return seen;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
