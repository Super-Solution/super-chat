import type { CardMount, CardMountContext, CardMountHandle } from "@supersolutions/super-protocol";

/**
 * Owns the lifecycle of one mounted card, independent of any UI framework:
 * mount once, forward updates, destroy exactly once. A mount that throws is
 * contained and reported, so one broken plugin cannot take down the thread.
 */
export class MountController {
  private handle: CardMountHandle | undefined;

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
