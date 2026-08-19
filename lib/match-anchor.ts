export function matchAnchorId(externalEventId: string): string {
  return `partido-${externalEventId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}
