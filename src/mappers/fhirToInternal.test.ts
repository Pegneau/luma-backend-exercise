import { expect } from "chai";

import { FatalError } from "../domain/errors/FatalError.js";
import { mapFhirToLuma } from "./fhirToInternal.js";
import type { FhirAppointment } from "../types/fhir.js";
import type { LumaAppointmentStatus } from "../types/luma.js";

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const BASE_PARTICIPANTS: FhirAppointment["participant"] = [
  {
    actor: { reference: "Patient/p-001" },
    status: "accepted",
    required: "required",
  },
  {
    actor: { reference: "Location/loc-001" },
    status: "accepted",
    required: "required",
  },
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("mapFhirToLuma()", () => {
  describe("core field mapping", () => {
    it("maps id, patient, facility, status and integratorId correctly", () => {
      const fhir: FhirAppointment = {
        resourceType: "Appointment",
        id: "ehr-001",
        status: "booked",
        participant: BASE_PARTICIPANTS,
      };

      const result = mapFhirToLuma(fhir, "int-1");

      expect(result.ehrId).to.equal("ehr-001");
      expect(result.patientId).to.equal("p-001");
      expect(result.facilityId).to.equal("loc-001");
      expect(result.integratorId).to.equal("int-1");
      expect(result.status).to.equal("scheduled");
      expect(result.rawEhrStatus).to.equal("booked");
    });

    it("extracts providerId from a Practitioner participant", () => {
      const fhir: FhirAppointment = {
        resourceType: "Appointment",
        id: "ehr-001",
        status: "booked",
        participant: [
          ...BASE_PARTICIPANTS,
          {
            actor: { reference: "Practitioner/dr-001" },
            status: "needs-action",
            required: "optional",
          },
        ],
      };

      const result = mapFhirToLuma(fhir, "int-1");

      expect(result.providerId).to.equal("dr-001");
    });

    it("maps start and end times when present on the resource", () => {
      const fhir: FhirAppointment = {
        resourceType: "Appointment",
        id: "ehr-001",
        status: "booked",
        participant: BASE_PARTICIPANTS,
        start: "2026-04-01T09:00:00Z",
        end: "2026-04-01T09:30:00Z",
      };

      const result = mapFhirToLuma(fhir, "int-1");

      expect(result.startTime).to.equal("2026-04-01T09:00:00Z");
      expect(result.endTime).to.equal("2026-04-01T09:30:00Z");
    });

    it("omits ehrId when the FHIR resource has no id field", () => {
      const fhir: FhirAppointment = {
        resourceType: "Appointment",
        status: "booked",
        participant: BASE_PARTICIPANTS,
      };

      const result = mapFhirToLuma(fhir, "int-1");

      expect(result.ehrId).to.be.undefined;
    });

    it("omits providerId when no Practitioner participant is present", () => {
      const fhir: FhirAppointment = {
        resourceType: "Appointment",
        status: "booked",
        participant: BASE_PARTICIPANTS,
      };

      const result = mapFhirToLuma(fhir, "int-1");

      expect(result.providerId).to.be.undefined;
    });
  });

  // ─── Status mapping (all 10 FHIR statuses) ──────────────────────────────────

  describe("status mapping", () => {
    const cases: Array<[FhirAppointment["status"], LumaAppointmentStatus]> = [
      ["proposed", "pending"],
      ["pending", "pending"],
      ["waitlist", "pending"],
      ["booked", "scheduled"],
      ["arrived", "scheduled"],
      ["checked-in", "scheduled"],
      ["fulfilled", "completed"],
      ["cancelled", "cancelled"],
      ["entered-in-error", "cancelled"],
      ["noshow", "no_show"],
    ];

    for (const [fhirStatus, expectedLuma] of cases) {
      it(`maps FHIR "${fhirStatus}" → Luma "${expectedLuma}"`, () => {
        const fhir: FhirAppointment = {
          resourceType: "Appointment",
          status: fhirStatus,
          participant: BASE_PARTICIPANTS,
        };

        const result = mapFhirToLuma(fhir, "int-1");

        expect(result.status).to.equal(expectedLuma);
      });
    }
  });

  // ─── Error cases ─────────────────────────────────────────────────────────────
  describe("error cases", () => {
    it("throws FatalError when no Patient participant is present", () => {
      const fhir: FhirAppointment = {
        resourceType: "Appointment",
        status: "booked",
        participant: [
          {
            actor: { reference: "Location/loc-001" },
            status: "accepted",
            required: "required",
          },
        ],
      };

      expect(() => mapFhirToLuma(fhir, "int-1")).to.throw(FatalError);
    });

    it("throws FatalError when no Location participant is present", () => {
      const fhir: FhirAppointment = {
        resourceType: "Appointment",
        status: "booked",
        participant: [
          {
            actor: { reference: "Patient/p-001" },
            status: "accepted",
            required: "required",
          },
        ],
      };

      expect(() => mapFhirToLuma(fhir, "int-1")).to.throw(FatalError);
    });
    it("throws FatalError when FHIR status is unknown (not in the mapping table)", () => {
      const fhir: FhirAppointment = {
        resourceType: "Appointment",
        status: "unknown-status" as FhirAppointment["status"],
        participant: BASE_PARTICIPANTS,
      };

      expect(() => mapFhirToLuma(fhir, "int-1")).to.throw(FatalError);
    });
  });
});
