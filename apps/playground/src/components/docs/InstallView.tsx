"use client";

import Link from "next/link";
import { useState } from "react";
import styles from "./docs.module.css";

const MANAGERS = [
  { id: "pnpm", add: "pnpm add" },
  { id: "npm", add: "npm install" },
  { id: "yarn", add: "yarn add" },
  { id: "bun", add: "bun add" },
] as const;

const PACKAGES = [
  { name: "@zzyzxlabs/super-chat-core", what: "Runtime, provider adapters, cards and the proxy handler. No React, no LLM SDK.", core: true },
  { name: "@zzyzxlabs/super-chat-react", what: "Thread state and run control for React 18 and 19.", core: false },
  { name: "@zzyzxlabs/super-chat-ui", what: "Card renderers, the composer and other parts, and styles.css.", core: false },
] as const;

type Step = { title: string; code: string; for: "react" | "server" | "both" };

const STEPS: Step[] = [
  {
    title: "Import the styles",
    code: `import "@zzyzxlabs/super-chat-ui/styles.css";`,
    for: "react",
  },
  {
    title: "Add the proxy route",
    code: `// app/api/agent/route.ts
import { createProxyHandler } from "@zzyzxlabs/super-chat-core";

export const POST = createProxyHandler({
  providers: {
    openai: {
      baseUrl: "https://api.openai.com/v1",
      apiKey: () => process.env.OPENAI_API_KEY!,
      allowPaths: ["/responses", "/responses/*", "/chat/completions"],
    },
  },
});`,
    for: "react",
  },
  {
    title: "Render a thread",
    code: `<AgentProvider client={client}>
  <CardRendererProvider renderers={BUILTIN_RENDERERS}>
    <Thread />
    <Composer />
  </CardRendererProvider>
</AgentProvider>`,
    for: "react",
  },
  {
    title: "Run a turn",
    code: `import { runAgent, userMessage } from "@zzyzxlabs/super-chat-core";

for await (const event of runAgent([userMessage("Summarise the contract")], {
  provider,
  model: "gpt-5.2",
  contextBuilder,
  tools,
  toolResolution: { presets: ["observer"] },
})) {
  if (event.type === "text-delta") process.stdout.write(event.delta);
}`,
    for: "server",
  },
];

export function InstallView() {
  const [manager, setManager] = useState<(typeof MANAGERS)[number]["id"]>("pnpm");
  const [coreOnly, setCoreOnly] = useState(false);
  const [copied, setCopied] = useState(false);

  const pkgs = PACKAGES.filter((p) => !coreOnly || p.core).map((p) => p.name);
  const command = `${MANAGERS.find((m) => m.id === manager)!.add} ${pkgs.join(" ")}`;
  const steps = STEPS.filter((s) => s.for === "both" || s.for === (coreOnly ? "server" : "react"));

  return (
    <div className={styles.page}>
      <div className={styles.install}>
        <h1 className={styles.h1}>Install</h1>

        <div className={styles.controls}>
          <div className={styles.segment} role="group" aria-label="Package manager">
            {MANAGERS.map((m) => (
              <button key={m.id} type="button" aria-pressed={manager === m.id} onClick={() => setManager(m.id)}>{m.id}</button>
            ))}
          </div>
          <div className={styles.segment} role="group" aria-label="What you are building">
            <button type="button" aria-pressed={!coreOnly} onClick={() => setCoreOnly(false)}>React app</button>
            <button type="button" aria-pressed={coreOnly} onClick={() => setCoreOnly(true)}>Server or CLI</button>
          </div>
        </div>

        <div className={styles.command}>
          {/* Keyed by the command, so a change crossfades instead of snapping. */}
          <pre key={command} className={styles.swap}>{command}</pre>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard?.writeText(command).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1600);
              });
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        <dl className={styles.packages}>
          {PACKAGES.map((p) => {
            const off = coreOnly && !p.core;
            return (
              <div key={p.name} style={{ display: "contents" }}>
                <dt className={off ? styles.off : undefined}>
                  <a href={`https://www.npmjs.com/package/${p.name}`} style={off ? { color: "inherit" } : undefined}>{p.name}</a>
                </dt>
                <dd className={off ? styles.off : undefined}>{p.what}</dd>
              </div>
            );
          })}
        </dl>

        <ol key={coreOnly ? "server" : "react"} className={styles.steps}>
          {steps.map((s) => (
            <li key={s.title}>
              <h2>{s.title}</h2>
              <pre>{s.code}</pre>
            </li>
          ))}
        </ol>

        <Link className={styles.more} href="/docs/getting-started">Getting started, step by step →</Link>
      </div>
    </div>
  );
}
