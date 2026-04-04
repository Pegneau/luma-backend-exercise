import { expect } from "chai";
import sinon, { type SinonStubbedInstance } from "sinon";

import type { AppointmentUpdate, DbClient } from "../clients/dbClient.js";
import type { DateRange, EhrClient } from "../clients/ehrClient.js";
import { RetryableError } from "../domain/errors/RetryableError.js";
import { SyncService } from "../services/syncAppointments.js";
import type { FhirAppointment } from "../types/fhir.js";
import type { LumaAppointment } from "../types/luma.js";

// ─── Stub classes ─────────────────────────────────────────────────────────────
// sinon.createStubInstance requires a class, not an interface, so I provide
// minimal concrete implementations whose methods are immediately replaced.

class StubEhrClient implements EhrClient {
  fetchAppointments(
    _integratorId: string,
    _facilityId: string,
    _dateRange: DateRange,
  ): Promise<FhirAppointment[]> {
    return Promise.resolve([]);
  }
  postAppointment(_appointment: FhirAppointment): Promise<string> {
    return Promise.resolve("");
  }
}

class StubDbClient implements DbClient {
  findAppointmentsByFacility(
    _integratorId: string,
    _facilityId: string,
    _dateRange: DateRange,
  ): Promise<LumaAppointment[]> {
    return Promise.resolve([]);
  }
  createAppointment(_appointment: LumaAppointment): Promise<void> {
    return Promise.resolve();
  }
  updateAppointment(
    _lumaId: string,
    _changes: AppointmentUpdate,
  ): Promise<void> {
    return Promise.resolve();
  }
}

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const DATE_RANGE: DateRange = {
  start: "2026-04-01T00:00:00Z",
  end: "2026-04-30T23:59:59Z",
};

/** FHIR appointment with id="ehr-1", status "booked" (→ Luma "scheduled"). */
const FHIR_BOOKED: FhirAppointment = {
  resourceType: "Appointment",
  id: "ehr-1",
  status: "booked",
  start: "2026-04-01T09:00:00Z",
  end: "2026-04-01T09:30:00Z",
  participant: [
    {
      actor: { reference: "Patient/p-1" },
      status: "accepted",
      required: "required",
    },
    {
      actor: { reference: "Location/loc-1" },
      status: "accepted",
      required: "required",
    },
  ],
};

/** Same appointment updated to "fulfilled" (→ Luma "completed"). */
const FHIR_FULFILLED: FhirAppointment = {
  resourceType: "Appointment",
  id: "ehr-1",
  status: "fulfilled",
  start: "2026-04-01T09:00:00Z",
  end: "2026-04-01T09:30:00Z",
  participant: [
    {
      actor: { reference: "Patient/p-1" },
      status: "accepted",
      required: "required",
    },
    {
      actor: { reference: "Location/loc-1" },
      status: "accepted",
      required: "required",
    },
  ],
};

