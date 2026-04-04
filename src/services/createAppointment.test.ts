import { expect } from "chai";
import sinon, { type SinonStubbedInstance } from "sinon";

import type { AppointmentUpdate, DbClient } from "../clients/dbClient.js";
import type { DateRange, EhrClient } from "../clients/ehrClient.js";
import { FatalError } from "../domain/errors/FatalError.js";
import { RetryableError } from "../domain/errors/RetryableError.js";
import {
  CreateAppointmentService,
  type CreateAppointmentPayload,
} from "../services/createAppointment.js";
import type { FhirAppointment } from "../types/fhir.js";
import type { LumaAppointment } from "../types/luma.js";

// ─── Stub classes ─────────────────────────────────────────────────────────────

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

const VALID_PAYLOAD: CreateAppointmentPayload = {
  integratorId: "int-1",
  facilityId: "fac-1",
  patientId: "patient-1",
  startTime: "2026-04-01T09:00:00Z",
  endTime: "2026-04-01T09:30:00Z",
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CreateAppointmentService", () => {
  let ehrClient: SinonStubbedInstance<StubEhrClient>;
  let dbClient: SinonStubbedInstance<StubDbClient>;
  let service: CreateAppointmentService;

  beforeEach(() => {
    ehrClient = sinon.createStubInstance(StubEhrClient);
    dbClient = sinon.createStubInstance(StubDbClient);
    service = new CreateAppointmentService(ehrClient, dbClient);
  });

  afterEach(() => {
    sinon.restore();
  });

  // ─── Success ─────────────────────────────────────────────────────────────────

  describe("success", () => {
    it("posts to the EHR, saves the record with the EHR-assigned id, and returns it", async () => {
      ehrClient.postAppointment.resolves("ehr-assigned-1");
      dbClient.createAppointment.resolves();

      const result = await service.execute(VALID_PAYLOAD);

      // EHR was called exactly once
      expect(ehrClient.postAppointment.calledOnce).to.be.true;

      // DB was called exactly once with the ehrId already attached
      expect(dbClient.createAppointment.calledOnce).to.be.true;
      const saved = dbClient.createAppointment.getCall(0).args[0];
      expect(saved.ehrId).to.equal("ehr-assigned-1");
      expect(saved.patientId).to.equal(VALID_PAYLOAD.patientId);
      expect(saved.facilityId).to.equal(VALID_PAYLOAD.facilityId);
      expect(saved.status).to.equal("pending");

      // Returned appointment mirrors what was persisted
      expect(result.ehrId).to.equal("ehr-assigned-1");
      expect(result.patientId).to.equal(VALID_PAYLOAD.patientId);
    });

    it("attaches providerId when included in the payload", async () => {
      const payloadWithProvider: CreateAppointmentPayload = {
        ...VALID_PAYLOAD,
        providerId: "dr-001",
      };
      ehrClient.postAppointment.resolves("ehr-assigned-2");
      dbClient.createAppointment.resolves();

      await service.execute(payloadWithProvider);

      const saved = dbClient.createAppointment.getCall(0).args[0];
      expect(saved.providerId).to.equal("dr-001");
    });
  });

  // ─── Validation errors ────────────────────────────────────────────────────────

  describe("validation errors (FatalError)", () => {
    it("throws FatalError when patientId is empty — never reaches EHR", async () => {
      const payload: CreateAppointmentPayload = {
        ...VALID_PAYLOAD,
        patientId: "  ",
      };

      try {
        await service.execute(payload);
        expect.fail("Expected FatalError");
      } catch (err) {
        expect(err).to.be.instanceOf(FatalError);
      }

      expect(ehrClient.postAppointment.called).to.be.false;
      expect(dbClient.createAppointment.called).to.be.false;
    });

    it("throws FatalError when facilityId is empty — never reaches EHR", async () => {
      const payload: CreateAppointmentPayload = {
        ...VALID_PAYLOAD,
        facilityId: "",
      };

      try {
        await service.execute(payload);
        expect.fail("Expected FatalError");
      } catch (err) {
        expect(err).to.be.instanceOf(FatalError);
      }

      expect(ehrClient.postAppointment.called).to.be.false;
    });

    it("throws FatalError when EHR responds 2xx but returns a blank id", async () => {
      ehrClient.postAppointment.resolves("   "); // whitespace only
      dbClient.createAppointment.resolves();

      try {
        await service.execute(VALID_PAYLOAD);
        expect.fail("Expected FatalError");
      } catch (err) {
        expect(err).to.be.instanceOf(FatalError);
      }

      // DB must not be written when we cannot track the EHR resource
      expect(dbClient.createAppointment.called).to.be.false;
    });
  });

  // ─── Error propagation ────────────────────────────────────────────────────────

  describe("error propagation", () => {
    it("propagates RetryableError thrown by the EHR client (e.g. timeout)", async () => {
      ehrClient.postAppointment.rejects(new RetryableError("EHR timeout"));

      try {
        await service.execute(VALID_PAYLOAD);
        expect.fail("Expected RetryableError");
      } catch (err) {
        expect(err).to.be.instanceOf(RetryableError);
      }

      expect(dbClient.createAppointment.called).to.be.false;
    });

    it("propagates FatalError thrown by the EHR client (e.g. 400 Bad Request)", async () => {
      ehrClient.postAppointment.rejects(new FatalError("400 Bad Request"));

      try {
        await service.execute(VALID_PAYLOAD);
        expect.fail("Expected FatalError");
      } catch (err) {
        expect(err).to.be.instanceOf(FatalError);
      }

      expect(dbClient.createAppointment.called).to.be.false;
    });
  });
});
