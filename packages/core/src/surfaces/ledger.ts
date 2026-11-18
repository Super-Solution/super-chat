// Where surfaces live between tool calls.
//
// A surface's state is DERIVED from the active branch: the newest snapshot of it
// on the path from root to head. Nothing is stored beside the thread, so switching
// branch, regenerating and reloading all give the right answer for free, and a
// branch that never updated a surface shows it as that branch left it.

import type { Message } from "../content/types.js";
import { SURFACE_CARD_KIND, SURFACE_FORMAT_VERSION, type SurfaceSpec } from "./types.js";

const CARD_ID_PREFIX = "surface:";
export const SURFACE_ARTIFACT_KIND = `card:${SURFACE_CARD_KIND}`;

/** One card id per surface, so a later snapshot replaces the earlier one in a run. */
export const surfaceCardId = (surfaceId: string): string => `${CARD_ID_PREFIX}${surfaceId}`;

export function isSurfaceSpec(value: unknown): value is SurfaceSpec {
  return typeof value === "object" && value !== null && (value as { kind?: unknown }).kind === SURFACE_CARD_KIND && typeof (value as { surfaceId?: unknown }).surfaceId === "string";
}

function expiredStub(surfaceId: string): SurfaceSpec {
  return { kind: SURFACE_CARD_KIND, version: SURFACE_FORMAT_VERSION, surfaceId, root: "", components: [], data: {}, revision: 0, expired: true };
}

/** The current state of every surface on a message path. Later snapshots win. */
export function foldSurfaces(messages: readonly Message[]): Record<string, SurfaceSpec> {
  const out: Record<string, SurfaceSpec> = {};
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "artifact" || part.kind !== SURFACE_ARTIFACT_KIND) continue;
      const data = part.data as { expired?: boolean } | null;
      if (data?.expired === true && part.id.startsWith(CARD_ID_PREFIX)) {
        const surfaceId = part.id.slice(CARD_ID_PREFIX.length);
        out[surfaceId] = expiredStub(surfaceId);
      } else if (isSurfaceSpec(part.data)) {
        out[part.data.surfaceId] = part.data;
      }
    }
  }
  return out;
}

/** The working copy a run reads and writes, so two calls in one step see each other. */
export class SurfaceLedger {
  private readonly surfaces = new Map<string, SurfaceSpec>();

  constructor(initial: Record<string, SurfaceSpec> = {}) {
    for (const [id, spec] of Object.entries(initial)) this.surfaces.set(id, spec);
  }

  get(surfaceId: string): SurfaceSpec | undefined {
    return this.surfaces.get(surfaceId);
  }

  put(spec: SurfaceSpec): void {
    this.surfaces.set(spec.surfaceId, spec);
  }

  list(): SurfaceSpec[] {
    return [...this.surfaces.values()];
  }

  /** Surfaces still on screen. */
  live(): SurfaceSpec[] {
    return this.list().filter((s) => !s.deleted && !s.expired);
  }
}
