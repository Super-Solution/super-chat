import type { Metadata } from "next";
import { InstallView } from "@/components/docs/InstallView";

export const metadata: Metadata = { title: "Install — SuperChat" };

export default function Install() {
  return <InstallView />;
}
