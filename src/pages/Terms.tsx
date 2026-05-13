import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import SEO from "@/components/SEO";

export default function Terms() {
  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="Terms of Service — Collectiblez"
        description="The terms governing your use of Collectiblez, our free and Pro tiers, and your responsibilities as a user."
        path="/terms"
      />
      <div className="container max-w-3xl py-12 px-4 sm:px-8">
        <Button variant="ghost" size="sm" asChild className="mb-6">
          <Link to="/"><ArrowLeft className="w-4 h-4 mr-1" /> Back</Link>
        </Button>

        <h1 className="font-display font-bold text-3xl text-foreground mb-2">Terms of Service</h1>
        <p className="text-sm text-muted-foreground mb-8">Last updated: {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>

        <div className="prose prose-sm dark:prose-invert max-w-none space-y-6 text-foreground/80">
          <section>
            <h2 className="font-display font-semibold text-lg text-foreground">1. Acceptance of Terms</h2>
            <p>By accessing or using PokeVault ("the Service"), you agree to be bound by these Terms of Service. If you do not agree, do not use the Service.</p>
          </section>

          <section>
            <h2 className="font-display font-semibold text-lg text-foreground">2. Description of Service</h2>
            <p>PokeVault is a Pokémon TCG collection tracking and portfolio management tool. We provide card search, collection organization, market price tracking, and shareable public profiles.</p>
          </section>

          <section>
            <h2 className="font-display font-semibold text-lg text-foreground">3. User Accounts</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>You must provide a valid email address to create an account</li>
              <li>You are responsible for maintaining the security of your account credentials</li>
              <li>You must be at least 13 years old to use the Service</li>
              <li>One person may not maintain more than one free account</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display font-semibold text-lg text-foreground">4. Free & Pro Tiers</h2>
            <p>PokeVault offers a free tier with card limits and a paid Pro tier with expanded features. Pro subscriptions are billed through Stripe. You may cancel at any time; access continues until the end of your billing period.</p>
          </section>

          <section>
            <h2 className="font-display font-semibold text-lg text-foreground">5. User Content</h2>
            <p>You retain ownership of any content you submit (profile data, links, collection data). By publishing a public profile, you grant PokeVault a license to display that content publicly. You may unpublish your profile at any time.</p>
          </section>

          <section>
            <h2 className="font-display font-semibold text-lg text-foreground">6. Prohibited Conduct</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Do not use the Service for illegal purposes</li>
              <li>Do not attempt to access other users' data</li>
              <li>Do not abuse, scrape, or overload our APIs</li>
              <li>Do not impersonate others on your public profile</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display font-semibold text-lg text-foreground">7. Disclaimer of Warranties</h2>
            <p>The Service is provided "as is" without warranties of any kind. Card prices shown are estimates from third-party sources and should not be considered financial advice. We do not guarantee the accuracy of market data.</p>
          </section>

          <section>
            <h2 className="font-display font-semibold text-lg text-foreground">8. Limitation of Liability</h2>
            <p>PokeVault shall not be liable for any indirect, incidental, or consequential damages arising from your use of the Service.</p>
          </section>

          <section>
            <h2 className="font-display font-semibold text-lg text-foreground">9. Termination</h2>
            <p>We reserve the right to suspend or terminate accounts that violate these terms. You may delete your account at any time.</p>
          </section>

          <section>
            <h2 className="font-display font-semibold text-lg text-foreground">10. Changes to Terms</h2>
            <p>We may modify these Terms at any time. Continued use of the Service after changes constitutes acceptance of the updated Terms.</p>
          </section>

          <section>
            <h2 className="font-display font-semibold text-lg text-foreground">11. Contact</h2>
            <p>Questions about these Terms? Reach out through our support channels.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
