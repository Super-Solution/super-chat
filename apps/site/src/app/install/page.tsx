import type { Metadata } from "next";
import { InstallPage } from "../../components/install/InstallPage";

export const metadata: Metadata = { title: "Install | Super Chat" };

export default function Install() {
  return <InstallPage />;
}
