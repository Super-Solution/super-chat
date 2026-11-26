import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Message } from "@supersolutions/super-chat-core";
import { AgentClient, serverRunConfig } from "@supersolutions/super-chat-client";
import { AgentProvider } from "@supersolutions/super-chat-react";
import { MessageView } from "./Thread.js";
import { LabelsProvider, zhTW } from "./labels.js";

const answer: Message = { id: "m1", role: "assistant", parts: [{ type: "text", text: "It is **done**." }] };
const render = (node: React.ReactNode) => {
  const client = new AgentClient(serverRunConfig({ runner: async function* () {} }));
  return renderToStaticMarkup(<AgentProvider client={client}>{node}</AgentProvider>);
};

describe("an answer's row of controls", () => {
  it("has Copy and nothing else when the host asked for nothing", () => {
    const html = render(<MessageView message={answer} />);
    expect(html).toContain("Copy");
    expect(html).not.toContain("sc-feedback");
  });

  it("draws thumbs only when a host listens, named, unpressed, and the pressed one says so", () => {
    const html = render(<MessageView message={answer} onFeedback={() => {}} />);
    expect(html).toContain('aria-label="Good response"');
    expect(html).toContain('aria-label="Bad response"');
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(2);
    const up = render(<MessageView message={answer} feedback="up" onFeedback={() => {}} />);
    expect(up.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(up.indexOf('aria-pressed="true"')).toBeLessThan(up.indexOf("Bad response"));
  });

  it("says the thumbs' name in the words in force", () => {
    const html = render(
      <LabelsProvider labels={zhTW}>
        <MessageView message={answer} onFeedback={() => {}} />
      </LabelsProvider>,
    );
    expect(html).toContain("回答得好");
    expect(html).toContain("評價這則回覆");
  });

  it("puts the host's own controls after the built-in ones, handing over the Markdown source", () => {
    const html = render(<MessageView message={answer} actions={(m, source) => <button data-extra={`${m.id}:${source}`}>Share</button>} />);
    expect(html).toContain('data-extra="m1:It is **done**."');
    expect(html.indexOf("Copy")).toBeLessThan(html.indexOf("Share"));
  });
});
