export function formatCreationElapsed(creation, nowMs = Date.now()) {
  const deadlineMs = creation?.timeoutAt ? new Date(creation.timeoutAt).getTime() : null;
  const startedAtMs = creation?.createdAt ? new Date(creation.createdAt).getTime() : null;
  const ageMs = Number.isFinite(startedAtMs) ? Math.max(0, nowMs - startedAtMs) : 0;

  if ((Number.isFinite(deadlineMs) && nowMs > deadlineMs) || ageMs > 60 * 60_000) {
    return "Recovery delayed";
  }

  const elapsedSeconds = Math.floor(ageMs / 1000);
  return elapsedSeconds < 60 ? "Just started" : `${Math.floor(elapsedSeconds / 60)}m elapsed`;
}
