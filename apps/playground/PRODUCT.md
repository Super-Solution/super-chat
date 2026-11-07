# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Open-source developers, hackathon builders, and product engineers who need to build a domain-specific agent inside their own product rather than ship another generic chat application.

## Product Purpose

SuperChat is a frontend framework for agent services. It gives builders one provider-neutral runtime for assembling context and skills, exposing scoped tools, accepting multimodal content, running agent loops, and rendering agent-chosen visual artifacts. Success means a builder can create an agent with domain knowledge, product-specific behavior, and a distinct visual personality without rebuilding the runtime or being locked to one model provider.

## Positioning

SuperChat separates the reusable agent runtime from both provider wire formats and product presentation. The same runtime can power materially different domain agents, accept BYOK or a server proxy, and let an agent select from a validated visual vocabulary while the host retains authority over tools, renderers, and interaction.

## Operating Context

The playground is both the hackathon demonstration and the inspectable reference implementation. Visitors should first experience several complete domain agents, then open a shared framework inspector or the existing developer panels to verify how skills, tools, provider translation, cards, events, and metering produced the result.

## Capabilities and Constraints

- Existing stack: Next.js 15, React 19, TypeScript, and the three SuperChat workspace packages.
- Normalized content includes text, images, files, audio, tool calls/results, and host-rendered artifacts.
- Provider paths include scripted demo mode, a server proxy, and browser BYOK.
- Agent cards are validated declarative specs. Hosts may override renderers; models must not emit arbitrary executable UI.
- Tool presets are capability boundaries, not cosmetic categories.
- Metering records usage facts only. Pricing, ledgers, persistence, wallets, and settlement remain host concerns.
- x402 is a clearly labelled protocol preview in the playground for now; it must not imply a real wallet or settlement.

## Brand Commitments

- Product name: SuperChat.
- The playground must show that domain agents do not all have to look like chat.
- Required experience worlds: a formal legal document workspace with highlighted clauses; an expressive companion with generated decorative effects such as hearts; and a professional DeFi experience named SupWallet with executable agent cards.
- Distinct visual personalities must share the same underlying runtime, event model, and safe renderer contract.

## Evidence on Hand

- The repository contains working provider adapters, BYOK and proxy transports, content normalization, skill and tool registries, 23 built-in agent-card kinds, a live run page, developer inspection panels, and automated tests.
- Demo domain data is synthetic and must be labelled as such.
- No external customer claims, benchmarks, production settlement, or wallet custody evidence is available and none may be fabricated.

## Product Principles

1. Prove the framework through working experiences before explaining internals.
2. Domain logic and visual personality are separate, composable layers.
3. The agent chooses from a visual vocabulary; the host owns validation, rendering, and authority.
4. Demo mode works without credentials, while BYOK remains visible and honest.
5. Every impressive interaction should remain inspectable through shared events, cards, tools, and metering records.

## Accessibility & Inclusion

All experiences remain keyboard-operable, retain readable contrast, adapt to desktop and phone widths, and provide reduced-motion behavior for decorative and state animations.
