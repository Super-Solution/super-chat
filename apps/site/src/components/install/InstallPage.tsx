"use client";

import { useEffect, useState } from "react";
import { InstallView } from "@/components/docs/InstallView";
import docs from "@/components/docs/docs.module.css";
import styles from "./install.module.css";

const CREATE = "npx create-super-app@latest my-agent";

function Command({ command }: { command: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timer = window.setTimeout(() => setState("idle"), 1600);
    return () => window.clearTimeout(timer);
  }, [state]);

  const copy = () => {
    if (!navigator.clipboard) return setState("failed");
    navigator.clipboard.writeText(command).then(
      () => setState("copied"),
      () => setState("failed"),
    );
  };

  return (
    <div className={docs.command}>
      <pre>{command}</pre>
      <button type="button" onClick={copy}>
        <span aria-live="polite">{state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}</span>
      </button>
    </div>
  );
}

export function InstallPage() {
  return (
    <div className={docs.page}>
      <div className={docs.install}>
        <header className={styles.lead}>
          <h1 className={docs.h1}>Install</h1>
          <p className={styles.intro}>Create an agent app in one command.</p>
        </header>

        <section className={styles.block} aria-label="Create an app">
          <Command command={CREATE} />
          <p>Start with a working Super Chat interface and a scripted demo agent. You don&apos;t need an API key to try it.</p>
          <p>API keys stay on your server. The browser only talks to your app&apos;s own routes.</p>
        </section>

        <section className={styles.block}>
          <h2 className={docs.h2}>Add more when you need it</h2>
          <div className={styles.option}>
            <h3>Add a backend</h3>
            <p>Sets up Super Router with PostgreSQL and Docker Compose.</p>
            <Command command={`${CREATE} --backend`} />
          </div>
          <div className={styles.option}>
            <h3>Install the whole solution</h3>
            <p>Adds Super Chat, Super Router, Super Chart, Super Editor and the Editor server.</p>
            <Command command={`${CREATE} --full`} />
            <p className={styles.licence}>
              <strong><code>--full</code> brings GPL-licensed packages into your app.</strong> Super Chat and Super Router are
              Apache-2.0. Super Chart and Super Editor are GPL-3.0-or-later, and the Editor server is AGPL-3.0-or-later. If you
              distribute an app that includes the GPL parts, the whole app must be offered under GPL-3.0-or-later with its
              source code. The installer explains this and asks you to confirm before installing them. Commercial licences are
              available from SUPER SOLUTION LABS INC.
            </p>
          </div>
        </section>

        <InstallView embedded />
      </div>
    </div>
  );
}
