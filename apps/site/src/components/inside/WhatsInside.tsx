"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import type { StaticImageData } from "next/image";
import { REPO_URL } from "@/components/SiteNav";
import { SiteHeader } from "../SiteHeader";
import { BubbleArt, SiteFooter } from "../home/parts";
import home from "../home/home.module.css";
import styles from "./inside.module.css";
import chartDark from "./assets/chart-marks-dark.webp";
import chartLight from "./assets/chart-marks-light.webp";
import chartPhoneDark from "./assets/chart-marks-phone-dark.webp";
import chartPhoneLight from "./assets/chart-marks-phone-light.webp";
import editorDark from "./assets/editor-review-dark.webp";
import editorLight from "./assets/editor-review-light.webp";
import editorPhoneDark from "./assets/editor-review-phone-dark.webp";
import editorPhoneLight from "./assets/editor-review-phone-light.webp";
import routerConsole from "./assets/router-console.webp";
import routerPhone from "./assets/router-console-phone.webp";

const LiveThread = dynamic(() => import("./LiveThread").then((mod) => mod.LiveThread), {
  ssr: false,
  loading: () => <div className={styles.thread} />,
});

const ORG_URL = "https://github.com/Super-Solution";
const PHONE = "(max-width: 620px)";

const JUMPS = [
  { href: "#chat", label: "Talk to the agent" },
  { href: "#router", label: "Charge for the AI" },
  { href: "#chart", label: "Mark up a chart" },
  { href: "#editor", label: "Review a report" },
];

function Shot({ wide, phone, alt, className }: { wide: StaticImageData; phone: StaticImageData; alt: string; className?: string }) {
  return (
    <picture className={className}>
      <source media={PHONE} srcSet={phone.src} width={phone.width} height={phone.height} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={wide.src} width={wide.width} height={wide.height} alt={alt} loading="lazy" decoding="async" />
    </picture>
  );
}

