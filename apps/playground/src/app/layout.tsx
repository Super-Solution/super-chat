import type { Metadata, Viewport } from "next";
import "@super-solution/super-chat-ui/styles.css";
import "./globals.css";
import { Shell } from "@/components/Shell";
import { SITE_FONTS } from "@/components/site-fonts";

export const metadata: Metadata = {
  title: "SuperChat — the library for every answer",
  description: "Cards, materials, a provider-correct runtime and a ten-line backend for agent interfaces.",
};

// interactiveWidget is the part that matters on a phone: by default the
// virtual keyboard overlays the viewport, so a sticky-bottom composer ends up
// underneath it. resizes-content shrinks the layout viewport instead, which
// lifts the composer above the keyboard with no JS and no VisualViewport
// listener. maximumScale is left alone deliberately — locking zoom is an
// accessibility regression, and the 16px rule in styles.css already removes
// the reason people reach for it.
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
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
