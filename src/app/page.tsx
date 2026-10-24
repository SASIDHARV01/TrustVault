import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";

const protocol = [
  { code: "01 // INGEST", title: "Lock the source", copy: "Documents enter private object storage. A public URL never becomes authority.", accent: "cyan" },
  { code: "02 // CLEARANCE", title: "Name the identity", copy: "The owner grants view or edit clearance to a specific TrustVault identity.", accent: "magenta" },
  { code: "03 // VERIFY", title: "Challenge every request", copy: "Identity, permission, state, and version are rechecked by the server every time.", accent: "yellow" },
  { code: "04 // EVIDENCE", title: "Seal the outcome", copy: "Allowed, denied, and failed actions join a tamper-evident audit chain.", accent: "red" },
];

function ArrowIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 10h13M11 5l5 5-5 5" /></svg>;
}

function HexIcon({ type }: { type: "identity" | "permission" | "audit" }) {
  const paths = {
    identity: <><circle cx="16" cy="12" r="4" /><path d="M8 26c1.5-5 5-7 8-7s6.5 2 8 7" /></>,
    permission: <><path d="M8 15.5 13 20l11-11" /><path d="M16 3 28 8v8c0 7-4.8 11.6-12 14C8.8 27.6 4 23 4 16V8l12-5Z" /></>,
    audit: <><path d="M8 6h16v21H8z" /><path d="M12 12h8M12 17h8M12 22h5" /></>,
  };
  return <svg className="hex-icon" viewBox="0 0 32 32" aria-hidden="true">{paths[type]}</svg>;
}

