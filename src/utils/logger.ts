// Structured JSON logger.
type LogLevel = "info" | "warn" | "error";

type LogContext = Record<string, unknown>;

function write(level: LogLevel, message: string, context?: LogContext): void {
  const entry = JSON.stringify({
    ...context, //Context first to ensure it doesn't get overwritten by message or timestamp
    level,
    message,
    timestamp: new Date().toISOString(),
  });

  if (level === "error") {
    console.error(entry);
  } else if (level === "warn") {
    console.warn(entry);
  } else {
    console.log(entry);
  }
}

export const logger = {
  /** Milestones: job started, step completed, results summary. */
  info: (message: string, context?: LogContext) =>
    write("info", message, context),
  /** Recoverable issues: unknown status code, missing optional field. */
  warn: (message: string, context?: LogContext) =>
    write("warn", message, context),
  /** Failures that require action or cause the operation to abort. */
  error: (message: string, context?: LogContext) =>
    write("error", message, context),
};
