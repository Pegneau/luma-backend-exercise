import type { AppointmentStatus, FhirAppointment } from "../types/fhir.js";
import type { LumaAppointment, LumaAppointmentStatus } from "../types/luma.js";

// ─────────────────────────────────────────────────────────────────────────────
// Status mapping  (reverse direction of fhirToInternal)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps Luma's internal status vocabulary back to a canonical FHIR status.
 *
 * Rule for new bookings: the correct initial FHIR status is "pending"
 * (all participants have been informed but none have accepted yet).
 * "booked" is only correct once all participants have accepted — that happens
 * via subsequent participant status updates, not at creation time.
 */
const LUMA_TO_FHIR_STATUS: Record<LumaAppointmentStatus, AppointmentStatus> = {
  pending: "pending",
  scheduled: "booked",
  completed: "fulfilled",
  cancelled: "cancelled",
  no_show: "noshow",
};

/**
 * Builds a FHIR R4 Appointment resource from a Luma internal appointment.
 *
 * The returned resource has no `id` field — the EHR server assigns it
 * upon a successful POST. The caller must store the returned EHR ID.
 *
 * Participant status is always "needs-action" for a new appointment because
 * no participant has confirmed attendance yet.
 */
export function mapLumaToFhir(luma: LumaAppointment): FhirAppointment {
  const fhirStatus = LUMA_TO_FHIR_STATUS[luma.status];

  const appointment: FhirAppointment = {
    resourceType: "Appointment",
    status: fhirStatus,
    participant: [
      {
        actor: { reference: `Patient/${luma.patientId}` },
        status: "needs-action",
        required: "required",
      },
      {
        actor: { reference: `Location/${luma.facilityId}` },
        status: "needs-action",
        required: "required",
      },
    ],
    // Optional timing — spread only when present (exactOptionalPropertyTypes)
    ...(luma.startTime !== undefined && { start: luma.startTime }),
    ...(luma.endTime !== undefined && { end: luma.endTime }),
  };

  // Inject provider participant only when a provider is assigned.
  // Not all appointment types have a designated provider at booking time.
  if (luma.providerId !== undefined) {
    appointment.participant.push({
      actor: { reference: `Practitioner/${luma.providerId}` },
      status: "needs-action",
      required: "required",
    });
  }

  return appointment;
}
