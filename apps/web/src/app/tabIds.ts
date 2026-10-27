export const TAB_IDS = [
  "overview",
  "quality",
  "segments",
  "customers",
  "predictions",
  "export",
] as const;
export type TabId = (typeof TAB_IDS)[number];
export function isTabId(s: string): s is TabId {
  return (TAB_IDS as readonly string[]).includes(s);
}
