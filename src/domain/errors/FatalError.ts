// FatalError — permanent, non-recoverable failure.
// Use when the operation cannot succeed regardless of how many times it is
// retried: invalid mapping, resource not found, bad credentials, malformed
// payload, etc.
// Queue behaviour: nack WITHOUT requeue → message goes to the dead-letter queue.

export class FatalError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);

    this.name = "FatalError";
    this.cause = cause;

    // Capture a clean stack trace that starts at the call site, not inside
    // this constructor, when running on V8 (Node.js).
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, new.target);
    }
  }
}
