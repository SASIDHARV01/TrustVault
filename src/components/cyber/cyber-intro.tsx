"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export function CyberIntro() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (pathname !== "/") {
      setVisible(false);
      return;
    }

    setVisible(true);

    const timeoutId = window.setTimeout(() => {
      setVisible(false);
    }, 5850);

    return () => window.clearTimeout(timeoutId);
  }, [pathname]);

  if (pathname !== "/" || !visible) return null;

  return (
    <div className="cyber-intro" role="status" aria-label="TrustVault secure channel initialization">
      <div className="cyber-intro__letterbox cyber-intro__letterbox--top" aria-hidden="true" />
      <div className="cyber-intro__letterbox cyber-intro__letterbox--bottom" aria-hidden="true" />
      <div className="cyber-intro__grid" aria-hidden="true" />
      <div className="cyber-intro__telemetry" aria-hidden="true">
        <span>TRUSTVAULT // CINEMATIC SECURITY PROTOCOL</span>
        <span>NODE 08 · CHANNEL 0x8F32 · SIGNAL LOCKED</span>
      </div>
      <div className="cyber-intro__fragments" aria-hidden="true">
        <i>IDENTITY</i><i>POLICY</i><i>PRIVATE</i><i>REVOKE</i><i>AUDIT</i><i>DENIED</i>
      </div>
      <div className="cyber-intro__energy" aria-hidden="true" />
      <div className="cyber-intro__portal cyber-intro__portal--outer" aria-hidden="true" />
      <div className="cyber-intro__portal cyber-intro__portal--inner" aria-hidden="true" />
      <div className="cyber-intro__core" aria-hidden="true">
        <svg viewBox="0 0 64 64">
          <path d="M32 5 53 13v15.5C53 41.8 44.5 52 32 57 19.5 52 11 41.8 11 28.5V13L32 5Z" />
          <path d="m23 32 6 6 13-15" />
        </svg>
      </div>
      <div className="cyber-intro__packet" aria-hidden="true">
        <span>PDF</span><small>CONFIDENTIAL</small>
      </div>
      <div className="cyber-intro__copy">
        <span className="cyber-intro__code">TV://SECURE-MULTIVERSE</span>
        <strong><span>TRUST</span><span>VAULT</span></strong>
        <em>EVERY REQUEST MUST PROVE ITSELF</em>
        <div className="cyber-intro__messages" aria-hidden="true">
          <span>IDENTITY VERIFIED</span>
          <span>ACCESS POLICY CONFIRMED</span>
          <span>DOCUMENT SEALED</span>
          <span>AUDIT CHANNEL ACTIVE // ENTERING VAULT</span>
        </div>
      </div>
      <div className="cyber-intro__final-flash" aria-hidden="true" />
      <div className="cyber-intro__progress" aria-hidden="true"><span /></div>
    </div>
  );
}