export default function Home() {
  return (
    <main className="cyber-home">
      <div className="cyber-home__noise" aria-hidden="true" />
      <nav className="cyber-nav shell" aria-label="Primary navigation">
        <a className="brand-link" href="#top"><BrandMark /></a>
        <div className="cyber-nav__status" aria-hidden="true">
          <span className="cyber-pulse" /> SYSTEM ONLINE <i /> AUDIT CHANNEL 0x8F32
        </div>
        <div className="cyber-nav__auth">
          <Link href="/login">Authenticate</Link>
          <Link className="button button--primary" href="/register">Enter the vault</Link>
        </div>
      </nav>

      <section className="cyber-hero shell" id="top">
        <div className="cyber-hero__copy">
          <p className="cyber-label"><span>SECURE MULTIVERSE</span> // DOCUMENT CLEARANCE NETWORK</p>
          <h1>Every file enters another <em>dimension of security.</em></h1>
          <p className="cyber-hero__lede">
            TrustVault turns confidential sharing into a live authorization protocol.
            Identity is verified, permission is rechecked, revocation is immediate,
            and every outcome leaves evidence.
          </p>
          <div className="cyber-hero__actions">
            <Link className="button button--primary" href="/register">Initialize secure identity <ArrowIcon /></Link>
            <a className="button button--ghost" href="#breach-scenario">Run the scenario</a>
          </div>
          <div className="cyber-hero__telemetry" aria-label="TrustVault safeguards">
            <span><i>01</i> PRIVATE STORAGE</span>
            <span><i>02</i> LIVE REVOCATION</span>
            <span><i>03</i> VERIFIABLE AUDIT</span>
          </div>
        </div>

        <div className="multiverse-console" aria-label="Live authorization simulation">
          <div className="multiverse-console__header">
            <span><i className="cyber-pulse" /> AUTHORIZATION ENGINE</span><code>TV-NODE//06</code>
          </div>
          <div className="multiverse-portal" aria-hidden="true">
            <span className="multiverse-portal__ring multiverse-portal__ring--one" />
            <span className="multiverse-portal__ring multiverse-portal__ring--two" />
            <span className="multiverse-portal__ring multiverse-portal__ring--three" />
            <span className="multiverse-portal__document">PDF<small>CLASSIFIED</small></span>
            <span className="multiverse-portal__orbit multiverse-portal__orbit--one">IDENTITY</span>
            <span className="multiverse-portal__orbit multiverse-portal__orbit--two">POLICY</span>
            <span className="multiverse-portal__orbit multiverse-portal__orbit--three">AUDIT</span>
          </div>
          <div className="authorization-sequence">
            <div><HexIcon type="identity" /><span><small>IDENTITY MATRIX</small><strong>Session verified</strong></span><b>PASS</b></div>
            <div><HexIcon type="permission" /><span><small>CLEARANCE LAYER</small><strong>Named READ grant</strong></span><b>PASS</b></div>
            <div><HexIcon type="audit" /><span><small>EVIDENCE CHANNEL</small><strong>Event sealed #8F32</strong></span><b>LIVE</b></div>
          </div>
          <div className="multiverse-console__footer"><span>DECISION</span><strong>ACCESS GRANTED</strong><code>12.8ms</code></div>
        </div>
      </section>

      <section className="cyber-marquee" aria-hidden="true">
        <div>DENY BY DEFAULT <span>◆</span> SERVER AUTHORIZATION <span>◆</span> IMMEDIATE REVOCATION <span>◆</span> TAMPER-EVIDENT HISTORY <span>◆</span> DENY BY DEFAULT <span>◆</span> SERVER AUTHORIZATION</div>
      </section>

      <section className="breach-section shell" id="breach-scenario">
        <div className="section-signal"><span>INCIDENT SIMULATION // 001</span><i /></div>
        <div className="breach-heading">
          <h2>A salary letter was shared.<br />Then the situation changed.</h2>
          <p>A normal link keeps travelling. TrustVault forces every new request back through the authorization boundary.</p>
        </div>
        <div className="scenario-grid">
          <article className="scenario-card scenario-card--threat">
            <header><span>WITHOUT CONTROL</span><strong>EXPOSURE PATH</strong></header>
            <div className="scenario-document"><i>PDF</i><span><strong>Salary-Letter.pdf</strong><small>Forwarded link remains active</small></span></div>
            <div className="scenario-path" aria-hidden="true"><span>OWNER</span><i /><span>RECIPIENT</span><i /><span>UNKNOWN</span></div>
            <footer><span>!</span> Permission changed. Old link still works.</footer>
          </article>
          <article className="scenario-card scenario-card--secure">
            <header><span>WITH TRUSTVAULT</span><strong>ZERO-STALE ACCESS</strong></header>
            <div className="scenario-document"><i>PDF</i><span><strong>Salary-Letter.pdf</strong><small>Every request returns to policy</small></span></div>
            <div className="scenario-path" aria-hidden="true"><span>IDENTITY</span><i /><span>POLICY</span><i className="is-blocked" /><span>DENIED</span></div>
            <footer><span>✓</span> Grant revoked. The next request is denied.</footer>
          </article>
        </div>
      </section>

      <section className="protocol-section shell" id="protocol">
        <div className="section-signal"><span>TRUST PROTOCOL // FOUR LAYERS</span><i /></div>
        <div className="protocol-heading">
          <h2>The browser asks.<br /><em>The server decides.</em></h2>
          <p>No hidden trust. No permission implied by a page, cookie, or guessed URL.</p>
        </div>
        <div className="protocol-grid">
          {protocol.map((item) => (
            <article className={`protocol-card protocol-card--${item.accent}`} key={item.code}>
              <span>{item.code}</span><h3>{item.title}</h3><p>{item.copy}</p><i aria-hidden="true" />
            </article>
          ))}
        </div>
      </section>

      <section className="revocation-section">
        <div className="shell revocation-section__inner">
          <div className="revocation-orbit" aria-hidden="true"><span>REVOKE</span><i /><i /><i /></div>
          <div>
            <p className="cyber-label"><span>CONTROL RETURNS TO THE OWNER</span></p>
            <h2>End access now.<br />Not after the link expires.</h2>
            <p>Revocation changes the database truth. The next preview, download, metadata request, or version action is authorized against that new truth.</p>
            <Link className="button button--primary" href="/register">Create your secure workspace <ArrowIcon /></Link>
          </div>
        </div>
      </section>

      <footer className="cyber-footer shell">
        <BrandMark /><p>CONFIDENTIAL SHARING // ACCOUNTABLE BY DESIGN</p><span>© 2026 TRUSTVAULT // NODE ONLINE</span>
      </footer>
    </main>
  );
}
