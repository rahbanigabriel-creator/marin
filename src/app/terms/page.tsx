import type { Metadata } from "next";
import { LegalShell, H2, P, Bullets } from "@/components/legal/LegalShell";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms governing your use of Marpin.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalShell title="Terms of Service" updated="Effective: 25 June 2026">
      <P>
        These Terms of Service (&quot;Terms&quot;) govern your access to and use of Marpin (the
        &quot;Service&quot;), operated by <strong>Gabriel Rahbani</strong>, Barcelona, Spain
        (&quot;Marpin&quot;, &quot;we&quot;, &quot;us&quot;). By using the Service, you agree to these Terms.
        If you do not agree, do not use the Service.
      </P>

      <H2>1. The Service</H2>
      <P>
        Marpin is an AI marketing assistant that analyses your market, connects to your marketing and
        analytics accounts to read your data, and helps you plan and create marketing work. The Service is
        provided on an &quot;as is&quot; basis and is in active development (beta); features may change,
        break, or be removed.
      </P>

      <H2>2. Eligibility &amp; accounts</H2>
      <P>
        You must be at least 18 years old to use Marpin. You are responsible for the activity under your
        account and for keeping your credentials secure. You agree to provide accurate information.
      </P>

      <H2>3. Connecting your accounts</H2>
      <P>
        When you connect a third-party platform (such as Google Ads, Google Analytics, Meta, LinkedIn, or
        TikTok), you represent that you are authorised to connect that account and to grant Marpin access to
        its data. You can disconnect at any time. Your use of each platform remains subject to that
        platform&apos;s own terms.
      </P>

      <H2>4. AI output — review before you rely on it</H2>
      <P>
        Marpin uses AI to generate analyses, recommendations, copy, and plans. This output may be inaccurate,
        incomplete, or unsuitable for your situation, and is <strong>not</strong> professional, legal,
        financial, or tax advice. You are responsible for reviewing all output before relying on or acting on
        it.
      </P>

      <H2>5. Actions require your approval</H2>
      <P>
        Marpin proposes actions — it does not take them on its own. Anything that spends money or publishes
        publicly (e.g. launching a campaign or posting content) is a proposal that requires your explicit
        approval. You are responsible for the actions you approve and for the resulting spend and content.
      </P>

      <H2>6. Acceptable use</H2>
      <P>You agree not to:</P>
      <Bullets
        items={[
          "Use the Service for any unlawful, harmful, deceptive, or abusive purpose.",
          "Connect accounts you are not authorised to access.",
          "Attempt to disrupt, reverse-engineer, or gain unauthorised access to the Service or its data.",
          "Use the Service to violate any third-party platform’s terms or applicable advertising rules.",
        ]}
      />

      <H2>7. Billing</H2>
      <P>
        Paid plans, where offered, are billed through our payment processor on the terms shown at purchase.
        Fees are exclusive of taxes unless stated. You can cancel as described in the Service; cancellation
        stops future charges and does not refund amounts already paid unless required by law.
      </P>

      <H2>8. Intellectual property</H2>
      <P>
        The Service, including its software and design, belongs to Marpin. You retain ownership of the content
        and data you provide and the connected-account data we process on your behalf. You grant us the
        permissions needed to operate the Service for you.
      </P>

      <H2>9. Disclaimers</H2>
      <P>
        The Service is provided &quot;as is&quot; and &quot;as available&quot;, without warranties of any
        kind, whether express or implied, including fitness for a particular purpose, accuracy, or
        uninterrupted availability, to the maximum extent permitted by law.
      </P>

      <H2>10. Limitation of liability</H2>
      <P>
        To the maximum extent permitted by law, Marpin shall not be liable for any indirect, incidental,
        special, consequential, or punitive damages, or for lost profits, revenues, data, or marketing spend,
        arising out of or relating to your use of the Service. Nothing in these Terms limits liability that
        cannot be limited under applicable law.
      </P>

      <H2>11. Termination</H2>
      <P>
        You may stop using the Service and delete your account at any time. We may suspend or terminate access
        if you breach these Terms or to protect the Service. On termination, the relevant provisions of these
        Terms survive.
      </P>

      <H2>12. Governing law</H2>
      <P>
        These Terms are governed by the laws of Spain, without regard to conflict-of-laws rules. The courts of
        Barcelona, Spain shall have jurisdiction, subject to any mandatory consumer-protection rights you have
        under local law.
      </P>

      <H2>13. Changes</H2>
      <P>
        We may update these Terms from time to time. We will post the updated version here and update the
        date. Your continued use of the Service after changes take effect constitutes acceptance.
      </P>

      <H2>14. Contact</H2>
      <P>
        Questions about these Terms? Contact Gabriel Rahbani at{" "}
        <a className="text-plum underline" href="mailto:rahbanigabriel@gmail.com">
          rahbanigabriel@gmail.com
        </a>
        .
      </P>
    </LegalShell>
  );
}
