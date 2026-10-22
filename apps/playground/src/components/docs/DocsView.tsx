import Link from "next/link";
import { notFound } from "next/navigation";
import { playgroundPath } from "@/agent/deployment";
import { docsHref, guidePage, guidePages } from "./guide";
import { Toc } from "./Toc";
import styles from "./docs.module.css";

// One layout for every guide page: the page list, the article, and the page's
// own sections. Nothing above the article but its own title.
export function DocsView({ slug }: { slug: string }) {
  const pages = guidePages();
  const page = guidePage(slug);
  if (!page) notFound();
  const at = pages.indexOf(page);
  const next = pages[at + 1];

  return (
    <div className={`${styles.page} ${styles.docs}`}>
      <nav className={styles.side} aria-label="Guide">
        <ul>
          {pages.map((p) => (
            <li key={p.slug}>
              <Link href={docsHref(p.slug)} aria-current={p.slug === slug ? "page" : undefined}>{p.title}</Link>
            </li>
          ))}
        </ul>
        <ul>
          <li><Link href="/install">Install</Link></li>
          <li><Link href={playgroundPath("/cards")}>Playground</Link></li>
        </ul>
      </nav>

      <article className={styles.article}>
        <div className={styles.prose} dangerouslySetInnerHTML={{ __html: page.html }} />
        {next ? (
          <Link className={styles.next} href={docsHref(next.slug)}>{next.title} →</Link>
        ) : null}
      </article>

      {page.headings.length > 1 ? <Toc headings={page.headings} /> : null}
    </div>
  );
}
