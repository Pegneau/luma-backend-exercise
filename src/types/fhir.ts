// FHIR primitive aliases
type FhirInstant = string;
type FhirDateTime = string;
type FhirCode = string;
type FhirUri = string;

// Shared types
export interface Reference {
  reference?: string;
  type?: FhirUri;
  display?: string;
}

export interface Coding {
  system?: FhirUri;
  version?: string;
  code?: FhirCode;
  display?: string;
  userSelected?: boolean;
}

export interface CodeableConcept {
  coding?: Coding[];
  text?: string;
}

export interface Period {
  start?: FhirDateTime;
  end?: FhirDateTime;
}

// Enums (FHIR-aligned)
export type AppointmentStatus =
  | "proposed"
  | "pending"
  | "booked"
  | "arrived"
  | "fulfilled"
  | "cancelled"
  | "noshow"
  | "entered-in-error"
  | "checked-in"
  | "waitlist";

export type ParticipantRequired = "required" | "optional" | "information-only";

export type ParticipantStatus =
  | "accepted"
  | "declined"
  | "tentative"
  | "needs-action";

export type AppointmentActorType =
  | "Patient"
  | "Practitioner"
  | "PractitionerRole"
  | "Location"
  | "Device"
  | "HealthcareService";

export interface AppointmentParticipant {
  type?: CodeableConcept[];
  actor?: Reference;
  required?: ParticipantRequired;
  status: ParticipantStatus;
  period?: Period;
}

// Main resource
//https://hl7.org/fhir/R4/appointment.html json sample
export interface FhirAppointment {
  resourceType: "Appointment";
  id?: string;
  status: AppointmentStatus;

  serviceCategory?: CodeableConcept[];
  serviceType?: CodeableConcept[];
  specialty?: CodeableConcept[];
  appointmentType?: CodeableConcept;
  reasonCode?: CodeableConcept[];

  start?: FhirInstant;
  end?: FhirInstant;
  minutesDuration?: number;

  comment?: string;
  requestedPeriod?: Period[];

  participant: AppointmentParticipant[];
}
