import type { Metadata, Viewport } from "next";
import "@zzyzxlabs/super-chat-ui/styles.css";
import "../../../playground/src/app/globals.css";
import { Shell } from "@/components/Shell";
import { SITE_FONTS } from "@/components/site-fonts";

export const metadata: Metadata = {
  title: "SuperChat — the library for every answer",
  description: "Cards, materials, a provider-correct runtime and a ten-line backend for agent interfaces. A browser-only showcase.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href={SITE_FONTS} />
      </head>
      <body><Shell>{children}</Shell></body>
    </html>
  );
}
