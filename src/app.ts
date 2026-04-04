import amqp from "amqplib";

import type { AppointmentUpdate, DbClient } from "./clients/dbClient.js";
import type { DateRange, EhrClient } from "./clients/ehrClient.js";
import type { FhirAppointment } from "./types/fhir.js";
import type { LumaAppointment } from "./types/luma.js";
import { QueueConsumer } from "./queue/consumer.js";
import { CreateAppointmentService } from "./services/createAppointment.js";
import { SyncService } from "./services/syncAppointments.js";
import { logger } from "./utils/logger.js";

// In-memory mocks
// Implement the client interfaces so the app boots without real infrastructure.
// Replace with concrete implementations (Postgres, Epic, Athena) when ready.

class MockEhrClient implements EhrClient {
  async fetchAppointments(): Promise<FhirAppointment[]> {
    logger.warn("mock:ehr_fetch — returning empty list");
    return [];
  }

  async postAppointment(_appointment: FhirAppointment): Promise<string> {
    logger.warn("mock:ehr_post — returning stub ehrId");
    return "ehr-stub-id-001";
  }
}

class MockDbClient implements DbClient {
  private readonly store = new Map<string, LumaAppointment>();

  async findAppointmentsByFacility(
    integratorId: string,
    facilityId: string,
    dateRange: DateRange,
  ): Promise<LumaAppointment[]> {
    return [...this.store.values()].filter(
      (app) =>
        app.integratorId === integratorId &&
        app.facilityId === facilityId &&
        app.startTime !== undefined &&
        app.startTime >= dateRange.start &&
        app.startTime <= dateRange.end,
    );
  }

  async createAppointment(appointment: LumaAppointment): Promise<void> {
    this.store.set(appointment.id, appointment);
  }

  async updateAppointment(
    lumaId: string,
    changes: AppointmentUpdate,
  ): Promise<void> {
    const existing = this.store.get(lumaId);
    if (existing === undefined) return;
    this.store.set(lumaId, { ...existing, ...changes });
  }
}

// Bootstrap

async function main(): Promise<void> {
  logger.info("app:starting");

  const connection = await amqp.connect("amqp://localhost");
  const channel = await connection.createChannel();

  logger.info("app:rabbitmq_connected", { url: "amqp://localhost" });

  // Clients
  const ehrClient = new MockEhrClient();
  const dbClient = new MockDbClient();

  // Services (dependencies injected — not instantiated inside services)
  const syncService = new SyncService(ehrClient, dbClient);
  const createService = new CreateAppointmentService(ehrClient, dbClient);

  // Queue consumer
  const consumer = new QueueConsumer(channel, syncService, createService);
  await consumer.listen();

  logger.info("app:ready");

  // Graceful shutdown: close the AMQP connection on SIGINT / SIGTERM
  // so in-flight messages are ack'd before the process exits.
  const shutdown = async (signal: string): Promise<void> => {
    logger.info("app:shutdown", { signal });
    await connection.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  logger.error("app:fatal_startup", { error: message });
  process.exit(1);
});
