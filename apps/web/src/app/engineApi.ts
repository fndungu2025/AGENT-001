// The engine (parsers, worker, maths) is loaded on demand so the start screen stays small.
export function loadEngine(): Promise<typeof import("../engine")> {
  return import("../engine");
}
