import type { IntelligenceEvent } from "@react-intelligence/shared";
import { db } from "../db/client.js";
import {
  filterUnseenEvents,
  getIngestionDiagnostics,
  recordIngestion,
  saveEvents
} from "../db/eventsRepository.js";
import { scrubPayload } from "./privacyService.js";

interface PreparedAppBatch {
  appId: string;
  events: IntelligenceEvent[];
  serializedBytes: number;
}

export interface IngestionBatchResult {
  accepted: number;
  duplicates: number;
  rejected: number;
  acceptedAppIds: string[];
  quotaExceeded?: {
    appId: string;
    diagnostics: NonNullable<ReturnType<typeof getIngestionDiagnostics>>;
  };
}

export function ingestEventBatch(events: IntelligenceEvent[]): IngestionBatchResult {
  const prepared = [...groupEventsByApp(events)].map(([appId, appEvents]) => ({
    appId,
    events: appEvents.map((event) => ({
      ...event,
      payload: scrubPayload(event.payload) as Record<string, unknown>
    })),
    serializedBytes: Buffer.byteLength(JSON.stringify({ events: appEvents }))
  }));

  return persistPreparedBatch(prepared);
}

const persistPreparedBatch = db.transaction((prepared: PreparedAppBatch[]): IngestionBatchResult => {
  const unseenByApp = new Map<string, IntelligenceEvent[]>();
  for (const batch of prepared) {
    const unseenEvents = filterUnseenEvents(batch.events);
    unseenByApp.set(batch.appId, unseenEvents);
    const diagnostics = getIngestionDiagnostics(batch.appId);
    if (diagnostics && diagnostics.remainingEvents < unseenEvents.length) {
      const duplicates = batch.events.length - unseenEvents.length;
      recordIngestion(batch.appId, 0, unseenEvents.length, batch.serializedBytes, duplicates);
      return {
        accepted: 0,
        duplicates,
        rejected: unseenEvents.length,
        acceptedAppIds: [],
        quotaExceeded: { appId: batch.appId, diagnostics }
      };
    }
  }

  let accepted = 0;
  let duplicates = 0;
  const acceptedAppIds: string[] = [];
  for (const batch of prepared) {
    const result = saveEvents(unseenByApp.get(batch.appId) ?? []);
    const appDuplicates = batch.events.length - result.accepted;
    accepted += result.accepted;
    duplicates += appDuplicates;
    recordIngestion(batch.appId, result.accepted, 0, batch.serializedBytes, appDuplicates);
    if (result.accepted) acceptedAppIds.push(batch.appId);
  }
  return { accepted, duplicates, rejected: 0, acceptedAppIds };
});

function groupEventsByApp(events: IntelligenceEvent[]) {
  const groups = new Map<string, IntelligenceEvent[]>();
  for (const event of events) groups.set(event.appId, [...(groups.get(event.appId) ?? []), event]);
  return groups;
}
