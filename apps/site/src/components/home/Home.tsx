"use client";

import Link from "next/link";
import { CodeBlock } from "@supersolutions/super-chat-ui";
import { SiteHeader } from "../SiteHeader";
import { CREATE_APP, INSTALL_ALL, PACKAGES, PROXY_CODE, TOKEN_BUDGET, TRACE } from "./content";
import { BubbleArt, InstallCommand, SiteFooter } from "./parts";
import { Showcase } from "@/components/showcase/Showcase";
import styles from "./home.module.css";

const HEADROOM_COLOR = "var(--trace-empty)";

export function Home() {
  const used = TRACE.reduce((total, item) => total + item.tokens, 0);
  const headroom = TOKEN_BUDGET - used;

  return (
    <div id="top" className={`schat-scope schat-page ${styles.page}`}>
      <a className={styles.skip} href="#main">Skip to content</a>
      <SiteHeader overlay themeable className={styles.chrome} />

      <main id="main" tabIndex={-1}>
        <section className={`${styles.stage} ${styles.chrome} ${styles.field}`}>
          <div className={styles.stageClip} aria-hidden="true">
            <BubbleArt className={styles.stageArt} top="var(--art-a)" middle="var(--art-b)" bottom="var(--art-a)" />
          </div>
          <div className={`${styles.wrap} ${styles.hero}`}>
            <div className={styles.heroCopy}>
              <h1 className={styles.h1}>Your agent builds the interface for each question.</h1>
              <p className={styles.heroLede}>
                Super Chat is an open-source front end for agent services. The agent assembles tables, charts and inputs for
                each request, and stops to ask when it needs a choice, a form, an approval or a redline.
              </p>
              <div className={styles.heroActions}>
                <Link className={styles.solid} href="/playground">Try it without an API key</Link>
                <InstallCommand command={CREATE_APP} />
              </div>
            </div>
            <div className={styles.heroDemo}>
              <Showcase />
            </div>
          </div>
        </section>

        <section id="providers" className={`${styles.wrap} ${styles.block}`}>
          <div className={styles.head}>
            <p className={styles.question}>Will it work with the model we already use?</p>
            <h2 className={styles.answer}>One runtime for OpenAI, Anthropic and compatible endpoints.</h2>
            <p className={styles.lede}>
              Super Chat writes each provider&apos;s request format for you, including tools, images and output limits.
            </p>
          </div>
          <div className={`${styles.two} ${styles.center}`}>
            <div className={styles.stack}>
              <h3 className={styles.h3}>Your API key stays on your server.</h3>
              <p className={styles.lede}>
                The proxy forwards only the paths you list. Any other path returns 403, and an Authorization header sent by
                the browser is ignored.
              </p>
            </div>
            <div className={styles.slot}>
              <CodeBlock code={PROXY_CODE} lang="ts" filename="app/api/agent/route.ts" />
            </div>
          </div>
        </section>

        <section className={`${styles.field} ${styles.fieldDeep}`}>
          <div className={`${styles.wrap} ${styles.block}`}>
            <div className={styles.head}>
              <p className={styles.question}>Why did the agent know that?</p>
              <h2 className={styles.answer}>Every turn records what went into the context.</h2>
            </div>
            <div className={styles.budget} role="img" aria-label={`Sample context budget: ${used.toLocaleString("en-US")} of ${TOKEN_BUDGET.toLocaleString("en-US")} tokens used`}>
              {TRACE.map((item) => <i key={item.id} style={{ flex: `${item.tokens} 1 0`, background: item.color }} />)}
              <i style={{ flex: `${headroom} 1 0`, background: HEADROOM_COLOR }} />
            </div>
            <div className={styles.two}>
              <div className={styles.stack}>
                <p className={styles.lede}>
                  Context is rebuilt each turn from named sources under a token budget. When a source is trimmed or dropped,
                  the trace says why.
                </p>
                <p className={styles.note}>Sample trace with a 4,000-token budget.</p>
              </div>
              <ul className={styles.rows}>
                {TRACE.map((item) => (
                  <li key={item.id}>
                    <i style={{ background: item.color }} />
                    <code>{item.id}</code>
                    <span>{item.status}</span>
                    <b>{item.tokens.toLocaleString("en-US")}</b>
                  </li>
                ))}
                <li><i className={styles.hollow} /><code>history:older</code><span>Dropped for budget</span><b>0</b></li>
                <li><i style={{ background: HEADROOM_COLOR }} /><code>headroom</code><span>Left for the reply</span><b>{headroom.toLocaleString("en-US")}</b></li>
              </ul>
            </div>
          </div>
        </section>

        <section id="install" className={`${styles.wrap} ${styles.block}`}>
          <div className={styles.head}>
            <p className={styles.question}>What do I need to start?</p>
            <h2 className={styles.answer}>One command creates a working agent app.</h2>
          </div>
          <div className={styles.two}>
            <div className={styles.stack}>
              <InstallCommand command={CREATE_APP} />
              <p className={styles.lede}>Creates a working Super Chat interface with a scripted demo agent.</p>
              <Link className={styles.textLink} href="/install">See every install option</Link>
            </div>
            <div className={styles.stack}>
              <h3 className={styles.h4}>Already have an app? Install only the layers you need.</h3>
              <InstallCommand command={INSTALL_ALL} />
              <ul className={styles.packages}>
                {PACKAGES.map((item) => (
                  <li key={item.name}><code>{item.name}</code><span>{item.description}</span></li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className={styles.close}>
          <BubbleArt className={styles.closeArt} top="#ffffff" middle="#111113" bottom="#ffffff" onView />
          <div className={`${styles.wrap} ${styles.closeInner}`}>
            <h2>See three products built on it.</h2>
            <p>The playground runs a legal workspace, a companion and a DeFi assistant in your browser.</p>
            <Link className={styles.solid} href="/playground">Open the playground</Link>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
