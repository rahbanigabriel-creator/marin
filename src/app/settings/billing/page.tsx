import type { Metadata } from "next";

import { BillingSettings } from "@/components/billing/BillingSettings";

export const metadata: Metadata = {
  title: "Billing and usage",
  robots: { index: false, follow: false },
};

export default function BillingSettingsPage() {
  return <BillingSettings />;
}
