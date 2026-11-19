import type { Metadata, Viewport } from "next";
import "@supersolutions/super-chat-ui/styles.css";
import "../../../playground/src/app/globals.css";
import "../brand/tokens.css";
import "../brand/brand.css";
import { SiteShell } from "../components/SiteShell";
import { themeBootstrap } from "../components/site-theme";

export const metadata: Metadata = {
  title: "Super Chat",
  description: "An open-source front-end framework for agent services. Agents reply with tables, charts, forms and approvals that your product validates and renders.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

const BASE = process.env.PAGES_BASE_PATH ?? "";
const THEMED_PATHS = [BASE || "/", `${BASE}/whats-inside`];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap(THEMED_PATHS) }} />
      </head>
      <body><SiteShell>{children}</SiteShell></body>
    </html>
  );
}
