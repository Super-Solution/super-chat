/** Build-time switches shared by the local playground and the static showcase. */
export const IS_STATIC_DEMO = process.env.NEXT_PUBLIC_STATIC_DEMO === "true";

/** Keep the local dev-panel URLs stable while giving the public site a clear namespace. */
export function playgroundPath(path = "/"): string {
  if (!IS_STATIC_DEMO) return path;
  return path === "/" ? "/playground" : `/playground${path}`;
}
