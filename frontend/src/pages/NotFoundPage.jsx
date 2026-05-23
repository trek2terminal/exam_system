import { Link } from "react-router-dom";
import { ArrowLeft, SearchX } from "lucide-react";
import { Button, Card } from "../components/ui";

export default function NotFoundPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-background-base px-4 py-10 text-text-primary">
      <Card className="w-full max-w-lg p-8 text-center">
        <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-full bg-brand-primary/10 text-brand-primary">
          <SearchX size={34} />
        </div>
        <p className="text-sm font-semibold uppercase text-text-muted">404</p>
        <h1 className="mt-2 text-3xl font-bold text-text-primary">Page not found</h1>
        <p className="mt-3 text-text-secondary">
          The page may have moved, or the address may be incomplete.
        </p>
        <Button as={Link} to="/" variant="primary" size="md" className="mt-6">
          <ArrowLeft size={18} />
          Back to dashboard
        </Button>
      </Card>
    </main>
  );
}
