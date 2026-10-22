import type { Metadata } from "next";
import { DocsView } from "@/components/docs/DocsView";
import { guidePage, guidePages } from "@/components/docs/guide";

// Every page is known at build time; the static site has nothing to fall back to.
export const dynamicParams = false;

export function generateStaticParams() {
  return guidePages().filter((p) => p.slug).map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return { title: `${guidePage(slug)?.title ?? "Guide"} — SuperChat` };
}

export default async function DocsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <DocsView slug={slug} />;
}
