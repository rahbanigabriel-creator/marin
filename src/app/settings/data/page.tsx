import type { Metadata } from "next";

import { DataPrivacySettings } from "@/components/settings/DataPrivacySettings";

export const metadata: Metadata = {
  title: "Data and privacy",
  robots: { index: false, follow: false },
};

export default function DataPrivacySettingsPage() {
  return <DataPrivacySettings />;
}

