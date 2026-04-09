import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import { formatErrorMessage } from "openclaw/plugin-sdk/ssrf-runtime";
import { getTelegramExecApprovalApprovers } from "./exec-approvals.js";
import { sendMessageTelegram } from "./send.js";

const GET_UPDATES_CONFLICT_ALERT_COOLDOWN_MS = 15 * 60 * 1000;

export const TELEGRAM_GET_UPDATES_CONFLICT_ALERT_TEXT =
  "Telegram bot is temporarily unable to receive messages reliably.\n" +
  "This usually means the same bot token is being used somewhere else at the same time, such as another OpenClaw machine, another project, or a third-party Telegram bot program.\n" +
  "Please keep only one running instance per token. After the other instance is stopped, this service will recover automatically.";

type NotifyTelegramGetUpdatesConflictOpts = {
  cfg: OpenClawConfig;
  token: string;
  accountId: string;
  log?: (line: string) => void;
  now?: () => number;
  cooldownMs?: number;
  resolveOwnerIds?: typeof getTelegramExecApprovalApprovers;
  sendMessage?: typeof sendMessageTelegram;
};

export class TelegramGetUpdatesConflictAlerter {
  readonly #cooldownMs: number;
  readonly #lastSentAtByOwner = new Map<string, number>();
  readonly #now: () => number;
  readonly #resolveOwnerIds: typeof getTelegramExecApprovalApprovers;
  readonly #sendMessage: typeof sendMessageTelegram;

  constructor(private readonly opts: NotifyTelegramGetUpdatesConflictOpts) {
    this.#cooldownMs = opts.cooldownMs ?? GET_UPDATES_CONFLICT_ALERT_COOLDOWN_MS;
    this.#now = opts.now ?? Date.now;
    this.#resolveOwnerIds = opts.resolveOwnerIds ?? getTelegramExecApprovalApprovers;
    this.#sendMessage = opts.sendMessage ?? sendMessageTelegram;
  }

  async notify(): Promise<void> {
    const ownerIds = this.#resolveOwnerIds({
      cfg: this.opts.cfg,
      accountId: this.opts.accountId,
    }).filter((value, index, values) => value && values.indexOf(value) === index);

    if (ownerIds.length === 0) {
      this.opts.log?.(
        `[telegram] Skipping getUpdates conflict alert for account "${this.opts.accountId}": no owner Telegram IDs resolved.`,
      );
      return;
    }

    const now = this.#now();
    for (const ownerId of ownerIds) {
      const lastSentAt = this.#lastSentAtByOwner.get(ownerId);
      if (lastSentAt != null && now - lastSentAt < this.#cooldownMs) {
        continue;
      }
      try {
        await this.#sendMessage(ownerId, TELEGRAM_GET_UPDATES_CONFLICT_ALERT_TEXT, {
          cfg: this.opts.cfg,
          token: this.opts.token,
          accountId: this.opts.accountId,
        });
        this.#lastSentAtByOwner.set(ownerId, now);
      } catch (err) {
        this.opts.log?.(
          `[telegram] Failed to send getUpdates conflict alert to owner ${ownerId}: ${formatErrorMessage(err)}`,
        );
      }
    }
  }
}
