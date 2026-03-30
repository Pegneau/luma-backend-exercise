//RetryableError — transient, recoverable failure
//Use when the operation failed due to temporary conditions that may resolve
//on their own: network timeout, EHR temporarily offline, rate-limit (429),
//upstream 5xx, etc
//Queue behaviour: nack WITH requeue → message is returned to the queue
//for another consumer to retry (with back-off handled at the queue level)

export class RetryableError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);

    this.name = "RetryableError";
    this.cause = cause;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, new.target);
    }
  }
}
