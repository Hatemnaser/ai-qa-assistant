const UPLOAD_REPLAY_GRACE_MS = 5 * 60 * 1000;

/**
 * A signed PUT may be replayed until expiry. Delaying deletion until after the
 * URL and a clock-skew grace expire prevents it recreating an untracked object.
 */
export function getAssetDeletionNotBefore(uploadExpiresAt: Date | null | undefined, now = new Date()) {
  if (!uploadExpiresAt) return now;

  return new Date(Math.max(now.getTime(), uploadExpiresAt.getTime() + UPLOAD_REPLAY_GRACE_MS));
}

export const ASSET_UPLOAD_REPLAY_GRACE_MS = UPLOAD_REPLAY_GRACE_MS;
