/** How long a process may spend closing before it is cut: under the 30 seconds most hosts wait before SIGKILL. */
export const SHUTDOWN_GRACE_MS = 25_000;

type ShutdownLog = {
  info: (details: object, message: string) => void;
  error: (details: object, message: string) => void;
};

type Signals = Pick<NodeJS.Process, 'once'>;

/**
 * Runs `close` once on SIGTERM or SIGINT, then exits: 0 when it finished, 1 when it threw or ran past
 * the grace. Without it a deploy kills the process mid-request and mid-job, and BullMQ runs those jobs
 * again from the start once they are seen as stalled.
 */
export function onShutdown(
  close: () => Promise<unknown>,
  log: ShutdownLog,
  options: { graceMs?: number; signals?: Signals; exit?: (code: number) => void } = {},
): void {
  const signals = options.signals ?? process;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const graceMs = options.graceMs ?? SHUTDOWN_GRACE_MS;
  let closing = false;

  const shutDown = (signal: string) => {
    // A second Ctrl-C while closing does nothing; the grace still cuts a close that hangs.
    if (closing) return;
    closing = true;
    log.info({ signal }, 'shutting down');
    const timer = setTimeout(() => {
      log.error({ graceMs }, 'shutdown ran past its grace; exiting anyway');
      exit(1);
    }, graceMs);
    timer.unref?.();
    close().then(
      () => {
        clearTimeout(timer);
        log.info({}, 'shut down');
        exit(0);
      },
      (error: unknown) => {
        clearTimeout(timer);
        log.error({ err: error instanceof Error ? error.message : String(error) }, 'shutdown failed');
        exit(1);
      },
    );
  };

  for (const signal of ['SIGTERM', 'SIGINT'] as const) signals.once(signal, () => shutDown(signal));
}
