import * as Dialog from "@radix-ui/react-dialog";
import * as ScrollArea from "@radix-ui/react-scroll-area";
import * as Tabs from "@radix-ui/react-tabs";
import type { IntelligenceEvent } from "@react-intelligence/shared";
import { X } from "lucide-react";
import { useMemo, useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Badge, Card, ErrorState, Loading, SelectBox, } from "../components/ui";
import { api } from "../lib/api";
import { useAsync } from "./hooks";

export function EventsPage({ appId }: { appId: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const type = searchParams.get("type") ?? "all";
  const route = searchParams.get("route") ?? "";
  const release = searchParams.get("release") ?? "";
  const environment = searchParams.get("environment") ?? "";
  const timeRange = searchParams.get("timeRange") ?? "24h";
  const search = searchParams.get("search") ?? "";
  const [searchInput, setSearchInput] = useState(search);

  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  useEffect(() => {
    if (searchInput === search) return;

    const timeout = window.setTimeout(() => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);

        if (searchInput) {
          next.set("search", searchInput);
        } else {
          next.delete("search");
        }

        return next;
      });
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [searchInput, search, setSearchParams]);


  const params = useMemo(() => {
    const next = new URLSearchParams(searchParams);

    if (next.get("type") === "all") next.delete("type");
    if (next.get("timeRange") === "all") next.delete("timeRange");

    return next;
  }, [searchParams]);

  const { data, loading, error } = useAsync(() => api.events(appId, params), [appId, params.toString()]);
  const [selected, setSelected] = useState<IntelligenceEvent | null>(null);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorState error={error} />;

  function updateFilter(key: string, value: string) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);

      if (!value || value === "all") {
        next.delete(key);
      } else {
        next.set(key, value);
      }

      return next;

    });
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Events Explorer</h1>
        <p className="mt-1 text-sm text-muted">Filter events and inspect payloads.</p>
      </div>
      <Card>
        <div className="flex gap-3">
          <SelectBox value={type} onValueChange={(nextType) => updateFilter("type", nextType)} items={["all", "error", "react_error", "performance", "react_profiler", "network", "console", "user_action", "route_change", "custom"]} />
          <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search route, session or payload" className="h-10 flex-1 rounded-md border border-line bg-ink px-3 text-sm outline-none focus:border-accent" />
          <input value={route} onChange={(event) => updateFilter("route", event.target.value)} placeholder="route" className="h-10 flex-1 rounded-md border border-line bg-ink px-3 text-sm outline-none focus:border-accent" />
          <input value={release} onChange={(event) => updateFilter("release", event.target.value)} placeholder="release" className="h-10 flex-1 rounded-md border border-line bg-ink px-3 text-sm outline-none focus:border-accent" />
          <input value={environment} onChange={(event) => updateFilter("environment", event.target.value)} placeholder="environment" className="h-10 flex-1 rounded-md border border-line bg-ink px-3 text-sm outline-none focus:border-accent" />
          <SelectBox value={timeRange} onValueChange={(nextTimeRange) => updateFilter("timeRange", nextTimeRange)} items={["1h", "24h", "7d", "30d", "all"]}/>
          <button onClick={() => setSearchParams({})}>
            Reset
          </button>
        </div>
      </Card>
      <Tabs.Root defaultValue="table">
        <Tabs.List className="mb-3 flex gap-2">
          <Tabs.Trigger value="table" className="rounded-md border border-line px-3 py-2 text-sm data-[state=active]:bg-line">Table</Tabs.Trigger>
          <Tabs.Trigger value="raw" className="rounded-md border border-line px-3 py-2 text-sm data-[state=active]:bg-line">Raw</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="table">
          <Card className="overflow-hidden p-0">
            <table className="w-full text-left text-sm">
              <thead className="bg-ink text-xs uppercase text-muted"><tr><th className="p-3">Timestamp</th><th>Type</th><th>Route</th><th>Session</th><th>Summary</th></tr></thead>
              <tbody>
                {(data?.events ?? []).map((event) => (
                  <tr key={event.id} onClick={() => setSelected(event)} className="cursor-pointer border-t border-line hover:bg-line/40">
                    <td className="p-3 text-muted">{new Date(event.timestamp).toLocaleString()}</td>
                    <td><Badge tone={event.type.includes("error") ? "bad" : "neutral"}>{event.type}</Badge></td>
                    <td>{event.route ?? "-"}</td>
                    <td className="text-muted">{event.sessionId}</td>
                    <td className="max-w-md truncate">{summary(event)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data?.events.length && <p className="p-6 text-sm text-muted">No events match these filters.</p>}
          </Card>
        </Tabs.Content>
        <Tabs.Content value="raw"><Card><pre className="overflow-auto text-xs">{JSON.stringify(data?.events ?? [], null, 2)}</pre></Card></Tabs.Content>
      </Tabs.Root>
      <PayloadDialog event={selected} onOpenChange={(open) => !open && setSelected(null)} />
    </div>
  );
}

function PayloadDialog({ event, onOpenChange }: { event: IntelligenceEvent | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog.Root open={Boolean(event)} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[80vh] w-[760px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-panel p-4 shadow-2xl">
          <div className="mb-3 flex items-center justify-between">
            <Dialog.Title className="font-semibold">Event Payload</Dialog.Title>
            <Dialog.Close className="rounded p-1 hover:bg-line"><X size={18} /></Dialog.Close>
          </div>
          <ScrollArea.Root className="h-[60vh] rounded bg-ink p-3">
            <ScrollArea.Viewport className="h-full w-full">
              <pre className="text-xs">{JSON.stringify(event, null, 2)}</pre>
            </ScrollArea.Viewport>
            <ScrollArea.Scrollbar orientation="vertical" className="w-2 bg-line"><ScrollArea.Thumb className="rounded bg-muted" /></ScrollArea.Scrollbar>
          </ScrollArea.Root>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function summary(event: IntelligenceEvent) {
  return String(event.payload.message ?? event.payload.url ?? event.payload.name ?? event.payload.action ?? event.payload.kind ?? event.type);
}

