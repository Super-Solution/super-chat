// Reads docs/guide at build time and turns it into pages for /docs.
//
// The markdown files stay the source of truth: the site renders them, it does
// not keep a second copy. Links between guide pages become /docs routes; any
// other relative link (package READMEs, source files) points at GitHub, since
// the site does not host the rest of the repository.

import fs from "node:fs";
import path from "node:path";
import { Marked, type Tokens } from "marked";

export const REPO_BLOB = "https://github.com/Super-Solution/super-chat/blob/main";

// Both apps live two levels below the repo root, and both build from there.
const GUIDE_DIR = path.resolve(process.cwd(), "../../docs/guide");
// Raw links in rendered HTML don't get Next's basePath, so add it here.
const BASE = process.env.PAGES_BASE_PATH ?? "";

export type GuideHeading = { id: string; text: string };
export type GuidePage = { slug: string; title: string; html: string; headings: GuideHeading[] };

const slugOf = (file: string): string => {
  const name = path.basename(file, ".md");
  return name === "README" ? "" : name;
};

export const docsHref = (slug: string): string => (slug ? `/docs/${slug}` : "/docs");

function rewriteHref(href: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#")) return href;
  const [rel = "", hash] = href.split("#");
  const target = path.posix.normalize(path.posix.join("docs/guide", rel));
  const suffix = hash ? `#${hash}` : "";
  if (target.startsWith("docs/guide/") && target.endsWith(".md")) {
    return `${BASE}${docsHref(slugOf(target))}${suffix}`;
  }
  return `${REPO_BLOB}/${target}${suffix}`;
}

const anchor = (text: string): string =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z]+;/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

const marked = new Marked({
  gfm: true,
  walkTokens(token) {
    if (token.type === "link") (token as Tokens.Link).href = rewriteHref((token as Tokens.Link).href);
  },
});

function render(source: string): Pick<GuidePage, "html" | "headings"> {
  const headings: GuideHeading[] = [];
  const raw = marked.parse(source, { async: false }) as string;
  // marked emits bare headings; give h2/h3 ids so the page can link to them.
  const html = raw.replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (_m, level: string, inner: string) => {
    const id = anchor(inner);
    if (level === "2") headings.push({ id, text: inner.replace(/<[^>]+>/g, "") });
    return `<h${level} id="${id}">${inner}</h${level}>`;
  });
  return { html, headings };
}

let cache: GuidePage[] | undefined;

/** Every guide page, README first, then in the order the README links them. */
export function guidePages(): GuidePage[] {
  if (cache) return cache;
  const files = fs.readdirSync(GUIDE_DIR).filter((f) => f.endsWith(".md"));
  const readme = fs.readFileSync(path.join(GUIDE_DIR, "README.md"), "utf8");
  const linked = [...readme.matchAll(/\]\(([a-z0-9-]+\.md)\)/g)].map((m) => m[1]!);
  const rank = (f: string) => (f === "README.md" ? -1 : linked.indexOf(f) === -1 ? 999 : linked.indexOf(f));
  cache = files
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((file) => {
      const source = fs.readFileSync(path.join(GUIDE_DIR, file), "utf8");
      const title = /^#\s+(.+)$/m.exec(source)?.[1]?.trim() ?? slugOf(file);
      return { slug: slugOf(file), title, ...render(source) };
    });
  return cache;
}

export function guidePage(slug: string): GuidePage | undefined {
  return guidePages().find((p) => p.slug === slug);
}
