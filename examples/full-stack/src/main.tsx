import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { AgentProvider } from "@supersolutions/super-chat-react";
import { BUILTIN_RENDERERS, CardRendererProvider, Composer, Thread } from "@supersolutions/super-chat-ui";
import { pluginRenderers } from "@supersolutions/super-chat-plugin";
import "@supersolutions/super-chat-ui/styles.css";
import "@supersolutions/super-editor-ui/styles.css";
import { createClient, installReports, plugins, type Preset } from "./agent";
import "./app.css";

const renderers = { ...BUILTIN_RENDERERS, ...pluginRenderers(plugins) };
const PRESETS: { id: Preset; label: string }[] = [
  { id: "observer", label: "Observer: read only" },
  { id: "draft", label: "Draft: read and mark up" },
  { id: "executor", label: "Executor: may change content, asks first" },
];

function App() {
  const [preset, setPreset] = useState<Preset>("executor");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const client = useMemo(() => createClient(preset), [preset]);
  useEffect(() => () => client.stop(), [client]);
  useEffect(() => document.documentElement.setAttribute("data-theme", theme), [theme]);
  const toolCount = installReports.reduce((sum, report) => sum + report.tools.length, 0);

  return (
    <AgentProvider client={client}>
      <CardRendererProvider renderers={renderers}>
        <main className="app">
          <header className="app__bar">
            <h1>Reference agent</h1>
            <label>
              Preset
              <select value={preset} onChange={(event) => setPreset(event.target.value as Preset)}>
                {PRESETS.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </label>
            <button type="button" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>
              {theme === "light" ? "Dark theme" : "Light theme"}
            </button>
          </header>
          <p className="app__note">{toolCount} plugin tools installed. The model is scripted and the market data is generated.</p>
          <Thread empty={<p className="app__note">Send any message to run the scripted agent.</p>} />
          <Composer placeholder="Send any message to start" />
        </main>
      </CardRendererProvider>
    </AgentProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
