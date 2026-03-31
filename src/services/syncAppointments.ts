import type { AppointmentUpdate, DbClient } from "../clients/dbClient.js";
import type { DateRange, EhrClient } from "../clients/ehrClient.js";
import { mapFhirToLuma } from "../mappers/fhirToInternal.js";
import type { LumaAppointment } from "../types/luma.js";
import { logger } from "../utils/logger.js";

export interface SyncResult {
  created: number;
  updated: number;
  cancelled: number;
}

// Re-export DateRange so queue consumers only need to import from this module.
export type { DateRange };

export class SyncService {
  constructor(
    private readonly ehrClient: EhrClient,
    private readonly dbClient: DbClient,
  ) {}

  /**
   * Fetches appointments from the EHR for the given facility and date range,
   * reconciles them against Luma's database, and returns a result summary.
   *
   * Reconciliation rules:
   *   - EHR has it, Luma does not           → create
   *   - Both have it, something changed      → update
   *   - Luma has it, EHR no longer does      → cancel (if not already cancelled)
   *
   * @throws {FatalError}     propagated from mapping (e.g. missing Patient).
   * @throws {RetryableError} propagated from EHR/DB clients on transient failures.
   */
  async execute(
    integratorId: string,
    facilityId: string,
    dateRange: DateRange,
  ): Promise<SyncResult> {
    const startedAt = Date.now();

    logger.info("sync:start", { integratorId, facilityId, ...dateRange });

    const fhirAppointments = await this.ehrClient.fetchAppointments(
      integratorId,
      facilityId,
      dateRange,
    );

    logger.info("sync:ehr_fetched", {
      integratorId,
      facilityId,
      count: fhirAppointments.length,
    });

    const incomingByEhrId = new Map<string, LumaAppointment>();

    for (const fhir of fhirAppointments) {
      const mapped = mapFhirToLuma(fhir, integratorId);
      // Appointments without an EHR id cannot be reconciled — skip with warning.
      if (mapped.ehrId === undefined) {
        logger.warn("sync:skip_no_ehr_id", { integratorId, facilityId });
        continue;
      }
      incomingByEhrId.set(mapped.ehrId, mapped);
    }

    // Fetch existing Luma records for this facility

    const existing = await this.dbClient.findAppointmentsByFacility(
      integratorId,
      facilityId,
    );

    const existingByEhrId = new Map<string, LumaAppointment>();
    for (const appt of existing) {
      if (appt.ehrId !== undefined) {
        existingByEhrId.set(appt.ehrId, appt);
      }
    }

    // Reconcile

    let created = 0;
    let updated = 0;
    let cancelled = 0;
    const now = new Date().toISOString();

    // Create or update
    for (const [ehrId, incoming] of incomingByEhrId) {
      const stored = existingByEhrId.get(ehrId);

      if (stored === undefined) {
        await this.dbClient.createAppointment(incoming);
        created++;
      } else if (hasChanged(stored, incoming)) {
        const changes: AppointmentUpdate = {
          status: incoming.status,
          rawEhrStatus: incoming.rawEhrStatus,
          updatedAt: now,
          // Only include timing fields when they are present on the incoming
          // record. exactOptionalPropertyTypes forbids explicit `undefined`.
          ...(incoming.startTime !== undefined && {
            startTime: incoming.startTime,
          }),
          ...(incoming.endTime !== undefined && { endTime: incoming.endTime }),
        };
        await this.dbClient.updateAppointment(stored.id, changes);
        updated++;
      }
    }

    // Cancel appointments that disappeared from the EHR
    for (const stored of existingByEhrId.values()) {
      const isGoneFromEhr =
        stored.ehrId !== undefined && !incomingByEhrId.has(stored.ehrId);
      const isAlreadyCancelled = stored.status === "cancelled";

      if (isGoneFromEhr && !isAlreadyCancelled) {
        await this.dbClient.updateAppointment(stored.id, {
          status: "cancelled",
          updatedAt: now,
        });
        cancelled++;
      }
    }

    logger.info("sync:complete", {
      integratorId,
      facilityId,
      created,
      updated,
      cancelled,
      ehrCount: fhirAppointments.length,
      dbCount: existing.length,
      elapsedMs: Date.now() - startedAt,
    });

    return { created, updated, cancelled };
  }
}

/**
 * Returns true if any field we care about updating has changed.
 * Intentionally excludes `id`, `ehrId`, `createdAt`, and `updatedAt`
 * because those are either immutable or meta-fields not driven by the EHR.
 */
function hasChanged(
  stored: LumaAppointment,
  incoming: LumaAppointment,
): boolean {
  return (
    stored.status !== incoming.status ||
    stored.startTime !== incoming.startTime ||
    stored.endTime !== incoming.endTime
  );
}
