import type { FhirAppointment } from "../types/fhir.js";

export interface DateRange {
  start: string;
  end: string;
}

/**
 * Contract for interacting with an external EHR system.
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

  /**
   * POSTs a new FHIR Appointment to the EHR and returns the server-assigned ID.
   *
   * @returns The EHR-assigned Appointment.id (never empty).
   * @throws {RetryableError} EHR is temporarily unavailable (5xx, timeout).
   * @throws {FatalError}     EHR rejected the payload as invalid (4xx).
   */
  postAppointment(appointment: FhirAppointment): Promise<string>;
}
