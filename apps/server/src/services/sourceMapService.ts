import { originalPositionFor, TraceMap } from "@jridgewell/trace-mapping";
import type { IntelligenceEvent } from "@react-intelligence/shared";
import { findSourceMaps } from "../db/eventsRepository.js";

export function symbolicateEvents(appId: string, events: IntelligenceEvent[]) {
  return events.map((event) => symbolicateEvent(appId, event));
}

export function symbolicateEvent(appId: string, event: IntelligenceEvent): IntelligenceEvent {
  const stack = typeof event.payload.stack === "string" ? event.payload.stack : undefined;
  if (!stack || !event.release) return event;
  const maps = findSourceMaps(appId, event.release);
  if (!maps.length) return event;

  const symbolicatedStack = stack.split("\n").map((line) => {
    const match = line.match(/([^\s()/]+\.js):(\d+):(\d+)/);
    if (!match) return line;
    const sourceMap = maps.find((candidate) => match[1].endsWith(candidate.bundleName) || candidate.bundleName.endsWith(match[1]));
    if (!sourceMap) return line;
    try {
      const position = originalPositionFor(new TraceMap(sourceMap.map), {
        line: Number(match[2]), column: Math.max(0, Number(match[3]) - 1)
      });
      if (!position.source || position.line === null || position.column === null) return line;
      return `${line} → ${position.source}:${position.line}:${position.column + 1}${position.name ? ` (${position.name})` : ""}`;
    } catch {
      return line;
    }
  }).join("\n");

  return symbolicatedStack === stack ? event : { ...event, payload: { ...event.payload, symbolicatedStack } };
}
