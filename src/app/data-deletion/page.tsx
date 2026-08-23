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
        the data we receive from connected platforms such as Google, Meta, and TikTok.
      </P>

      <H2>1. Disconnect a single platform</H2>
      <P>
        In the app, open <strong>Manage connections</strong> and disconnect any platform. When you disconnect,
        we delete the selected account and its stored credentials from Marpin. Where the provider supports safe
        grant revocation, Marpin also requests it. If another selected account still shares that provider grant,
        Marpin keeps the remote grant so the sibling connection is not broken and tells you in the result. You
        can revoke the entire grant at any time from the provider&apos;s own account settings.
      </P>

      <H2>2. Delete all your data</H2>
      <P>
        While signed in, open <strong>Settings → Data &amp; privacy</strong> and choose <strong>Delete workspace</strong>.
        The in-app request stops active jobs, cancels an active subscription, attempts supported provider
        revocation, removes private assets, and then removes workspace data. You can follow its saved status
        and retry any required cleanup step. If you cannot sign in, email{" "}
        <a className="text-plum underline" href="mailto:rahbanigabriel@gmail.com?subject=Data%20deletion%20request">
          rahbanigabriel@gmail.com
        </a>{" "}
        from the address associated with your account, with the subject &quot;Data deletion request&quot;. We will
        verify the request before acting.
      </P>

      <H2>3. What gets deleted</H2>
      <Bullets
        items={[
          "Your connected-account tokens (already encrypted at rest), so we can no longer access any platform on your behalf.",
          "The marketing metrics and campaign data we synced for you.",
          "Your Marpin workspace, membership, agent-run history, and the content you provided (prompts, URLs, uploaded assets). For a personal workspace, Marpin also attempts to remove the corresponding sign-in identity; organization identities may remain available to their organization.",
        ]}
      />
      <P>
        We may retain a minimal amount of data where required by law (for example, billing records), and
        anonymised or aggregated data that no longer identifies you.
      </P>

      <H2>4. How long it takes</H2>
      <P>
        We action deletion requests promptly and complete them within 30 days. Disconnecting a platform takes
        effect in Marpin immediately; provider-side revocation may need to be completed in the provider&apos;s own
        settings when a shared grant must be retained or the provider cannot confirm revocation.
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
