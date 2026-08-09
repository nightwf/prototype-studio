import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import "./styles.css";

export function StatusDot({ tone = "neutral", children }: { tone?: "neutral" | "success" | "warning" | "danger" | "info"; children: ReactNode }) {
  return <span className={`ps-status-dot ps-status-dot--${tone}`}><i />{children}</span>;
}

export function ToolButton({ active, compact, children, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; compact?: boolean }) {
  return (
    <button
      className={`ps-tool-button ${active ? "is-active" : ""} ${compact ? "is-compact" : ""} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function PanelHeader({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: ReactNode }) {
  return (
    <div className="ps-panel-header">
      <div>
        {eyebrow ? <div className="ps-eyebrow">{eyebrow}</div> : null}
        <h2>{title}</h2>
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="ps-empty-state">
      {icon ? <div className="ps-empty-icon">{icon}</div> : null}
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function Keycap({ children, ...props }: HTMLAttributes<HTMLElement>) {
  return <kbd className="ps-keycap" {...props}>{children}</kbd>;
}

export const designTokens = {
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  radius: { small: 4, medium: 8, large: 12 },
  font: { body: 14, title: 20 },
  version: "0.1.0"
} as const;
