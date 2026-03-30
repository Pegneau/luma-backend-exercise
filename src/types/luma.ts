import type { AppointmentStatus } from "./fhir.js";

export type LumaAppointmentStatus =
  | "pending"
  | "scheduled"
  | "completed"
  | "cancelled"
  | "no_show";

export interface LumaAppointment {
  id: string; // Luma primary key
  ehrId?: string; // External EHR Appointment.id
  integratorId: string; // EHR integration owner
  facilityId: string; // Clinic / Location

  // People
  patientId: string;
  providerId?: string;

  // Status
  status: LumaAppointmentStatus;
  rawEhrStatus: AppointmentStatus;

  // Timing
  startTime?: string; // ISO 8601 UTC
  endTime?: string; // ISO 8601 UTC

  // Audit
  createdAt: string;
  updatedAt: string;
}
