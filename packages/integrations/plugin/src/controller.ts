import type { CardRef, CardRefEvent, CardRefResult } from "@supersolutions/super-chat-core";
import type { CardMount, CardMountContext, CardMountHandle } from "@supersolutions/super-protocol";

/** A card handle that may answer references (`ref()` is optional in super-protocol 0.3.0); one without it does not answer. */
type RefHandle = CardMountHandle;

/**
 * Owns the lifecycle of one mounted card, independent of any UI framework:
 * mount once, forward updates, destroy exactly once. A mount that throws is
 * contained and reported, so one broken plugin cannot take down the thread.
 */
export class MountController {
  private handle: RefHandle | undefined;

  constructor(
    private mount: CardMount,
    private onError: (error: unknown) => void = () => {},
  ) {}

  attach(container: HTMLElement, spec: unknown, context: CardMountContext): void {
    this.detach();
    try {
      this.handle = this.mount(container, spec, context);
    } catch (error) {
      this.onError(error);
    }
  }

  update(spec: unknown, context: CardMountContext): void {
    if (!this.handle) return;
    try {
      this.handle.update(spec, context);
    } catch (error) {
      this.onError(error);
    }
  }

  /**
   * Asks the mounted card to show, clear or reveal what a reference points at. A card that
   * does not implement `ref()`, or one that throws, answers as unavailable: the text then reads
   * as text, which is the right failure for a sentence about a card.
   */
  ref(ref: CardRef | null, event: CardRefEvent): CardRefResult {
    const handle = this.handle;
    if (!handle) return { ok: false, code: "ref_no_card", reason: "this card is not shown." };
    if (!handle.ref) return { ok: false, code: "ref_unsupported", reason: "this card does not take references." };
    try {
      return handle.ref(ref, event);
    } catch (error) {
      this.onError(error);
      return { ok: false, code: "ref_failed", reason: "this card could not show that." };
    }
  }

  detach(): void {
    const handle = this.handle;
    this.handle = undefined;
    if (!handle) return;
    try {
      handle.destroy();
    } catch (error) {
      this.onError(error);
    }
  }

  get attached(): boolean {
    return this.handle !== undefined;
  }
}
