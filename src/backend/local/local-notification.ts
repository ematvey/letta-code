export function dispatchLocalBackendNotification<T>(
  hook: ((info: T) => void | Promise<void>) | undefined,
  info: T,
): void {
  if (!hook) return;
  try {
    void Promise.resolve(hook(info)).catch(() => {});
  } catch {
    // Notification hooks must never block or break backend work.
  }
}
