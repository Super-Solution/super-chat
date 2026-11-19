"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Shell } from "@/components/Shell";
import { SITE_FONTS } from "@/components/site-fonts";
import { SiteHeader } from "./SiteHeader";

/** The homepage draws its own navigation; every other route keeps the shared shell. */
export function SiteShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/") return <>{children}</>;
  return (
    <>
      {/* The guide and playground still use these faces. The homepage self-hosts its own. */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link rel="stylesheet" href={SITE_FONTS} precedence="default" />
      <Shell renderNav={(active) => <SiteHeader active={active} />}>{children}</Shell>
    </>
  );
}
