import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";

export function AuthShell({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <main className="auth-page">
      <section className="auth-story">
        <Link className="brand-link" href="/" aria-label="TrustVault home">
          <BrandMark />
        </Link>
        <div className="auth-story__copy">
          <p className="eyebrow"><span /> Protected workspace</p>
          <h1>Your documents stay private until the server says otherwise.</h1>
          <p>
            Every protected request revalidates the database session. A page,
            cookie, or guessed URL is never treated as permission.
          </p>
        </div>
        <ul className="auth-promises">
          <li><span>01</span> Passwords are stored as slow hashes, never plain text.</li>
          <li><span>02</span> Sessions live in PostgreSQL and can be invalidated.</li>
          <li><span>03</span> Administrator access comes only from trusted data.</li>
        </ul>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <p className="auth-card__eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
          <p className="auth-card__description">{description}</p>
          {children}
        </div>
      </section>
    </main>
  );
}