function Screenshot({
  light,
  dark,
  alt,
  caption,
}: {
  light: { wide: StaticImageData; phone: StaticImageData };
  dark?: { wide: StaticImageData; phone: StaticImageData };
  alt: string;
  caption: string;
}) {
  return (
    <figure className={styles.figure}>
      <div className={styles.frame}>
        <Shot {...light} alt={alt} className={dark ? styles.onlyLight : undefined} />
        {dark ? <Shot {...dark} alt={alt} className={styles.onlyDark} /> : null}
      </div>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

function Facts({ items }: { items: string[] }) {
  return (
    <ul className={styles.facts}>
      {items.map((item) => <li key={item}>{item}</li>)}
    </ul>
  );
}

function Source({ href, name, license }: { href: string; name: string; license: string }) {
  return (
    <p className={styles.source}>
      <a href={href}>{name} on GitHub</a>
      <span>{license}</span>
    </p>
  );
}

export function WhatsInside() {
  return (
    <div id="top" className={`schat-scope schat-page ${home.page}`}>
      <a className={home.skip} href="#main">Skip to content</a>
      <SiteHeader overlay themeable active="whats-inside" className={home.chrome} />

      <main id="main" tabIndex={-1}>
        <section className={`${home.stage} ${home.chrome} ${home.field}`}>
          <div className={home.stageClip} aria-hidden="true">
            <BubbleArt className={home.stageArt} top="var(--art-a)" middle="var(--art-b)" bottom="var(--art-a)" />
          </div>
          <div className={`${home.wrap} ${styles.hero}`}>
            <h1 className={home.h1}>Your agent&apos;s interface, billing, charts and reports.</h1>
            <p className={home.heroLede}>
              Start with the interface people use to work with your agent. Add paid AI, financial charts and editable
              reports when your product needs them.
            </p>
            <ul className={styles.jumps}>
              {JUMPS.map((jump) => (
                <li key={jump.href}><a href={jump.href}>{jump.label}</a></li>
              ))}
            </ul>
          </div>
        </section>

        <section id="chat" className={`${home.wrap} ${home.block} ${styles.section}`}>
          <p className={home.question}>Where do people work with my agent?</p>
          <h2 className={home.answer}>Super Chat gives your agent its interface.</h2>
          <div className={styles.split}>
            <div className={styles.copy}>
              <Facts
                items={[
                  "Replies, tool steps and composed interfaces arrive in one thread as they are written.",
                  "A consequential action waits until the person approves it.",
                  "Your provider keys stay on your server.",
                ]}
              />
              <p className={styles.source}>
                <Link href="/playground/surfaces">Open the full demo</Link>
                <span>Apache-2.0</span>
              </p>
              <p className={home.note}>This thread is the real kit, answering from a script with sample figures.</p>
            </div>
            <LiveThread />
          </div>
        </section>

        <section id="router" className={`${home.field} ${home.fieldInk}`}>
          <div className={`${home.wrap} ${home.block} ${styles.section}`}>
            <p className={home.question}>How do I charge for the AI?</p>
            <h2 className={home.answer}>Super Router routes each request and bills it.</h2>
            <Screenshot
              light={{ wide: routerConsole, phone: routerPhone }}
              alt="Super Router console: provider fallback settings above a ledger of requests with their attempts, provider cost, credits charged and billing status."
              caption="Super Router console with sample customers and requests."
            />
            <Facts
              items={[
                "Credits are held before a request runs, then settled on the usage reported.",
                "When the first provider refuses, a backup answers and the customer is charged once.",
                "When every provider refuses, nothing is charged and the hold is released.",
              ]}
            />
            <Source href={`${ORG_URL}/super-router`} name="Super Router" license="Apache-2.0" />
          </div>
        </section>

        <section id="chart" className={`${home.field} ${home.fieldDeep}`}>
          <div className={`${home.wrap} ${home.block} ${styles.section}`}>
            <p className={home.question}>Can the agent show me what it sees?</p>
            <h2 className={home.answer}>Super Chart lets the agent mark up the chart.</h2>
            <Screenshot
              light={{ wide: chartLight, phone: chartPhoneLight }}
              dark={{ wide: chartDark, phone: chartPhoneDark }}
              alt="Candlestick chart with agent marks: two dashed price levels, a shaded pullback zone and a labelled retest point, each tagged with a violet diamond."
              caption="Super Chart inside a Super Chat thread, with generated market data."
            />
            <Facts
              items={[
                "The agent draws price levels, zones and labelled points on the chart your user is reading.",
                "Dashed lines and a violet diamond set the agent's marks apart.",
                "You choose whether an agent may only read the chart, mark it up or change it.",
              ]}
            />
            <Source href={`${ORG_URL}/super-chart`} name="Super Chart" license="GPL-3.0-or-later" />
          </div>
        </section>

        <section id="editor" className={`${home.field} ${home.fieldTurn}`}>
          <div className={`${home.wrap} ${home.block} ${styles.section}`}>
            <p className={home.question}>Can I check what the agent changed?</p>
            <h2 className={home.answer}>Super Editor puts every proposed edit up for review.</h2>
            <Screenshot
              light={{ wide: editorLight, phone: editorPhoneLight }}
              dark={{ wide: editorDark, phone: editorPhoneDark }}
              alt="Research report beside a proposed change from an agent, showing an added paragraph, a rewritten paragraph with the old text struck through, and Accept and Reject buttons."
              caption="Super Editor reviewing an agent's proposal on a fictional report."
            />
            <Facts
              items={[
                "A proposal shows what would be added, changed or removed before anything happens.",
                "The document stays as it is until someone accepts.",
                "If the report has moved on, an out-of-date proposal can't be accepted.",
              ]}
            />
            <Source href={`${ORG_URL}/super-editor`} name="Super Editor" license="GPL-3.0-or-later" />
          </div>
        </section>

        <section className={home.close}>
          <BubbleArt className={home.closeArt} top="#ffffff" middle="#111113" bottom="#ffffff" onView />
          <div className={`${home.wrap} ${home.closeInner}`}>
            <h2>Try the agent before you build one.</h2>
            <p>The playground runs in your browser. You don&apos;t need an API key.</p>
            <div className={styles.closeActions}>
              <Link className={home.solid} href="/playground">Open the playground</Link>
              <a className={styles.closeLink} href={REPO_URL}>Read the source</a>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
