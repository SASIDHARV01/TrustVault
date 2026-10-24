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
        <div className="auth-story__matrix" aria-hidden="true" />
        <Link className="brand-link" href="/" aria-label="TrustVault home">
          <BrandMark />
        </Link>
        <div className="auth-story__copy">
          <p className="eyebrow"><span /> Identity gateway // clearance required</p>
          <h1>Enter a workspace where every request must prove itself.</h1>
          <p>
            TrustVault revalidates identity, permission, and document state on
            every protected request. Possessing a link is never clearance.
          </p>
        </div>
        <ul className="auth-promises">
          <li><span>01</span><strong>IDENTITY</strong> Slow password hashes. No plain-text secrets.</li>
          <li><span>02</span><strong>SESSION</strong> Database-backed sessions that can be terminated.</li>
          <li><span>03</span><strong>AUTHORITY</strong> Trusted server data controls administrator access.</li>
        </ul>
        <div className="auth-story__telemetry" aria-hidden="true">
          <span>NODE: TV-AUTH-01</span><span>CHANNEL: ENCRYPTED</span><span>STATUS: ONLINE</span>
        </div>
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
