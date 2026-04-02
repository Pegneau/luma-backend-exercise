import { expect } from "chai";
import sinon, { type SinonStub, type SinonStubbedInstance } from "sinon";
import type { Channel, Message } from "amqplib";

import { FatalError } from "../domain/errors/FatalError.js";
import { RetryableError } from "../domain/errors/RetryableError.js";
import { CreateAppointmentService } from "../services/createAppointment.js";
import { SyncService } from "../services/syncAppointments.js";
import type { LumaAppointment } from "../types/luma.js";
import { QueueConsumer } from "./consumer.js";

// ─── Message factory ──────────────────────────────────────────────────────────

function makeMsg(body: unknown): Message {
  return {
    content: Buffer.from(JSON.stringify(body)),
    fields: {
      deliveryTag: 1,
      redelivered: false,
      exchange: "",
      routingKey: "test",
      consumerTag: "test",
    },
    // amqplib types all MessageProperties fields as `any`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    properties: { headers: {} } as any,
  };
}

function makeInvalidMsg(): Message {
  return { ...makeMsg(null), content: Buffer.from("not-valid-json{{{") };
}

// ─── Shared payload fixtures ──────────────────────────────────────────────────

const SYNC_PAYLOAD = {
  integratorId: "int-1",
  facilityId: "fac-1",
  dateRange: { start: "2026-04-01T00:00:00Z", end: "2026-04-30T23:59:59Z" },
};

const CREATE_PAYLOAD = {
  integratorId: "int-1",
  facilityId: "fac-1",
  patientId: "p-1",
  startTime: "2026-04-01T09:00:00Z",
  endTime: "2026-04-01T09:30:00Z",
};

