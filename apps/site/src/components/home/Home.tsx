"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CodeBlock } from "@supersolutions/super-chat-ui";
import { REPO_URL } from "@/components/SiteNav";
import { Mark } from "../Mark";
import { ASKS, DIALECTS, FAMILIES, INSTALL_ALL, INSTALL_UI, OUTCOMES, PACKAGES, PROXY_CODE, TOKEN_BUDGET, TRACE } from "./content";
import { HeroScene, useHeroScene } from "./HeroScene";
import { BubbleArt, InstallCommand, LiveCard } from "./parts";
import styles from "./home.module.css";

const HEADROOM_COLOR = "var(--trace-empty)";

function useThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    if (theme) document.documentElement.setAttribute("data-theme", theme);
    return () => document.documentElement.removeAttribute("data-theme");
  }, [theme]);

  const toggle = () => {
    const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = theme ? theme === "dark" : systemDark;
    setTheme(isDark ? "light" : "dark");
  };
  return toggle;
}

function Segments<T extends { id: string; label: string }>({ items, value, onChange, label }: { items: T[]; value: string; onChange: (id: string) => void; label: string }) {
  return (
    <div className={styles.segments} role="group" aria-label={label}>
      {items.map((item) => (
        <button key={item.id} type="button" aria-pressed={item.id === value} onClick={() => onChange(item.id)}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function Home() {
  const scene = useHeroScene();
  const toggleTheme = useThemeToggle();
  const [kind, setKind] = useState("comparison");
  const [outcomeId, setOutcomeId] = useState("valid");
  const [askId, setAskId] = useState("confirm");

  const outcome = OUTCOMES.find((item) => item.id === outcomeId) ?? OUTCOMES[0];
  const ask = ASKS.find((item) => item.id === askId) ?? ASKS[0];
  const used = TRACE.reduce((total, item) => total + item.tokens, 0);
  const headroom = TOKEN_BUDGET - used;
  const waiting = scene.phase === "waiting";

  return (
    <div id="top" className={`schat-scope schat-page ${styles.page}`}>
      <a className={styles.skip} href="#main">Skip to content</a>
      <header className={`${styles.topbar} ${styles.chrome}`} data-wait={waiting}>
        <div className={styles.wrap}>
          <div className={styles.nav}>
            <a className={styles.brand} href="#top">
              <Mark size={36} play />
              Super Chat
            </a>
            <nav className={styles.navLinks} aria-label="Primary">
              <a href="#cards">Cards</a>
              <a href="#questions">Questions</a>
              <a href="#providers">Providers</a>
              <a href="#install">Install</a>
              <Link href="/docs">Docs</Link>
            </nav>
            <div className={styles.navEnd}>
              <button className={styles.iconButton} type="button" onClick={toggleTheme} aria-label="Switch color theme">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
                </svg>
              </button>
              <a className={styles.navGithub} href={REPO_URL}>GitHub</a>
              <Link className={`${styles.solid} ${styles.solidSmall}`} href="/playground">Playground</Link>
            </div>
          </div>
        </div>
      </header>

      <main id="main" tabIndex={-1}>
        <section className={`${styles.stage} ${styles.chrome} ${styles.field}`} data-wait={waiting}>
          <div className={styles.stageClip} aria-hidden="true">
            <BubbleArt className={styles.stageArt} top="var(--art-a)" middle="var(--art-b)" bottom="var(--art-a)" />
          </div>
          <div className={`${styles.wrap} ${styles.hero}`}>
            <div className={styles.heroCopy}>
              <h1 className={styles.h1}>Your agent answers with your interface.</h1>
              <p className={styles.heroLede}>
                Super Chat is an open-source front-end framework for agent services. Agents reply with tables, charts,
                forms and approvals that your product validates and renders.
              </p>
              <div className={styles.heroActions}>
                <Link className={styles.solid} href="/playground">Try it without an API key</Link>
                <InstallCommand command={INSTALL_UI} />
              </div>
            </div>
            <HeroScene scene={scene} />
          </div>
        </section>

        <section id="cards" className={`${styles.wrap} ${styles.block}`}>
          <p className={styles.question}>What else can it show?</p>
          <h2 className={styles.answer}>23 card kinds, from a ticket table to an approval.</h2>
          <div className={styles.two}>
            <div>
              {FAMILIES.map((family) => (
                <div className={styles.family} key={family.name}>
                  <h3>{family.name}</h3>
                  <div className={styles.kinds}>
                    {family.kinds.map((id) => (
                      <button key={id} className={styles.kind} type="button" aria-pressed={id === kind} onClick={() => setKind(id)}>
                        {id}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className={`${styles.slot} ${styles.sticky}`} aria-live="polite">
              <LiveCard kind={kind} instance="explorer" />
            </div>
          </div>
        </section>

        <section className={`${styles.field} ${styles.fieldInk}`}>
          <div className={`${styles.wrap} ${styles.block}`}>
            <p className={styles.question}>Who controls what the model can show?</p>
            <h2 className={styles.answer}>The model picks a card. Your product decides what renders.</h2>
            <Segments items={OUTCOMES} value={outcomeId} onChange={setOutcomeId} label="Card outcome" />
            <div className={styles.two}>
              <div className={styles.slot}>
                <CodeBlock code={JSON.stringify(outcome.spec, null, 2)} lang="json" filename="visualize spec" lineNumbers={false} />
              </div>
              <div>
                <div className={styles.slot} aria-live="polite">
                  <LiveCard kind={outcome.spec.kind} spec={outcome.spec} expired={outcome.expired} instance={outcome.id} />
                </div>
                <p className={styles.lede} style={{ marginTop: 18 }}>{outcome.result}</p>
              </div>
            </div>
          </div>
        </section>

        <section id="questions" className={`${styles.field} ${styles.fieldTurn}`}>
          <div className={`${styles.wrap} ${styles.block}`}>
            <p className={styles.question}>What can the agent ask me?</p>
            <h2 className={styles.answer}>A choice, a form, an approval or a redline.</h2>
            <div className={styles.two}>
              <div className={styles.stack}>
                <Segments items={ASKS} value={askId} onChange={setAskId} label="Question type" />
                <p className={styles.lede}>
                  {ask.text} The run stays paused until you answer, and your answer becomes the tool result the model reads next.
                </p>
              </div>
              <div className={styles.slot} aria-live="polite">
                <LiveCard kind={ask.id} instance="question" />
              </div>
            </div>
          </div>
        </section>

        <section id="providers" className={`${styles.wrap} ${styles.block}`}>
          <p className={styles.question}>Will it work with the model we already use?</p>
          <h2 className={styles.answer}>One runtime for OpenAI, Anthropic and compatible endpoints.</h2>
          <p className={styles.lede}>
            Super Chat writes each provider&apos;s request format separately. These are the fields that break a request when
            formats get mixed up.
          </p>
          <div className={styles.tableBox}>
            <table>
              <thead>
                <tr><th scope="col">Field</th><th scope="col">OpenAI Responses</th><th scope="col">Chat Completions</th><th scope="col">Anthropic Messages</th></tr>
              </thead>
              <tbody>
                {DIALECTS.map((row) => (
                  <tr key={row.field}><td>{row.field}</td><td><code>{row.responses}</code></td><td><code>{row.chat}</code></td><td><code>{row.anthropic}</code></td></tr>
                ))}
              </tbody>
            </table>
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
            <p className={styles.question}>Why did the agent know that?</p>
            <h2 className={styles.answer}>Every turn records what went into the context.</h2>
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
          <p className={styles.question}>What do I need to start?</p>
          <h2 className={styles.answer}>Install only the layers you need.</h2>
          <div className={styles.two}>
            <ul className={styles.packages}>
              {PACKAGES.map((item) => (
                <li key={item.name}><code>{item.name}</code><span>{item.description}</span></li>
              ))}
            </ul>
            <div>
              <InstallCommand command={INSTALL_ALL} />
              <dl className={styles.facts}>
                <div><dt>License</dt><dd>Apache-2.0</dd></div>
              </dl>
            </div>
          </div>
        </section>

        <section className={styles.close}>
        <BubbleArt className={styles.closeArt} top="#ffffff" middle="#111113" bottom="#ffffff" onView />
        <div className={`${styles.wrap} ${styles.closeInner}`}>
          <h2>See three products built on it.</h2>
          <p>The playground runs a legal workspace, a companion and a DeFi assistant in your browser. You don&apos;t need an API key.</p>
          <Link className={styles.solid} href="/playground">Open the playground</Link>
        </div>
        </section>
      </main>

      <footer className={`${styles.wrap} ${styles.footer}`}>
        <span>Super Chat is part of <a href="https://github.com/Super-Solution">Super Solution Lab</a>. Sample data on this page is synthetic.</span>
        <nav className={styles.footerLinks} aria-label="Footer">
          <Link href="/docs">Docs</Link>
          <a href={REPO_URL}>GitHub</a>
          <a href="https://www.npmjs.com/package/@supersolutions/super-chat-core">npm</a>
          <a href={`${REPO_URL}/blob/main/LICENSE`}>License</a>
        </nav>
      </footer>
    </div>
  );
}
