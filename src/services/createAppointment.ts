import { randomUUID } from "crypto";

import type { DbClient } from "../clients/dbClient.js";
import type { EhrClient } from "../clients/ehrClient.js";
import { FatalError } from "../domain/errors/FatalError.js";
import { mapLumaToFhir } from "../mappers/internalToFhir.js";
import type { LumaAppointment } from "../types/luma.js";
import { logger } from "../utils/logger.js";

/**
 * Data arriving from the queue when a patient books an appointment in Luma.
 * All fields are runtime values — TypeScript cannot validate them before
 * they arrive, so the service validates required ones explicitly.
 */
export interface CreateAppointmentPayload {
  integratorId: string;
  facilityId: string;
  patientId: string;
  providerId?: string;
  startTime: string;
  endTime: string;
}
export class CreateAppointmentService {
  constructor(
    private readonly ehrClient: EhrClient,
    private readonly dbClient: DbClient,
  ) {}

  /**
   * Books an appointment in the external EHR and persists it in Luma's DB.
   *
   * Flow:
   *   1. Validate the payload (fatal if required fields are empty).
   *   2. Build a Luma appointment model and map it to FHIR.
   *   3. POST the FHIR resource to the EHR — receive EHR-assigned ID.
   *   4. Attach the EHR ID to the Luma record and save it to the DB.
   *
   * @returns The persisted LumaAppointment (including the EHR-assigned id).
   * @throws {FatalError}     on invalid payload or permanent EHR rejection.
   * @throws {RetryableError} when the EHR is temporarily unavailable.
   */
  async execute(payload: CreateAppointmentPayload): Promise<LumaAppointment> {
    // TypeScript guarantees the fields exist at compile time, but queue messages
    // are untyped at runtime. Guard the fields that make the whole operation
    // meaningless if empty.

    if (!payload.patientId.trim()) {
      throw new FatalError(
        "CreateAppointment: patientId is required but was empty",
      );
    }
    if (!payload.facilityId.trim()) {
      throw new FatalError(
        "CreateAppointment: facilityId is required but was empty",
      );
    }

    logger.info("create_appointment:start", {
      integratorId: payload.integratorId,
      facilityId: payload.facilityId,
      patientId: payload.patientId,
      startTime: payload.startTime,
    });

    // Status is "pending": confirmed booking, participants not yet accepted.
    // This maps to FHIR "pending" via LUMA_TO_FHIR_STATUS.

    const now = new Date().toISOString();
    const lumaAppointment: LumaAppointment = {
      id: randomUUID(),
      integratorId: payload.integratorId,
      facilityId: payload.facilityId,
      patientId: payload.patientId,
      status: "pending",
      rawEhrStatus: "pending",
      startTime: payload.startTime,
      endTime: payload.endTime,
      createdAt: now,
      updatedAt: now,
      ...(payload.providerId !== undefined && {
        providerId: payload.providerId,
      }),
    };

    // POST to EHR
    // mapLumaToFhir produces a resource without an id — the EHR assigns it.
    // RetryableError / FatalError thrown by ehrClient propagate to the consumer.

    const fhirResource = mapLumaToFhir(lumaAppointment);
    const ehrId = await this.ehrClient.postAppointment(fhirResource);

    if (!ehrId.trim()) {
      // EHR responded 2xx but returned an empty ID — cannot track this record.
      throw new FatalError(
        `EHR returned an empty id for appointment (lumaId: ${lumaAppointment.id})`,
      );
    }

    // Persist
    // Attach ehrId before saving so the record is complete in one DB write.

    const toSave: LumaAppointment = { ...lumaAppointment, ehrId };
    await this.dbClient.createAppointment(toSave);

    logger.info("create_appointment:success", {
      integratorId: payload.integratorId,
      facilityId: payload.facilityId,
      lumaId: toSave.id,
      ehrId,
    });

    return toSave;
  }
}
