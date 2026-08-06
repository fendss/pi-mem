export function normalizeHarnessRefs(refs: readonly number[]): number[] {
  return [...new Set(refs.map((ref) => ref === 0 ? 1 : ref))];
}
