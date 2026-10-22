"use client";

import Link from "next/link";
import { useState } from "react";
import {
  BUILTIN_RENDERERS,
  CardRenderer,
  CardRendererProvider,
  type CardRendererMap,
} from "@zzyzxlabs/super-chat-ui";
import { playgroundPath } from "@/agent/deployment";
import { REPO_URL } from "@/components/SiteNav";
import { LiveSurface } from "@/components/home/LiveSurface";
import { RequestFlow } from "@/components/home/RequestFlow";
import { Showcase } from "@/components/home/Showcase";
import { TraceCard } from "@/components/home/TraceCard";
import { StreamingDemo } from "@/components/home/StreamingDemo";
import { VENDOR_QUOTE, VendorQuoteView } from "@/components/home/VendorQuote";
import { Wall } from "@/components/home/Wall";
import { PURCHASE_CONFIRM, SIGNUP_STATS } from "@/components/home/specs";
import styles from "@/components/home/home.module.css";

// The custom kind registers beside the built-ins, exactly as a host would.
const RENDERERS: CardRendererMap = { ...BUILTIN_RENDERERS, vendorQuote: VendorQuoteView };

const INSTALL = "pnpm add @zzyzxlabs/super-chat-core @zzyzxlabs/super-chat-react @zzyzxlabs/super-chat-ui";

const PROXY_CODE = `// app/api/agent/route.ts
import { createProxyHandler } from "@zzyzxlabs/super-chat-core";

export const POST = createProxyHandler({
  providers: {
    openai: {
      baseUrl: "https://api.openai.com/v1",
      apiKey: () => process.env.OPENAI_API_KEY!,
      allowPaths: ["/responses", "/responses/*", "/chat/completions"],
    },
  },
  authorize: (req) => checkSession(req),
  onRequest: (envelope, meta) => audit(envelope, meta),
});`;

const CUSTOM_CODE = `cards.register({
  kind: "vendorQuote",
  summary: "One offer with its price and terms.",
  schema: vendorQuoteSchema,
  validate: checkVendorQuote,
});

<CardRendererProvider
  renderers={{ ...BUILTIN_RENDERERS, vendorQuote: VendorQuoteView }}
/>`;

const TOKENS_CODE = `:root {
  --sc-accent: #0f766e;
  --sc-radius: 6px;
  --sc-sans: "IBM Plex Sans", system-ui, sans-serif;
}`;

