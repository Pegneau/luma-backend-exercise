import { expect } from "chai";

import { mapLumaToFhir } from "./internalToFhir.js";
import type { LumaAppointment, LumaAppointmentStatus } from "../types/luma.js";
import type { FhirAppointment } from "../types/fhir.js";

// ─── Shared fixture ───────────────────────────────────────────────────────────

const BASE_LUMA: LumaAppointment = {
  id: "luma-001",
  integratorId: "int-1",
  facilityId: "loc-001",
  patientId: "p-001",
  status: "pending",
  rawEhrStatus: "pending",
  createdAt: "2026-04-01T00:00:00Z",
  updatedAt: "2026-04-01T00:00:00Z",
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("mapLumaToFhir()", () => {
  describe("core field mapping", () => {
    it("sets resourceType to 'Appointment'", () => {
      const result = mapLumaToFhir(BASE_LUMA);
      expect(result.resourceType).to.equal("Appointment");
    });

    it("does not include an id (EHR assigns it upon POST)", () => {
      const result = mapLumaToFhir(BASE_LUMA);
      expect(result.id).to.be.undefined;
    });

    it("includes Patient and Location participants", () => {
      const result = mapLumaToFhir(BASE_LUMA);
      const refs = result.participant.map((p) => p.actor?.reference);

      expect(refs).to.include("Patient/p-001");
      expect(refs).to.include("Location/loc-001");
    });

    it("sets every participant status to 'needs-action'", () => {
      const result = mapLumaToFhir(BASE_LUMA);
      const allNeedsAction = result.participant.every(
        (p) => p.status === "needs-action",
      );
      expect(allNeedsAction).to.be.true;
    });

    it("includes a Practitioner participant when providerId is set", () => {
      const luma: LumaAppointment = { ...BASE_LUMA, providerId: "dr-001" };
      const result = mapLumaToFhir(luma);
      const refs = result.participant.map((p) => p.actor?.reference ?? "");

      expect(refs).to.include("Practitioner/dr-001");
    });

    it("omits the Practitioner participant when providerId is absent", () => {
      const result = mapLumaToFhir(BASE_LUMA);
      const refs = result.participant.map((p) => p.actor?.reference ?? "");

      expect(refs.some((r) => r.startsWith("Practitioner/"))).to.be.false;
    });

    it("maps start and end times when present", () => {
      const luma: LumaAppointment = {
        ...BASE_LUMA,
        startTime: "2026-04-01T09:00:00Z",
        endTime: "2026-04-01T09:30:00Z",
      };

      const result = mapLumaToFhir(luma);

      expect(result.start).to.equal("2026-04-01T09:00:00Z");
      expect(result.end).to.equal("2026-04-01T09:30:00Z");
    });

    it("omits start and end when timing fields are absent", () => {
      const result = mapLumaToFhir(BASE_LUMA);
      expect(result.start).to.be.undefined;
      expect(result.end).to.be.undefined;
    });
  });

  // ─── Status mapping (all 5 Luma statuses) ────────────────────────────────────

  describe("status mapping", () => {
    const cases: Array<[LumaAppointmentStatus, FhirAppointment["status"]]> = [
      ["pending", "pending"],
      ["scheduled", "booked"],
      ["completed", "fulfilled"],
      ["cancelled", "cancelled"],
      ["no_show", "noshow"],
    ];

    for (const [lumaStatus, expectedFhir] of cases) {
      it(`maps Luma "${lumaStatus}" → FHIR "${expectedFhir}"`, () => {
        const luma: LumaAppointment = { ...BASE_LUMA, status: lumaStatus };
        const result = mapLumaToFhir(luma);
        expect(result.status).to.equal(expectedFhir);
      });
    }
  });
});
