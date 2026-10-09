import type { TestSessionDetail, TestSessionMessage } from "../test-sessions/types";

export type SessionTimelineEntry =
  | { kind: "message"; id: string; createdAt: string; position?: number | null; message: TestSessionMessage }
  | { kind: "event"; id: string; createdAt: string; position?: number | null; event: NonNullable<TestSessionDetail["events"]>[number] };

export function sessionTimeline(session: TestSessionDetail | null): SessionTimelineEntry[] {
  if (!session) return [];
  const entries: SessionTimelineEntry[] = [
    ...session.messages.map(message => ({ kind: "message" as const, id: `message:${message.id}`, createdAt: message.createdAt, position: message.timelinePosition, message })),
    ...(session.events || []).map(event => ({ kind: "event" as const, id: `event:${event.id}`, createdAt: event.createdAt, position: event.timelinePosition, event })),
  ];
  const chronological = (a: SessionTimelineEntry, b: SessionTimelineEntry) => a.createdAt.localeCompare(b.createdAt) ||
    (a.kind === 'event' && b.kind === 'event' && a.event.requestId === b.event.requestId ? a.event.sequence - b.event.sequence : 0) || a.id.localeCompare(b.id);
  // Keep the authoritative sequence intact. Previously unlinked QA records have
  // no session position; insert them deterministically using their original dates.
  const positioned = entries.filter(entry => entry.position != null).sort((a, b) => a.position! - b.position! || a.id.localeCompare(b.id));
  for (const historical of entries.filter(entry => entry.position == null).sort(chronological)) {
    const index = positioned.findIndex(entry => chronological(entry, historical) > 0);
    positioned.splice(index < 0 ? positioned.length : index, 0, historical);
  }
  return positioned;
}
