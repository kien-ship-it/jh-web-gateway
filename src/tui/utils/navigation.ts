/**
 * Computes a wrapped index after moving `delta` steps through a list of `listSize` items.
 * Handles both positive (down) and negative (up) deltas, wrapping around boundaries.
 */
export function wrapIndex(current: number, delta: number, listSize: number): number {
  return ((current + delta) % listSize + listSize) % listSize;
}
