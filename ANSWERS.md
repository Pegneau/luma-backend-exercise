# ANSWERS.md

1. **FHIR:** What is the role of the `participant` array in a FHIR Appointment? How would you extract the patient ID from it?

The participant array links all actors involved in the appointment, such as patients, practitioners, and locations.
To extract the patient ID, I iterate through this array to find an entry where the actor.reference starts with the "Patient/" prefix.
In my implementation, the fhirToInternal mapper handles this extraction and throws a FatalError if no patient is found.
This ensures the system never attempts to sync an appointment that cannot be linked to a valid Luma patient.

2. **Queue semantics:** Why do we nack without requeue for fatal errors but requeue for retryable ones? What could go wrong if you always requeued on any error?

I use a nack without requeue for Fatal Errors (like malformed JSON) because these failures are permanent and retrying would never succeed.
Requeueing these messages would create a "poison pill loop", wasting CPU resources and blocking the queue for other messages.
Instead, these are routed to a Dead Letter Queue (DLQ) via the luma.dlx exchange for manual inspection.
I only use requeue for Retryable Errors (like timeouts or 5xx), where the issue is transient and likely to resolve on the next attempt.

3. **Observability:** A sync job processes 0 appointments when 50 were expected. What would your logs need to contain to quickly determine whether the problem is in the EHR fetch, the mapping, or the reconciliation step?

My logs include stage-specific counters like ehrCount, dbCount, and elapsedMs to pinpoint where the sync stopped.
If ehrCount is 0, the issue is in the Fetch step, meaning the EHR returned an empty response or the date filters were too restrictive.
If ehrCount is 50 but the final results (created/updated/cancelled) are all 0, the problem is in the Reconciliation logic or the data simply hasn't changed (a valid no-op).
Every log includes the facilityId and integratorId, allowing us to isolate and debug specific sync jobs in a multi-tenant environment.

4. **Error design:** What's the advantage of distinct error classes (`RetryableError`, `FatalError`) over a single error class with a boolean flag?

Using distinct classes like RetryableError and FatalError allows the QueueConsumer to use instanceof for clean and type-safe routing.
Unlike a boolean flag, which can be easily forgotten or misconfigured, separate classes provide a clear contract that is self-documenting for any developer reading the service layer.
This design also makes the system easier to extend, as we can add specific metadata (like a retryAfter delay) only to relevant error types.
Finally, it prevents "poison messages" by ensuring that unexpected errors default to a non-retryable path.
