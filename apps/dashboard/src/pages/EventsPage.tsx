import * as Dialog from "@radix-ui/react-dialog";
import * as ScrollArea from "@radix-ui/react-scroll-area";
import * as Tabs from "@radix-ui/react-tabs";
import type { IntelligenceEvent } from "@react-intelligence/shared";
import { X } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Card, ErrorState, Loading, SelectBox, } from "../components/ui";
import { api } from "../lib/api";
import { useAsync } from "./hooks";
import {useEventFilters} from "./useEventFilters";

export function EventsPage({ appId }: { appId: string }) {

  const {
    values,
    searchInput,
    setSearchInput,
    setFilter,
    reset,
    apiParams
  } = useEventFilters();

  const { type, route, release, environment, timeRange } = values;

  const requestParams = useMemo(() => {
    const next = new URLSearchParams(apiParams);
    next.set("limit", "100");
    return next;
  }, [apiParams]);
  const { data, loading, error, setData } = useAsync(
      () => api.events(appId, requestParams),
      [appId, requestParams.toString()]
  );

  const [selected, setSelected] = useState<IntelligenceEvent | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [paginationError, setPaginationError] = useState<string>();
  const nextCursor = data?.nextCursor;
  if (loading && !data) return <Loading />;
  if (error) return <ErrorState error={error} />;


  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Events Explorer</h1>
        <p className="mt-1 text-sm text-muted">Filter events and inspect payloads.</p>
      </div>
      <Card>
        <div className="flex flex-wrap gap-3">
          <SelectBox value={type} onValueChange={(nextType) => setFilter("type", nextType)} items={["all", "error", "react_error", "performance", "react_profiler", "network", "console", "user_action", "route_change", "custom"]} />
          <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search route, session or payload" className="h-10 flex-1 rounded-md border border-line bg-ink px-3 text-sm outline-none focus:border-accent" />
          <input value={route} onChange={(event) => setFilter("route", event.target.value)} placeholder="route" className="h-10 flex-1 rounded-md border border-line bg-ink px-3 text-sm outline-none focus:border-accent" />
          <input value={release} onChange={(event) => setFilter("release", event.target.value)} placeholder="release" className="h-10 flex-1 rounded-md border border-line bg-ink px-3 text-sm outline-none focus:border-accent" />
          <input value={environment} onChange={(event) => setFilter("environment", event.target.value)} placeholder="environment" className="h-10 flex-1 rounded-md border border-line bg-ink px-3 text-sm outline-none focus:border-accent" />
          <SelectBox value={timeRange} onValueChange={(nextTimeRange) => setFilter("timeRange", nextTimeRange)} items={["1h", "24h", "7d", "30d", "all"]}/>
          <button onClick={reset} className="h-10 rounded-md border border-line px-3 text-sm hover:bg-line">
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
            <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm">
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
            </table></div>
            {!data?.events.length && <p className="p-6 text-sm text-muted">No events match these filters.</p>}
            {data?.events.length ? <div className="flex items-center justify-between border-t border-line p-3 text-sm text-muted">
              <span>{data.events.length} events loaded{loading ? " · refreshing…" : ""}</span>
              {nextCursor ? <button disabled={loadingMore} onClick={async () => {
                setLoadingMore(true);
                setPaginationError(undefined);
                try {
                  const nextParams = new URLSearchParams(requestParams);
                  nextParams.set("cursor", nextCursor.timestamp);
                  nextParams.set("cursorId", nextCursor.id);
                  const nextPage = await api.events(appId, nextParams);
                  setData({ events: [...data.events, ...nextPage.events], nextCursor: nextPage.nextCursor });
                } catch (nextError) {
                  setPaginationError(nextError instanceof Error ? nextError.message : "Could not load older events");
                } finally {
                  setLoadingMore(false);
                }
              }} className="rounded-md border border-line px-3 py-2 text-slate-100 hover:bg-line disabled:opacity-50">{loadingMore ? "Loading…" : "Load older events"}</button> : <span>End of results</span>}
            </div> : null}
            {paginationError ? <p role="alert" className="border-t border-line p-3 text-sm text-bad">{paginationError}</p> : null}
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
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[80vh] w-[min(760px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-panel p-4 shadow-2xl">
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
