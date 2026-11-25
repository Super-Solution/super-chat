"use client";

import { useEffect, useState, type ReactNode } from "react";
import { LabelsProvider, zhTW } from "@supersolutions/super-chat-ui";

/**
 * The words of the kit's UI, English unless the address says `?lang=zh-TW`. A playground
 * convenience for looking at the zh-TW preset; a real app picks its language its own way and
 * hands `LabelsProvider` the preset.
 */
export function Words({ children }: { children: ReactNode }) {
  const [chinese, setChinese] = useState(false);
  useEffect(() => {
    const lang = new URLSearchParams(window.location.search).get("lang");
    setChinese(lang === "zh-TW");
    if (lang === "zh-TW") document.documentElement.lang = "zh-TW";
  }, []);
  return chinese ? <LabelsProvider labels={zhTW}>{children}</LabelsProvider> : <>{children}</>;
}
