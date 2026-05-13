import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import SEO from "@/components/SEO";

export default function Privacy() {
  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="Privacy Policy — Collectiblez"
        description="How Collectiblez collects, uses, and protects your data. Read our full privacy policy."
        path="/privacy"
      />
      <div className="container max-w-3xl py-12 px-4 sm:px-8">
        <Button variant="ghost" size="sm" asChild className="mb-6">
          <Link to="/"><ArrowLeft className="w-4 h-4 mr-1" /> Back</Link>
        </Button>

        <h1 className="font-display font-bold text-3xl text-foreground mb-2">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground mb-8">Last updated: {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>

        <div className="prose prose-sm dark:prose-invert max-w-none space-y-6 text-foreground/80">
          <section>
            <h2 className="font-display font-semibold text-lg text-foreground">1. Information We Collect</h2>
            <p>When you create a PokeVault account we collect your email address and, if you sign in via Google, your name and profile picture. We also store the Pokémon TCG card data you add to your collection, including card names, sets, conditions, quantities, and pricing information.</p>
          </section>

          <section>
            <h2 className="font-display font-semibold text-lg text-foreground">2. How We Use Your Information</h2>
            <p>We use your information to:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Provide and maintain your account and collection data</li>
              <li>Display your public profile page (if you choose to publish it)</li>
              <li>Process subscription payments through Stripe</li>
              <li>Send transactional emails (e.g. email verification)</li>
              <li>Improve and optimize the service</li>
            </ul>
          </section>

          <section>
            <h2 className="font-display font-semibold text-lg text-foreground">3. Data Sharing</h2>
            <p>We do not sell your personal data. We share data only with:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Stripe</strong> — for payment processing</li>
              <li><strong>Cloud infrastructure providers</strong> — for hosting and database services</li>
            </ul>
            <p>Your public profile, if published, is visible to anyone with the link.</p>
          </section>

          <section>
            <h2 className="font-display font-semibold text-lg text-foreground">4. Data Storage & Security</h2>
            <p>Your data is stored securely in our cloud database with row-level security policies ensuring users can only access their own data. Passwords are hashed and never stored in plain text. All connections use HTTPS/TLS encryption.</p>
          </section>

          <section>
            <h2 className="font-display font-semibold text-lg text-foreground">5. Cookies</h2>
            <p>We use essential cookies and local storage to maintain your authentication session. We do not use tracking or advertising cookies.</p>
          </section>

          <section>
            <h2 className="font-display font-semibold text-lg text-foreground">6. Your Rights</h2>
            <p>You can request deletion of your account and all associated data at any time by contacting us. You can update or correct your profile information directly through the dashboard.</p>
          </section>

          <section>
            <h2 className="font-display font-semibold text-lg text-foreground">7. Children's Privacy</h2>
            <p>PokeVault is not directed at children under 13. We do not knowingly collect personal information from children under 13.</p>
          </section>

          <section>
            <h2 className="font-display font-semibold text-lg text-foreground">8. Changes to This Policy</h2>
            <p>We may update this Privacy Policy from time to time. Changes will be posted on this page with an updated revision date.</p>
          </section>

          <section>
            <h2 className="font-display font-semibold text-lg text-foreground">9. Contact</h2>
            <p>If you have questions about this Privacy Policy, please reach out via our support channels.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
