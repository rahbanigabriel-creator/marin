import type { Metadata } from "next";
import { LegalShell, H2, P, Bullets } from "@/components/legal/LegalShell";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Marpin collects, uses, stores, and protects your data, and your rights under the GDPR.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy" updated="Effective: 25 June 2026">
      <P>
        This Privacy Policy explains how Marpin (&quot;Marpin&quot;, &quot;we&quot;, &quot;us&quot;) collects, uses,
        stores, and protects your personal data, and the rights you have. Marpin is operated by{" "}
        <strong>Gabriel Rahbani</strong>, an individual based in Barcelona, Spain, who acts as the data
        controller. You can reach us at{" "}
        <a className="text-plum underline" href="mailto:rahbanigabriel@gmail.com">
          rahbanigabriel@gmail.com
        </a>
        .
      </P>
      <P>
        Marpin is an AI marketing assistant. It is in active development (beta). We aim to collect only what we
        need to provide the service, and we never sell your personal data.
      </P>

      <H2>1. Information we collect</H2>
      <Bullets
        items={[
          <>
            <strong>Account information</strong> — when you sign up, your name and email address (handled by our
            authentication provider) and your workspace details.
          </>,
          <>
            <strong>Connected-account data</strong> — if you connect a marketing or analytics platform (e.g.
            Google Ads, Google Analytics, Search Console, Meta, LinkedIn, TikTok), we receive and store
            OAuth access/refresh tokens for that account, the account identifier, and the marketing metrics we
            sync on your behalf (such as spend, conversions, ROAS, CPA, and campaign names).
          </>,
          <>
            <strong>Content you provide</strong> — the questions, prompts, website URLs, and instructions you
            enter, and any assets you upload.
          </>,
          <>
            <strong>Usage and technical data</strong> — basic product-analytics and error/diagnostic data
            (e.g. pages viewed, feature usage, crash logs) used to operate and improve the service.
          </>,
          <>
            <strong>Billing data</strong> — if you subscribe, our payment processor handles your card details;
            we store only your subscription status, never your full card number.
          </>,
        ]}
      />

      <H2>2. How we use your data</H2>
      <P>We process your data to:</P>
      <Bullets
        items={[
          "Provide, operate, and maintain the service — including syncing your connected-account metrics and generating analyses, plans, and content.",
          "Authenticate you and secure your account.",
          "Process payments and manage subscriptions, where applicable.",
          "Monitor, debug, and improve the service.",
          "Communicate with you about the service and respond to your requests.",
        ]}
      />
      <P>
        Our legal bases under the GDPR are: performance of our contract with you (to provide the service);
        your consent (e.g. when you connect a platform); and our legitimate interests (to secure and improve
        the service), balanced against your rights.
      </P>

      <H2>3. Connected platforms &amp; limited use</H2>
      <P>
        When you connect a platform, you authorise Marpin to access the data covered by the permissions
        (scopes) shown on that platform&apos;s consent screen — read-only access to your advertising and
        analytics data, used solely to provide the features you ask for. We do not use this data for
        advertising, and we do not sell it.
      </P>
      <P>
        <strong>Google user data.</strong> Marpin&apos;s use and transfer of information received from Google
        APIs adheres to the{" "}
        <a
          className="text-plum underline"
          href="https://developers.google.com/terms/api-services-user-data-policy"
          target="_blank"
          rel="noreferrer"
        >
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements. Data obtained from Google APIs is used only to provide and
        improve the user-facing features you request, is not transferred to third parties except as needed to
        provide those features (or for security/legal reasons), is not used for advertising, and is not read
        by humans except with your consent, for security, or as required by law.
      </P>
      <P>
        Data obtained from Meta, LinkedIn, TikTok, and other platforms is likewise used only to provide the
        service and handled in accordance with each platform&apos;s developer terms.
      </P>

      <H2>4. How we share your data</H2>
      <P>
        We do not sell your personal data. We share it only with service providers (sub-processors) that help
        us run Marpin, under contracts that require them to protect it:
      </P>
      <Bullets
        items={[
          "Hosting & infrastructure (application hosting and serverless functions).",
          "Database (a managed, EU-region Postgres database where your data is stored).",
          "Background job processing (to run scheduled and event-driven data syncs).",
          "Authentication (to manage sign-in and accounts).",
          "AI processing (to generate analyses and content from your prompts).",
          "Payments (to process subscriptions, where applicable).",
          "Product analytics & error monitoring (to operate and improve the service).",
          "Email delivery (for transactional messages).",
        ]}
      />
      <P>
        We may also disclose data where required by law, to protect rights and safety, or in connection with a
        business transfer. A current list of sub-processors is available on request.
      </P>

      <H2>5. International transfers</H2>
      <P>
        Your data is stored in the European Union where possible. Some of our sub-processors may process data
        outside the EU; where they do, we rely on appropriate safeguards such as the European Commission&apos;s
        Standard Contractual Clauses.
      </P>

      <H2>6. How we protect your data</H2>
      <P>
        Connected-account tokens are encrypted at rest using authenticated AES-256-GCM encryption and are
        never stored in plain text. All traffic is served over HTTPS. We apply access controls and
        feature-detect credentials so that data is only processed when properly secured.
      </P>

      <H2>7. How long we keep it</H2>
      <P>
        We keep your data for as long as your account is active and as needed to provide the service. When you
        disconnect a platform, we revoke and delete its stored tokens. When you delete your account or request
        erasure, we delete your personal data (subject to any limited retention required by law), as described
        on our{" "}
        <a className="text-plum underline" href="/data-deletion">
          Data Deletion
        </a>{" "}
        page.
      </P>

      <H2>8. Your rights</H2>
      <P>Under the GDPR, you have the right to:</P>
      <Bullets
        items={[
          "Access the personal data we hold about you.",
          "Rectify inaccurate or incomplete data.",
          "Erase your data (“right to be forgotten”).",
          "Restrict or object to certain processing.",
          "Data portability — receive your data in a portable format.",
          "Withdraw consent at any time (e.g. by disconnecting a platform), without affecting prior processing.",
        ]}
      />
      <P>
        To exercise any of these, email{" "}
        <a className="text-plum underline" href="mailto:rahbanigabriel@gmail.com">
          rahbanigabriel@gmail.com
        </a>
        . You also have the right to lodge a complaint with your local data protection authority — in Spain,
        the Agencia Española de Protección de Datos (AEPD).
      </P>

      <H2>9. Children</H2>
      <P>Marpin is not intended for, and may not be used by, anyone under 18 years of age.</P>

      <H2>10. Changes to this policy</H2>
      <P>
        We may update this policy from time to time. We will post the new version here and update the date at
        the top. Material changes will be communicated where appropriate.
      </P>

      <H2>11. Contact</H2>
      <P>
        Questions about this policy or your data? Contact Gabriel Rahbani at{" "}
        <a className="text-plum underline" href="mailto:rahbanigabriel@gmail.com">
          rahbanigabriel@gmail.com
        </a>
        , Barcelona, Spain.
      </P>
    </LegalShell>
  );
}
