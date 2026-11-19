import { useSyncExternalStore } from "react";
import type { CardValueFormat } from "@supersolutions/super-chat-core";
import { formatDelta, formatValue, STABLE_FORMAT, type FormatOptions } from "@supersolutions/super-chat-ui-core";

const subscribe = () => () => undefined;

/**
 * Formatting for the current render: fixed on the server and during hydration,
 * then the viewer's own locale and time zone. Cards mounted after hydration use
 * the viewer's settings from their first render.
 */
export function useFormatOptions(): FormatOptions | undefined {
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  return hydrated ? undefined : STABLE_FORMAT;
}

export function FormattedValue({ value, format }: { value: unknown; format?: CardValueFormat }) {
  return <>{formatValue(value, format, useFormatOptions())}</>;
}

export function FormattedDelta({ delta, format }: { delta: number; format?: CardValueFormat }) {
  return <>{formatDelta(delta, format, useFormatOptions())}</>;
}
