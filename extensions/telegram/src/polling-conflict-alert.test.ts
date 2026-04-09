import { beforeEach, describe, expect, it, vi } from "vitest";

const { getTelegramExecApprovalApproversMock } = vi.hoisted(() => ({
  getTelegramExecApprovalApproversMock: vi.fn(),
}));

const { sendMessageTelegramMock } = vi.hoisted(() => ({
  sendMessageTelegramMock: vi.fn(async () => ({ ok: true })),
}));

vi.mock("./exec-approvals.js", () => ({
  getTelegramExecApprovalApprovers: getTelegramExecApprovalApproversMock,
}));

vi.mock("./send.js", () => ({
  sendMessageTelegram: sendMessageTelegramMock,
}));

let TelegramGetUpdatesConflictAlerter: typeof import("./polling-conflict-alert.js").TelegramGetUpdatesConflictAlerter;
let TELEGRAM_GET_UPDATES_CONFLICT_ALERT_TEXT: typeof import("./polling-conflict-alert.js").TELEGRAM_GET_UPDATES_CONFLICT_ALERT_TEXT;

describe("TelegramGetUpdatesConflictAlerter", () => {
  beforeEach(async () => {
    ({ TelegramGetUpdatesConflictAlerter, TELEGRAM_GET_UPDATES_CONFLICT_ALERT_TEXT } =
      await import("./polling-conflict-alert.js"));
    getTelegramExecApprovalApproversMock.mockReset().mockReturnValue(["12345"]);
    sendMessageTelegramMock.mockReset().mockResolvedValue({ ok: true });
  });

  it("alerts resolved owner ids", async () => {
    const alerter = new TelegramGetUpdatesConflictAlerter({
      cfg: { channels: { telegram: {} } },
      token: "tok",
      accountId: "default",
    });

    await alerter.notify();

    expect(getTelegramExecApprovalApproversMock).toHaveBeenCalledWith({
      cfg: { channels: { telegram: {} } },
      accountId: "default",
    });
    expect(sendMessageTelegramMock).toHaveBeenCalledWith(
      "12345",
      TELEGRAM_GET_UPDATES_CONFLICT_ALERT_TEXT,
      expect.objectContaining({ token: "tok", accountId: "default" }),
    );
  });

  it("suppresses duplicate alerts during cooldown", async () => {
    let now = 1_000;
    const alerter = new TelegramGetUpdatesConflictAlerter({
      cfg: { channels: { telegram: {} } },
      token: "tok",
      accountId: "default",
      now: () => now,
    });

    await alerter.notify();
    await alerter.notify();
    now += 15 * 60 * 1000;
    await alerter.notify();

    expect(sendMessageTelegramMock).toHaveBeenCalledTimes(2);
  });

  it("skips alerts when no owner ids resolve", async () => {
    const log = vi.fn();
    getTelegramExecApprovalApproversMock.mockReturnValue([]);
    const alerter = new TelegramGetUpdatesConflictAlerter({
      cfg: { channels: { telegram: {} } },
      token: "tok",
      accountId: "default",
      log,
    });

    await alerter.notify();

    expect(sendMessageTelegramMock).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      '[telegram] Skipping getUpdates conflict alert for account "default": no owner Telegram IDs resolved.',
    );
  });
});
