import { randomUUID } from "crypto";

import { FatalError } from "../domain/errors/FatalError.js";
import type {
  AppointmentActorType,
  AppointmentStatus,
  FhirAppointment,
} from "../types/fhir.js";
import type { LumaAppointment, LumaAppointmentStatus } from "../types/luma.js";

// ─────────────────────────────────────────────────────────────────────────────
// Status mapping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps every valid FHIR AppointmentStatus to Luma's internal vocabulary.
 *
 * Keeping this as a plain Record (not a switch) means TypeScript will error at
 * compile time if a new FHIR status is added to the union but forgotten here.
 */
const FHIR_STATUS_MAP: Record<AppointmentStatus, LumaAppointmentStatus> = {
  proposed: "pending",
  pending: "pending",
  waitlist: "pending",
  booked: "scheduled",
  arrived: "scheduled",
  "checked-in": "scheduled",
  fulfilled: "completed",
  cancelled: "cancelled",
  "entered-in-error": "cancelled",
  noshow: "no_show",
};

function extractParticipantId(
  participants: FhirAppointment["participant"],
  resourceType: AppointmentActorType,
): string | undefined {
  const prefix = `${resourceType}/`;

  for (const p of participants) {
    const ref = p.actor?.reference;
    if (ref?.startsWith(prefix)) {
      return ref.slice(prefix.length);
    }
  }

  return undefined;
}

/**
 * Maps a FHIR R4 Appointment resource to Luma's internal model.
 *
 * @param fhir     - Raw FHIR resource from the EHR. Requires at least one Patient and Location.
 * @param integratorId - Identifies which EHR integration this record belongs to.
 *
 * @throws {FatalError} If the participant array contains no Patient reference.
 *   This is a fatal error because there is no way to associate the appointment
 *   with a Luma patient — retrying will produce the same result.
 */
export function mapFhirToLuma(
  fhir: FhirAppointment,
  integratorId: string,
): LumaAppointment {
  const patientId = extractParticipantId(fhir.participant, "Patient");

  if (patientId === undefined) {
    throw new FatalError(
      `FHIR Appointment ${fhir.id ?? "(no id)"} has no Patient participant — cannot map to Luma`,
    );
  }

  // Practitioner or PractitionerRole are both acceptable provider references
  const providerId =
    extractParticipantId(fhir.participant, "Practitioner") ??
    extractParticipantId(fhir.participant, "PractitionerRole");

  const facilityId = extractParticipantId(fhir.participant, "Location");

  if (facilityId === undefined) {
    throw new FatalError(
      `FHIR Appointment ${fhir.id ?? "(no id)"} has no Location participant — cannot determine facility`,
    );
  }

  const lumaStatus = FHIR_STATUS_MAP[fhir.status];

  if (lumaStatus === undefined) {
    throw new FatalError(
      `Unknown FHIR status "${fhir.status}" on Appointment ${fhir.id ?? "(no id)"}`,
    );
  }

  const now = new Date().toISOString();

  return {
    id: randomUUID(),
    integratorId,
    facilityId,
    patientId,
    status: lumaStatus,
    rawEhrStatus: fhir.status,
    createdAt: now,
    updatedAt: now,
    // Optional fields: only included when the value is present.
    ...(fhir.id !== undefined && { ehrId: fhir.id }),
    ...(providerId !== undefined && { providerId }),
    ...(fhir.start !== undefined && { startTime: fhir.start }),
    ...(fhir.end !== undefined && { endTime: fhir.end }),
  };
}
