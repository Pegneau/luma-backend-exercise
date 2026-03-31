import type { AppointmentStatus } from "../types/fhir.js";
import type { LumaAppointment, LumaAppointmentStatus } from "../types/luma.js";
export interface AppointmentUpdate {
  status?: LumaAppointmentStatus;
  rawEhrStatus?: AppointmentStatus;
  startTime?: string;
  endTime?: string;
  updatedAt: string;
}

export interface DbClient {
  /** Returns all Luma appointments for a given facility + integrator pair. */
  findAppointmentsByFacility(
    integratorId: string,
    facilityId: string,
  ): Promise<LumaAppointment[]>;

  createAppointment(appointment: LumaAppointment): Promise<void>;

  /** Applies a partial update to an existing appointment row by Luma ID. */
  updateAppointment(lumaId: string, changes: AppointmentUpdate): Promise<void>;
}