function InstallCommand() {
  const [copied, setCopied] = useState(false);
  return (
    <div className={styles.install}>
      <span aria-hidden="true">$</span>
      <code>pnpm add @zzyzxlabs/super-chat-ui</code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(INSTALL).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          });
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export default function Home() {
  return (
    <CardRendererProvider renderers={RENDERERS}>
      <div className={`${styles.home} ${styles.flavorB}`}>
        <section className={styles.hero} aria-label="Introduction">
          <div className={styles.heroCopy}>
            <h1 className={styles.h1}>The library for every answer.</h1>
            <p className={styles.heroLede}>
              Cards for what the agent shows, materials for everything around it, a runtime that keeps every request
              correct, and a backend you host in ten lines.
            </p>
            <div className={styles.actions}>
              <a className={styles.btnPrimary} href="#cards">See the library</a>
              <InstallCommand />
            </div>
          </div>
          <Wall />
        </section>

        <section className={`${styles.dark} ${styles.streamSection}`} aria-label="Streaming">
          <div className={styles.wrap}>
            <StreamingDemo />
          </div>
        </section>

        <section id="cards" className={styles.paper}>
          <div className={styles.wrap} style={{ display: "flex", flexDirection: "column", gap: 32 }}>
            <h2 className={styles.h2}>Dashboards, charts, forms and documents, chosen by the agent.</h2>
            <Showcase />
          </div>
        </section>

        <section id="custom" className={styles.white}>
          <div className={`${styles.wrap} ${styles.split}`}>
            <div className={styles.stack}>
              <h2 className={styles.h2}>Your product’s own cards, with the same guarantees.</h2>
              <ul className={styles.points}>
                <li>Validated before it renders.</li>
                <li>Registered with its renderer.</li>
                <li>A question waits for its answer.</li>
              </ul>
            </div>
            <div className={styles.stack}>
              <pre className={styles.code}>{CUSTOM_CODE}</pre>
              <div className={styles.customCard}>
                <CardRenderer card={{ id: "custom_vendor", spec: VENDOR_QUOTE }} />
              </div>
            </div>
          </div>
        </section>

        <section id="materials" className={styles.paper}>
          <div className={`${styles.wrap} ${styles.split}`} style={{ alignItems: "center" }}>
            <h2 className={styles.h2}>Thinking, plans, tool calls and the composer, as parts.</h2>
            <LiveSurface />
          </div>
        </section>

        <section id="backend" className={styles.dark}>
          <div className={styles.wrap} style={{ display: "flex", flexDirection: "column", gap: 48 }}>
            <h2 className={styles.h2} style={{ maxWidth: 860 }}>A production backend in ten lines. Your server, your keys.</h2>
            <RequestFlow />
            <div className={styles.split} style={{ gap: 24 }}>
              <pre className={styles.code}>{PROXY_CODE}</pre>
              <div className={styles.cells}>
                <div className={styles.cell}><strong>Only the paths you name</strong></div>
                <div className={styles.cell}><strong>Your sessions and quotas</strong></div>
                <div className={styles.cell}><strong>A usage record per step</strong></div>
                <div className={styles.cell}><strong>Any compatible endpoint</strong></div>
                <div className={styles.cell}><strong>Jobs that outlive the tab</strong></div>
                <div className={styles.cell}><strong>Tools from MCP servers</strong></div>
              </div>
            </div>

            <div id="runtime" className={`${styles.split} ${styles.divider}`} style={{ gap: 24, alignItems: "center" }}>
              <h3 className={styles.h3}>See why the agent knew that.</h3>
              <TraceCard />
            </div>
          </div>
        </section>

        <section id="flavors" className={styles.paper}>
          <div className={styles.wrap} style={{ display: "flex", flexDirection: "column", gap: 36 }}>
            <h2 className={styles.h2}>Two flavors we maintain. Any other you build.</h2>
            <div className={styles.flavorGrid}>
              <div className={`${styles.flavorPanel} ${styles.flavorPanelB} ${styles.flavorB}`}>
                <strong className={styles.flavorName}>Instrument</strong>
                <CardRenderer card={{ id: "flavor_b_stats", spec: SIGNUP_STATS }} />
                <CardRenderer card={{ id: "flavor_b_confirm", spec: PURCHASE_CONFIRM }} />
              </div>
              <div className={`${styles.flavorPanel} ${styles.flavorPanelC} ${styles.flavorC}`}>
                <strong className={styles.flavorName}>Tactile</strong>
                <CardRenderer card={{ id: "flavor_c_stats", spec: SIGNUP_STATS }} />
                <CardRenderer card={{ id: "flavor_c_confirm", spec: PURCHASE_CONFIRM }} />
              </div>
            </div>
            <pre className={styles.code}>{TOKENS_CODE}</pre>
          </div>
        </section>

        <section id="showcase" className={styles.white}>
          <div className={styles.wrap} style={{ display: "flex", flexDirection: "column", gap: 36 }}>
            <h2 className={styles.h2}>Three products on one library.</h2>
            <div className={styles.products}>
              <Link className={styles.product} href="/experiences/legal">
                <div className={`${styles.productArt} ${styles.artLegal}`}>
                  <span className={styles.mono} style={{ fontSize: 10, letterSpacing: "0.08em", color: "#6b6864" }}>VERTEX MASTER SERVICES AGREEMENT</span>
                  <b style={{ fontSize: 15, color: "#2b2c29" }}>7.2 Limitation of liability</b>
                  <span style={{ fontSize: 14, lineHeight: 1.5 }}><mark>In no event shall either party’s aggregate liability exceed fees paid</mark> in the preceding twelve months.</span>
                </div>
                <div className={styles.productBody}><strong>Counsel Workspace</strong></div>
              </Link>
              <Link className={styles.product} href="/experiences/companion">
                <div className={`${styles.productArt} ${styles.artCompanion}`}>
                  <p>You kept the promise you made to yourself this morning.</p>
                  <span>Celebrate this moment</span>
                </div>
                <div className={styles.productBody}><strong>Milo</strong></div>
              </Link>
              <Link className={styles.product} href="/experiences/defi">
                <div className={`${styles.productArt} ${styles.artDefi}`}>
                  <span className={styles.mono} style={{ fontSize: 11, color: "#8ca0a9" }}>SupWallet agent</span>
                  <b style={{ fontSize: 17 }}>Rebalance volatile exposure</b>
                  <span className={styles.mono} style={{ fontSize: 15 }}>14.20 ETH → 48,972 USDC</span>
                  <span className={styles.mono} style={{ fontSize: 12, color: "#51cea1" }}>29.4% → 17.6% · within policy</span>
                </div>
                <div className={styles.productBody}><strong>SupWallet</strong></div>
              </Link>
            </div>
          </div>
        </section>

        <section id="faq" className={styles.paper}>
          <div className={`${styles.wrap} ${styles.split}`}>
            <div className={styles.stack}>
              <h2 className={styles.h2}>Questions before you install.</h2>
              <Link href="/docs/getting-started" style={{ fontSize: 16 }}>Getting started →</Link>
            </div>
            <div className={styles.faq}>
              <details><summary>Is SuperChat a chat app?</summary><p>No. It is the library you build an agent’s answers with, inside your own product.</p></details>
              <details><summary>Does the model write UI code?</summary><p>No. It picks a card kind and fills in a spec. The spec is validated before anything renders, and your renderers decide how it looks.</p></details>
              <details><summary>Do I need a hosted gateway?</summary><p>No. The backend is one route handler on your own server. It holds your key, runs your auth and records usage.</p></details>
              <details><summary>Which providers does it support?</summary><p>OpenAI (Responses and Chat Completions), Anthropic, and OpenAI-compatible endpoints.</p></details>
              <details><summary>Is it free?</summary><p>Yes. Apache-2.0.</p></details>
            </div>
          </div>
        </section>

        <footer className={styles.dark}>
          <div className={styles.foot}>
            <strong className={styles.footLine}>The library for every answer.</strong>
            <div className={styles.footCols}>
              <div><span className={styles.mono}>superchat</span><small>Apache-2.0 · v0.4.0</small><small>Sample data on this site is synthetic.</small></div>
              <div><strong>Library</strong><a href="#cards">Cards</a><a href="#materials">Materials</a><a href="#backend">Backend</a><a href="#flavors">Flavors</a></div>
              <div><strong>Build</strong><Link href="/install">Install</Link><Link href="/docs">Guide</Link><Link href={playgroundPath("/cards")}>Playground</Link><a href={`${REPO_URL}/blob/main/CHANGELOG.md`}>Changelog</a></div>
              <div><strong>Project</strong><a href={REPO_URL}>GitHub</a><a href="https://www.npmjs.com/package/@zzyzxlabs/super-chat-core">npm</a><a href={`${REPO_URL}/blob/main/LICENSE`}>License</a></div>
            </div>
          </div>
        </footer>
      </div>
    </CardRendererProvider>
  );
}
