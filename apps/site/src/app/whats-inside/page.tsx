import type { Metadata } from "next";
import { WhatsInside } from "../../components/inside/WhatsInside";

export const metadata: Metadata = {
  title: "What's inside | Super Chat",
  description: "The agent interface, paid AI with routing and billing, charts an agent can mark up, and reports an agent can edit with reviewable changes.",
};

export default function Page() {
  return <WhatsInside />;
}
