// GDS Cube: live-preview is a Cube Cloud feature that depends on
// /playground/live-preview/* dev endpoints. We always return null so existing
// callers short-circuit their live-preview branches.
export function useLivePreviewContext(): null {
  return null;
}
