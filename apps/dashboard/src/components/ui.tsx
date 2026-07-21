import * as Select from "@radix-ui/react-select";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`card p-4 ${className}`}>{children}</section>;
}

export function MetricCard({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return (
    <Card>
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-normal">{value}</p>
      {detail ? <p className="mt-1 text-xs text-muted">{detail}</p> : null}
    </Card>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warn" | "bad" }) {
  const toneClass = tone === "good" ? "border-good/40 text-good" : tone === "warn" ? "border-warn/40 text-warn" : tone === "bad" ? "border-bad/40 text-bad" : "";
  return <span className={`badge ${toneClass}`}>{children}</span>;
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="card flex min-h-48 flex-col items-center justify-center p-8 text-center">
      <p className="text-lg font-semibold">{title}</p>
      <p className="mt-2 max-w-md text-sm text-muted">{description}</p>
    </div>
  );
}

export function Loading() {
  return <div className="card p-8 text-sm text-muted">Loading telemetry...</div>;
}

export function ErrorState({ error }: { error: unknown }) {
  return <div className="card border-bad/40 p-4 text-sm text-bad">{error instanceof Error ? error.message : "Something went wrong"}</div>;
}

export function SelectBox({ value, onValueChange, items }: { value: string; onValueChange: (value: string) => void; items: string[] }) {
  return (
    <Select.Root value={value} onValueChange={onValueChange}>
      <Select.Trigger className="flex h-10 min-w-36 items-center justify-between rounded-md border border-line bg-ink px-3 text-sm">
        <Select.Value />
        <Select.Icon><ChevronDown size={16} /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="z-50 rounded-md border border-line bg-panel shadow-xl">
          <Select.Viewport className="p-1">
            {items.map((item) => (
              <Select.Item key={item} value={item} className="cursor-pointer rounded px-3 py-2 text-sm outline-none hover:bg-line">
                <Select.ItemText>{item}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