const LUMA_RESULT: LumaAppointment = {
  id: "luma-1",
  ehrId: "ehr-1",
  integratorId: "int-1",
  facilityId: "fac-1",
  patientId: "p-1",
  status: "pending",
  rawEhrStatus: "pending",
  createdAt: "2026-04-01T00:00:00Z",
  updatedAt: "2026-04-01T00:00:00Z",
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("QueueConsumer", () => {
  let ack: SinonStub;
  let nack: SinonStub;
  let channel: Channel;
  let syncService: SinonStubbedInstance<SyncService>;
  let createService: SinonStubbedInstance<CreateAppointmentService>;

  // Callbacks registered by listen() when it calls channel.consume().
  // We invoke these directly in each test to simulate message delivery.
  let syncCallback: (msg: Message | null) => void;
  let createCallback: (msg: Message | null) => void;

  beforeEach(async () => {
    ack = sinon.stub();
    nack = sinon.stub();

    // Minimal channel stub: topology methods resolve immediately so listen()
    // can complete; consume() captures the handler callbacks for later use.
    channel = {
      assertExchange: sinon.stub().resolves(),
      assertQueue: sinon.stub().resolves(),
      bindQueue: sinon.stub().resolves(),
      prefetch: sinon.stub(),
      consume: sinon
        .stub()
        .callsFake((queue: string, cb: (msg: Message | null) => void) => {
          if (queue === "luma.appointments.sync") syncCallback = cb;
          else createCallback = cb;
          return Promise.resolve({ consumerTag: "test" });
        }),
      ack,
      nack,
    } as unknown as Channel;

    // sinon.createStubInstance bypasses the constructor (uses Object.create),
    // so no EhrClient / DbClient arguments are needed here.
    syncService = sinon.createStubInstance(SyncService);
    createService = sinon.createStubInstance(CreateAppointmentService);

    const consumer = new QueueConsumer(channel, syncService, createService);

    // Runs the full DLX/queue setup and registers the callbacks above.
    await consumer.listen();
  });

  afterEach(() => {
    sinon.restore();
  });

  // ─── Dispatch helpers ────────────────────────────────────────────────────────
  // handleSync / handleCreate are private async methods whose return value is
  // swallowed by .catch() inside listen(). We invoke the captured callback and
  // then yield with setImmediate so all pending microtasks (the stub's resolved
  // promise, then ack/nack) complete before we assert.

  async function dispatchSync(msg: Message | null): Promise<void> {
    syncCallback(msg);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  async function dispatchCreate(msg: Message | null): Promise<void> {
    createCallback(msg);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  // ─── SYNC queue ──────────────────────────────────────────────────────────────

  describe("SYNC queue", () => {
    it("acks the message when sync succeeds", async () => {
      syncService.execute.resolves({ created: 1, updated: 0, cancelled: 0 });

      await dispatchSync(makeMsg(SYNC_PAYLOAD));

      expect(ack.calledOnce).to.be.true;
      expect(nack.called).to.be.false;
    });

    it("nacks with requeue=true on RetryableError", async () => {
      syncService.execute.rejects(new RetryableError("EHR timeout"));

      await dispatchSync(makeMsg(SYNC_PAYLOAD));

      expect(nack.calledOnce).to.be.true;
      const [, , requeue] = nack.getCall(0).args as [Message, boolean, boolean];
      expect(requeue).to.be.true;
      expect(ack.called).to.be.false;
    });

    it("nacks with requeue=false on FatalError", async () => {
      syncService.execute.rejects(new FatalError("bad FHIR mapping"));

      await dispatchSync(makeMsg(SYNC_PAYLOAD));

      expect(nack.calledOnce).to.be.true;
      const [, , requeue] = nack.getCall(0).args as [Message, boolean, boolean];
      expect(requeue).to.be.false;
      expect(ack.called).to.be.false;
    });

    it("nacks with requeue=false on unexpected (non-domain) error", async () => {
      syncService.execute.rejects(new Error("boom"));

      await dispatchSync(makeMsg(SYNC_PAYLOAD));

      expect(nack.calledOnce).to.be.true;
      const [, , requeue] = nack.getCall(0).args as [Message, boolean, boolean];
      expect(requeue).to.be.false;
    });

    it("nacks with requeue=false when the message body is not valid JSON", async () => {
      await dispatchSync(makeInvalidMsg());

      expect(nack.calledOnce).to.be.true;
      const [, , requeue] = nack.getCall(0).args as [Message, boolean, boolean];
      expect(requeue).to.be.false;
      // Service must never be invoked for a malformed message
      expect(syncService.execute.called).to.be.false;
      expect(ack.called).to.be.false;
    });
  });

  // ─── CREATE queue ─────────────────────────────────────────────────────────────

  describe("CREATE queue", () => {
    it("acks the message when create succeeds", async () => {
      createService.execute.resolves(LUMA_RESULT);

      await dispatchCreate(makeMsg(CREATE_PAYLOAD));

      expect(ack.calledOnce).to.be.true;
      expect(nack.called).to.be.false;
    });

    it("nacks with requeue=true on RetryableError", async () => {
      createService.execute.rejects(new RetryableError("EHR temporarily down"));

      await dispatchCreate(makeMsg(CREATE_PAYLOAD));

      expect(nack.calledOnce).to.be.true;
      const [, , requeue] = nack.getCall(0).args as [Message, boolean, boolean];
      expect(requeue).to.be.true;
      expect(ack.called).to.be.false;
    });

    it("nacks with requeue=false on FatalError", async () => {
      createService.execute.rejects(new FatalError("400 Bad Request"));

      await dispatchCreate(makeMsg(CREATE_PAYLOAD));

      expect(nack.calledOnce).to.be.true;
      const [, , requeue] = nack.getCall(0).args as [Message, boolean, boolean];
      expect(requeue).to.be.false;
      expect(ack.called).to.be.false;
    });

    it("nacks with requeue=false when the message body is not valid JSON", async () => {
      await dispatchCreate(makeInvalidMsg());

      expect(nack.calledOnce).to.be.true;
      const [, , requeue] = nack.getCall(0).args as [Message, boolean, boolean];
      expect(requeue).to.be.false;
      expect(createService.execute.called).to.be.false;
      expect(ack.called).to.be.false;
    });
  });
});
