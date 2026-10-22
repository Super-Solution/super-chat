import type { Metadata } from "next";
import { DocsView } from "@/components/docs/DocsView";

export const metadata: Metadata = { title: "Guide — SuperChat" };

export default function DocsIndex() {
  return <DocsView slug="" />;
}
