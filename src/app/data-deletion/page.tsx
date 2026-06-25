import type { Metadata } from "next";
import { LegalShell, H2, P, Bullets } from "@/components/legal/LegalShell";

export const metadata: Metadata = {
  title: "Data Deletion",
  description: "How to delete your data from Marpin, including connected-account data.",
  alternates: { canonical: "/data-deletion" },
};

export default function DataDeletionPage() {
  return (
    <LegalShell title="Data Deletion" updated="Effective: 25 June 2026">
      <P>
        You can delete your data from Marpin at any time. This page explains how, and what happens — including
        the data we receive from connected platforms such as Google, Meta, LinkedIn, and TikTok.
      </P>

      <H2>1. Disconnect a single platform</H2>
      <P>
        In the app, open <strong>Manage connections</strong> and disconnect any platform. When you disconnect,
        we revoke and delete the stored access/refresh tokens for that platform. You can reconnect later at any
        time.
      </P>

      <H2>2. Delete all your data</H2>
      <P>
        To delete your entire account and all associated data, email{" "}
        <a className="text-plum underline" href="mailto:rahbanigabriel@gmail.com?subject=Data%20deletion%20request">
          rahbanigabriel@gmail.com
        </a>{" "}
        from the address associated with your account, with the subject &quot;Data deletion request&quot;. We
        will verify the request and delete your data.
      </P>

      <H2>3. What gets deleted</H2>
      <Bullets
        items={[
          "Your connected-account tokens (already encrypted at rest), so we can no longer access any platform on your behalf.",
          "The marketing metrics and campaign data we synced for you.",
          "Your account profile, workspace, and the content you provided (prompts, URLs, uploaded assets).",
        ]}
      />
      <P>
        We may retain a minimal amount of data where required by law (for example, billing records), and
        anonymised or aggregated data that no longer identifies you.
      </P>

      <H2>4. How long it takes</H2>
      <P>
        We action deletion requests promptly and complete them within 30 days. Disconnecting a platform takes
        effect immediately.
      </P>

      <H2>5. Platform-specific notes</H2>
      <P>
        If you connected your account through Meta (Facebook/Instagram), this page also serves as Marpin&apos;s
        data-deletion instructions for the Meta platform. Disconnecting in the app, or emailing the address
        above, will remove the data Marpin received via Meta. You may also remove Marpin&apos;s access from
        your platform&apos;s own app/connection settings (e.g. Meta Business settings, your Google Account
        permissions), which independently revokes our access.
      </P>

      <H2>6. Contact</H2>
      <P>
        For any deletion question, contact Gabriel Rahbani at{" "}
        <a className="text-plum underline" href="mailto:rahbanigabriel@gmail.com">
          rahbanigabriel@gmail.com
        </a>
        , Barcelona, Spain.
      </P>
    </LegalShell>
  );
}
