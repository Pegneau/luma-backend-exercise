import type { Channel, Message } from "amqplib";

import type { CreateAppointmentPayload } from "../services/createAppointment.js";
import type { CreateAppointmentService } from "../services/createAppointment.js";
import type { DateRange } from "../services/syncAppointments.js";
import type { SyncService } from "../services/syncAppointments.js";
import { FatalError } from "../domain/errors/FatalError.js";
import { RetryableError } from "../domain/errors/RetryableError.js";
import { logger } from "../utils/logger.js";

// Queue and exchange names (single source of truth)

const DLX = "luma.dlx";
const QUEUE_SYNC = "luma.appointments.sync";
const QUEUE_CREATE = "luma.appointments.create";
const DLQ_SYNC = "luma.appointments.sync.dlq";
const DLQ_CREATE = "luma.appointments.create.dlq";
const ROUTING_SYNC_FAIL = "sync.fail";
const ROUTING_CREATE_FAIL = "create.fail";

// Message payload shapes (what the producers publish)

interface SyncPayload {
  integratorId: string;
  facilityId: string;
  dateRange: DateRange;
}

// QueueConsumer

export class QueueConsumer {
  constructor(
    private readonly channel: Channel,
    private readonly syncService: SyncService,
    private readonly createService: CreateAppointmentService,
  ) {}

  /**
   * Declares all exchanges, queues, and bindings, then starts consuming.
   *
   * Topology:
   *
   *   luma.appointments.sync   ──(fail)──▶  luma.dlx  ──▶  luma.appointments.sync.dlq
   *   luma.appointments.create ──(fail)──▶  luma.dlx  ──▶  luma.appointments.create.dlq
   *
   * The main queues carry a `x-dead-letter-exchange` argument so RabbitMQ
   * automatically routes nack'd (requeue=false) messages to the DLX.
   * The DLX is a direct exchange; each DLQ binds to its own routing key.
   */
  async listen(): Promise<void> {
    const ch = this.channel;
    //https://amqp-node.github.io/amqplib/channel_api.html for reference
    await ch.assertExchange(DLX, "direct", { durable: true });

    await ch.assertQueue(DLQ_SYNC, { durable: true });
    await ch.assertQueue(DLQ_CREATE, { durable: true });
    await ch.bindQueue(DLQ_SYNC, DLX, ROUTING_SYNC_FAIL);
    await ch.bindQueue(DLQ_CREATE, DLX, ROUTING_CREATE_FAIL);

    //Main queues (point to DLX on failure)
    await ch.assertQueue(QUEUE_SYNC, {
      durable: true,
      arguments: {
        "x-dead-letter-exchange": DLX,
        "x-dead-letter-routing-key": ROUTING_SYNC_FAIL,
      },
    });

    await ch.assertQueue(QUEUE_CREATE, {
      durable: true,
      arguments: {
        "x-dead-letter-exchange": DLX,
        "x-dead-letter-routing-key": ROUTING_CREATE_FAIL,
      },
    });

    // Process one message at a time per consumer — prevents a burst of
    // retryable errors from overwhelming the EHR.
    ch.prefetch(1);

    // Subscribe to the Sync queue.
    // We use .catch() because ch.consume expects a synchronous callback;
    // unhandled async errors here would crash the process.
    await ch.consume(QUEUE_SYNC, (msg) => {
      this.handleSync(msg).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("consumer:unhandled_sync_error", { error: message });
      });
    });

    await ch.consume(QUEUE_CREATE, (msg) => {
      this.handleCreate(msg).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        logger.error("consumer:unhandled_create_error", { error: message });
      });
    });

    logger.info("consumer:listening", {
      queues: [QUEUE_SYNC, QUEUE_CREATE],
    });
  }

  // Handlers

  private async handleSync(msg: Message | null): Promise<void> {
    if (msg === null) return; // consumer was cancelled by the broker

    const payload = parseJson<SyncPayload>(msg.content);

    if (payload === null) {
      logger.error("consumer:parse_error", { queue: QUEUE_SYNC });
      // Malformed JSON can never be fixed by retrying — dead-letter immediately.
      this.channel.nack(msg, false, false);
      return;
    }

    try {
      const result = await this.syncService.execute(
        payload.integratorId,
        payload.facilityId,
        payload.dateRange,
      );

      logger.info("consumer:sync_ack", {
        integratorId: payload.integratorId,
        facilityId: payload.facilityId,
        ...result,
      });

      this.channel.ack(msg);
    } catch (err) {
      this.handleError(msg, err, {
        queue: QUEUE_SYNC,
        integratorId: payload.integratorId,
        facilityId: payload.facilityId,
      });
    }
  }

  private async handleCreate(msg: Message | null): Promise<void> {
    if (msg === null) return;

    const payload = parseJson<CreateAppointmentPayload>(msg.content);

    if (payload === null) {
      logger.error("consumer:parse_error", { queue: QUEUE_CREATE });
      this.channel.nack(msg, false, false);
      return;
    }

    try {
      const result = await this.createService.execute(payload);

      logger.info("consumer:create_ack", {
        integratorId: payload.integratorId,
        facilityId: payload.facilityId,
        lumaId: result.id,
        ehrId: result.ehrId,
      });

      this.channel.ack(msg);
    } catch (err) {
      this.handleError(msg, err, {
        queue: QUEUE_CREATE,
        integratorId: payload.integratorId,
        facilityId: payload.facilityId,
      });
    }
  }

  // Error routing — the single place that decides ack vs nack

  private handleError(
    msg: Message,
    err: unknown,
    context: Record<string, unknown>,
  ): void {
    if (err instanceof RetryableError) {
      // Transient failure: return message to queue for another consumer/attempt.
      logger.warn("consumer:nack_requeue", {
        ...context,
        error: err.message,
      });
      this.channel.nack(msg, false, true);
      return;
    }

    // FatalError or any unexpected error: dead-letter, never requeue.
    // Unknown errors are treated as fatal to avoid infinite retry loops on bugs.
    const message = err instanceof Error ? err.message : String(err);
    logger.error("consumer:nack_dlq", {
      ...context,
      error: message,
      isFatal: err instanceof FatalError,
    });
    this.channel.nack(msg, false, false);
  }
}

// Helper

/** Safely parses a Buffer as JSON. Returns null on any parse error. */
function parseJson<T>(content: Buffer): T | null {
  try {
    return JSON.parse(content.toString("utf8")) as T;
  } catch {
    return null;
  }
}
