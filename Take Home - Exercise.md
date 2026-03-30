# Luma Health — Take-Home Exercise

**Language:** TypeScript
**Submit:** Push your solution to a GitHub repo and share the link.

---

## Overview

At Luma Health we integrate with dozens of EHR systems to sync and manage patient appointments. In this exercise you will build two features that mirror real work done in our integrator platform.

You will design and implement the solution yourself — there is no starter code. Part of what we're evaluating is how you structure a project from scratch.

---

## Concepts to Understand Before Starting

### FHIR

[FHIR R4](https://hl7.org/fhir/R4/) is the standard for exchanging healthcare data. Resources are JSON documents with a `resourceType` field. Read enough to understand the **Appointment** resource — its `status` field, its `participant` array (which links Patients, Practitioners, and Locations via `reference` strings like `"Patient/abc123"`), and how date/time fields are represented.

### Message Queues (RabbitMQ)

A producer pushes a JSON message to a queue; a consumer picks it up and processes it. After processing, the consumer must either **ack** (success, remove from queue) or **nack** (failure). A nack can requeue the message for a retry, or route it to a dead-letter queue for permanent failures.

### Error Categories

Design your error handling around two categories:

- **Retryable errors** — transient failures (network blip, rate limit, EHR temporarily unavailable). The message should be requeued and retried.
- **Fatal errors** — permanent failures (bad credentials, resource not found, malformed request). The message should be dead-lettered, not retried.

### Observability

Every meaningful step should produce a structured log entry with enough context to reconstruct what happened — include relevant IDs (sync ID, integrator ID, facility ID), counts, and elapsed time where appropriate. Use appropriate log levels: `info` for milestones, `warn` for recoverable issues, `error` for failures.

---

## Scenario 1 — Sync Appointments

A scheduled job publishes a message to a queue containing an integrator ID, a facility ID, and a date range. Your consumer must:

1. Fetch appointments from the EHR for that facility and date range. The EHR returns FHIR R4 `Appointment` resources.
2. Map each FHIR appointment to your internal Luma appointment model. Define the mapping yourself — think about which fields matter (status, times, patient, provider, facility).
3. Reconcile against the appointments already stored in Luma's database:
   - **New** in EHR but not in Luma → create.
   - **Exists in both** but something changed (status, times) → update.
   - **In Luma but gone from EHR** (and not already cancelled) → cancel.
4. Log the outcome: how many were created, updated, and cancelled.
5. Handle EHR errors correctly — distinguish retryable from fatal and take the appropriate queue action.

Think about: Where does the status mapping live? How do you extract the patient/provider/facility from the FHIR participant array? What constitutes a "change" worth updating?

---

## Scenario 2 — Create Appointment in EHR

When a patient books an appointment in Luma, a message is published to a queue. Your consumer must:

1. Build a FHIR R4 `Appointment` resource from the message payload.
2. POST it to the EHR client.
3. Receive and store the EHR-assigned external ID.
4. Handle errors correctly — the EHR may be temporarily down (retryable) or reject the request as invalid (fatal).
5. Log intent, outcome, and any errors at the appropriate level.

Think about: How does a FHIR Appointment reference a Patient, Practitioner, and Location? What is the correct initial `status` for a newly booked appointment?

---

## Requirements

- TypeScript, strict mode enabled.
- The EHR client and database layer should be injected as dependencies (not instantiated inside your handlers) — this makes them testable.
- Unit tests using **Mocha + Chai + Sinon** (no Jest). Tests should cover the happy path, error paths, and edge cases like missing participants or unknown FHIR statuses.
- `tsc --noEmit` must pass with no errors.
- All tests must pass.

---

## Written Questions

Include an `ANSWERS.md` with a short paragraph (3–5 sentences) for each:

1. **FHIR:** What is the role of the `participant` array in a FHIR Appointment? How would you extract the patient ID from it?
2. **Queue semantics:** Why do we nack without requeue for fatal errors but requeue for retryable ones? What could go wrong if you always requeued on any error?
3. **Observability:** A sync job processes 0 appointments when 50 were expected. What would your logs need to contain to quickly determine whether the problem is in the EHR fetch, the mapping, or the reconciliation step?
4. **Error design:** What's the advantage of distinct error classes (`RetryableError`, `FatalError`) over a single error class with a boolean flag?

---

## Evaluation Criteria

| Area | What we look for |
|------|-----------------|
| **Correctness** | Reconciliation logic, field mapping, and status mapping work as specified |
| **Error handling** | Right error type → right queue action; no swallowed errors |
| **Observability** | Logs have context (IDs, counts, timing), right levels, no sensitive data leaked |
| **Test coverage** | Happy path, error paths, and edge cases covered; tests are readable |
| **Code clarity** | Small focused functions, good names, types used correctly, no magic values |

---

Good luck — we're looking forward to seeing how you approach it.
