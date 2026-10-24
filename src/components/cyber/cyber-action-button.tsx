"use client";

import { useEffect, useState, type ButtonHTMLAttributes } from "react";

type CyberActionButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  idleLabel: string;
  pending: boolean;
  stages: readonly string[];
};

export function CyberActionButton({
  className = "",
  disabled,
  idleLabel,
  pending,
  stages,
  ...props
}: CyberActionButtonProps) {
  const [stageIndex, setStageIndex] = useState(0);

  useEffect(() => {
    if (!pending) {
      setStageIndex(0);
      return;
    }

    const intervalId = window.setInterval(() => {
      setStageIndex((current) => Math.min(current + 1, stages.length - 1));
    }, 1100);

    return () => window.clearInterval(intervalId);
  }, [pending, stages.length]);

  return (
    <button
      {...props}
      aria-busy={pending}
      className={`button button--primary cyber-action-button ${className}`.trim()}
      disabled={disabled || pending}
    >
      {pending ? <span className="cyber-action-button__spinner" aria-hidden="true" /> : null}
      <span aria-live="polite">{pending ? stages[stageIndex] : idleLabel}</span>
      <span className="cyber-action-button__signal" aria-hidden="true">
        <i /><i /><i />
      </span>
    </button>
  );
}
