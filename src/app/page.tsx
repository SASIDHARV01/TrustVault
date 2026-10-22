import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";
import { siteConfig } from "@/lib/site-config";

const workflow = [
  {
    number: "01",
    title: "Upload privately",
    copy: "Files enter private object storage. A public URL is never the key to access.",
  },
  {
    number: "02",
    title: "Grant by name",
    copy: "Owners choose a person and give exactly read or edit access to one document.",
  },
  {
    number: "03",
    title: "Verify every action",
    copy: "Each request is rechecked and sensitive outcomes join a tamper-evident trail.",
  },
];

const architecture = [
  ["Application", "Next.js + TypeScript"],
  ["Identity", "Better Auth sessions"],
  ["Data", "Supabase PostgreSQL"],
  ["Documents", "Private Cloudflare R2"],
];

function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 10h12M11 5l5 5-5 5" />
    </svg>
  );
}

export default function Home() {
  return (
    <main>
      <nav className="nav shell" aria-label="Primary navigation">
        <a className="brand-link" href="#top">
          <BrandMark />
        </a>
        <div className="nav__links">
          {siteConfig.navigation.map((item) => (
            <a key={item.href} href={item.href}>
              {item.label}
            </a>
          ))}
        </div>
        <div className="nav__auth">
          <Link href="/login">Sign in</Link>
          <Link className="button button--primary" href="/register">Open your vault</Link>
        </div>
      </nav>

      <section className="hero shell" id="top">
        <div className="hero__copy">
          <p className="eyebrow">
            <span /> Confidential sharing, accountable by design
          </p>
          <h1>
            Sensitive files deserve more than a <em>share link.</em>
          </h1>
          <p className="hero__lede">
            TrustVault gives document owners precise control, makes revocation
            immediate, and records both successful and refused actions in a
            trail built to reveal tampering.
          </p>
          <div className="hero__actions">
            <Link className="button button--primary" href="/register">
              Create secure account <ArrowIcon />
            </Link>
            <a className="button button--ghost" href="#security">
              Read the security promise
            </a>
          </div>
          <ul className="trust-list" aria-label="Core safeguards">
            {siteConfig.safeguards.map((safeguard) => (
              <li key={safeguard}>
                <span aria-hidden="true">✓</span> {safeguard}
              </li>
            ))}
          </ul>
        </div>

        <div className="vault-card" aria-label="Access decision preview">
          <div className="vault-card__glow" />
          <div className="vault-card__topline">
            <span className="status-dot" /> Live authorization decision
            <span>TV-006</span>
          </div>
          <div className="document-card">
            <div className="document-card__icon" aria-hidden="true">
              PDF
            </div>
            <div>
              <strong>Compensation Review.pdf</strong>
              <span>Confidential · 2.4 MB</span>
            </div>
            <span className="document-card__lock">Locked</span>
          </div>
          <div className="decision-path">
            <div>
              <span className="path-icon">1</span>
              <p><strong>Identity verified</strong><small>Database session is active</small></p>
            </div>
            <div>
              <span className="path-icon">2</span>
              <p><strong>Permission checked</strong><small>Named READ grant found</small></p>
            </div>
            <div>
              <span className="path-icon path-icon--success">✓</span>
              <p><strong>Access allowed</strong><small>Audit event #8F32 appended</small></p>
            </div>
          </div>
          <div className="revocation-note">
            <span>↻</span>
            <p><strong>Revoke now</strong><small>The next request is denied—no stale link survives.</small></p>
          </div>
        </div>
      </section>

      <section className="proof-strip" id="security">
        <div className="shell proof-strip__inner">
          <p>Designed around a simple rule</p>
          <blockquote>
            “The server decides. <span>Every route. Every time.</span>”
          </blockquote>
          <span className="proof-strip__tag">Deny by default</span>
        </div>
      </section>

      <section className="section shell" id="workflow">
        <div className="section__heading">
          <p className="eyebrow"><span /> How it works</p>
          <h2>Three steps. No hidden trust.</h2>
          <p>Every layer has one job, and no browser control is mistaken for security.</p>
        </div>
        <div className="workflow-grid">
          {workflow.map((item) => (
            <article key={item.number} className="workflow-card">
              <span className="workflow-card__number">{item.number}</span>
              <h3>{item.title}</h3>
              <p>{item.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section shell architecture" id="architecture">
        <div className="architecture__copy">
          <p className="eyebrow"><span /> Deliberately boring infrastructure</p>
          <h2>A small stack we can understand and defend.</h2>
          <p>
            One application, one authorization boundary, managed data services,
            and tests written from an attacker&apos;s point of view.
          </p>
          <p className="release-note">
            Public repository arrives with the release <ArrowIcon />
          </p>
        </div>
        <dl className="stack-list">
          {architecture.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <footer className="footer shell">
        <BrandMark />
        <p>Built for confidential work—and honest security evidence.</p>
        <span>© 2026 TrustVault</span>
      </footer>
    </main>
  );
}