/** The DB record that corresponds to FHIR_BOOKED (already reconciled once). */
const DB_SCHEDULED: LumaAppointment = {
  id: "luma-1",
  ehrId: "ehr-1",
  integratorId: "int-1",
  facilityId: "loc-1",
  patientId: "p-1",
  status: "scheduled",
  rawEhrStatus: "booked",
  startTime: "2026-04-01T09:00:00Z",
  endTime: "2026-04-01T09:30:00Z",
  createdAt: "2026-04-01T00:00:00Z",
  updatedAt: "2026-04-01T00:00:00Z",
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SyncService", () => {
  let ehrClient: SinonStubbedInstance<StubEhrClient>;
  let dbClient: SinonStubbedInstance<StubDbClient>;
  let service: SyncService;

  beforeEach(() => {
    ehrClient = sinon.createStubInstance(StubEhrClient);
    dbClient = sinon.createStubInstance(StubDbClient);
    service = new SyncService(ehrClient, dbClient);
  });

  afterEach(() => {
    sinon.restore();
  });

  // ─── Create ─────────────────────────────────────────────────────────────────

  describe("create", () => {
    it("creates an appointment that exists in the EHR but not in the DB", async () => {
      ehrClient.fetchAppointments.resolves([FHIR_BOOKED]);
      dbClient.findAppointmentsByFacility.resolves([]);

      const result = await service.execute("int-1", "loc-1", DATE_RANGE);

      expect(result.created).to.equal(1);
      expect(result.updated).to.equal(0);
      expect(result.cancelled).to.equal(0);
      expect(dbClient.createAppointment.calledOnce).to.be.true;
      expect(dbClient.updateAppointment.called).to.be.false;

      const saved = dbClient.createAppointment.getCall(0).args[0];
      expect(saved.ehrId).to.equal("ehr-1");
      expect(saved.status).to.equal("scheduled");
    });
  });

  // ─── Update ─────────────────────────────────────────────────────────────────

  describe("update", () => {
    it("updates an appointment whose status changed in the EHR", async () => {
      ehrClient.fetchAppointments.resolves([FHIR_FULFILLED]);
      dbClient.findAppointmentsByFacility.resolves([DB_SCHEDULED]);

      const result = await service.execute("int-1", "loc-1", DATE_RANGE);

      expect(result.updated).to.equal(1);
      expect(result.created).to.equal(0);
      expect(result.cancelled).to.equal(0);
      expect(dbClient.updateAppointment.calledOnce).to.be.true;
      expect(dbClient.createAppointment.called).to.be.false;

      const [lumaId, changes] = dbClient.updateAppointment.getCall(0).args;
      expect(lumaId).to.equal("luma-1");
      expect(changes.status).to.equal("completed");
      expect(changes.rawEhrStatus).to.equal("fulfilled");
    });
  });

  // ─── Cancel ─────────────────────────────────────────────────────────────────

  describe("cancel", () => {
    it("cancels an appointment present in the DB but missing from the EHR", async () => {
      ehrClient.fetchAppointments.resolves([]);
      dbClient.findAppointmentsByFacility.resolves([DB_SCHEDULED]);

      const result = await service.execute("int-1", "loc-1", DATE_RANGE);

      expect(result.cancelled).to.equal(1);
      expect(result.created).to.equal(0);
      expect(result.updated).to.equal(0);
      expect(dbClient.updateAppointment.calledOnce).to.be.true;

      const [lumaId, changes] = dbClient.updateAppointment.getCall(0).args;
      expect(lumaId).to.equal("luma-1");
      expect(changes.status).to.equal("cancelled");
    });

    it("does not double-cancel an already-cancelled appointment", async () => {
      const alreadyCancelled: LumaAppointment = {
        id: "luma-1",
        ehrId: "ehr-1",
        integratorId: "int-1",
        facilityId: "loc-1",
        patientId: "p-1",
        status: "cancelled",
        rawEhrStatus: "cancelled",
        createdAt: "2026-04-01T00:00:00Z",
        updatedAt: "2026-04-01T00:00:00Z",
      };

      ehrClient.fetchAppointments.resolves([]);
      dbClient.findAppointmentsByFacility.resolves([alreadyCancelled]);

      const result = await service.execute("int-1", "loc-1", DATE_RANGE);

      expect(result.cancelled).to.equal(0);
      expect(dbClient.updateAppointment.called).to.be.false;
    });
  });

  // ─── No-op ───────────────────────────────────────────────────────────────────

  describe("no-op", () => {
    it("does not touch the DB when EHR and DB data are identical", async () => {
      // FHIR "booked" → Luma "scheduled". Same startTime/endTime as DB record.
      ehrClient.fetchAppointments.resolves([FHIR_BOOKED]);
      dbClient.findAppointmentsByFacility.resolves([DB_SCHEDULED]);

      const result = await service.execute("int-1", "loc-1", DATE_RANGE);

      expect(result.created).to.equal(0);
      expect(result.updated).to.equal(0);
      expect(result.cancelled).to.equal(0);
      expect(dbClient.createAppointment.called).to.be.false;
      expect(dbClient.updateAppointment.called).to.be.false;
    });
  });

  // ─── Error propagation ────────────────────────────────────────────────────────

  describe("error propagation", () => {
    it("propagates RetryableError thrown by the EHR client", async () => {
      ehrClient.fetchAppointments.rejects(
        new RetryableError("EHR unavailable"),
      );
      dbClient.findAppointmentsByFacility.resolves([]);

      try {
        await service.execute("int-1", "loc-1", DATE_RANGE);
        expect.fail("Expected an error to be thrown");
      } catch (err) {
        expect(err).to.be.instanceOf(RetryableError);
      }
    });
  });
});
