import type { FhirAppointment } from "../types/fhir.js";

export interface DateRange {
  start: string;
  end: string;
}

/**
 * Read-only contract for querying appointments from an external EHR system.
 * Concrete implementations (Epic, Athena, mock) are injected by the
 * consumer — never instantiated inside service logic.
 *
 * @throws {RetryableError} on transient failures (timeout, 5xx, rate-limit).
 * @throws {FatalError}     on permanent failures (401, 404, bad config).
 */
export interface EhrClient {
  fetchAppointments(
    integratorId: string,
    facilityId: string,
    dateRange: DateRange,
  ): Promise<FhirAppointment[]>;
}
