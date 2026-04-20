import type { createChannelPairingChallengeIssuer } from "openclaw/plugin-sdk/channel-pairing";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const createChannelPairingChallengeIssuerMock = vi.hoisted(() => vi.fn());
const addChannelAllowFromStoreEntryMock = vi.hoisted(() =>
  vi.fn(async () => ({ changed: true, allowFrom: ["12345"] })),
);
const upsertChannelPairingRequestMock = vi.hoisted(() =>
  vi.fn(async () => ({ code: "123456", created: true })),
);
const withTelegramApiErrorLoggingMock = vi.hoisted(() => vi.fn(async ({ fn }) => await fn()));
const createPairingPrefixStripperMock = vi.hoisted(
  () => (prefix: RegExp, normalize: (value: string) => string) => (value: string) =>
    normalize(value.replace(prefix, "")),
);

vi.mock("openclaw/plugin-sdk/channel-pairing", () => ({
  createChannelPairingChallengeIssuer: createChannelPairingChallengeIssuerMock,
  createPairingPrefixStripper: createPairingPrefixStripperMock,
  createLoggedPairingApprovalNotifier: () => undefined,
  createTextPairingAdapter: () => undefined,
  createChannelPairingController: () => ({}),
}));

vi.mock("openclaw/plugin-sdk/conversation-runtime", () => ({
  addChannelAllowFromStoreEntry: addChannelAllowFromStoreEntryMock,
  upsertChannelPairingRequest: upsertChannelPairingRequestMock,
  createStaticReplyToModeResolver: (mode: string) => () => mode,
  createTopLevelChannelReplyToModeResolver: () => () => "off",
  createScopedAccountReplyToModeResolver: () => () => "off",
  resolvePinnedMainDmOwnerFromAllowlist: () => undefined,
}));

const readConfigFileSnapshotForWriteMock = vi.hoisted(() => vi.fn());
const writeConfigFileMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("openclaw/plugin-sdk/config-runtime", async () => {
  const actual = await vi.importActual<typeof import("openclaw/plugin-sdk/config-runtime")>(
    "openclaw/plugin-sdk/config-runtime",
  );
  return {
    ...actual,
    readConfigFileSnapshotForWrite: readConfigFileSnapshotForWriteMock,
    writeConfigFile: writeConfigFileMock,
  };
});

vi.mock("./api-logging.js", () => ({
  withTelegramApiErrorLogging: withTelegramApiErrorLoggingMock,
}));

import type { Message } from "@grammyjs/types";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import { normalizeAllowFrom } from "./bot-access.js";
let enforceTelegramDmAccess: typeof import("./dm-access.js").enforceTelegramDmAccess;

function createDmMessage(overrides: Partial<Message> = {}): Message {
  return {
    message_id: 1,
    date: 1,
    chat: { id: 42, type: "private" },
    from: {
      id: 12345,
      is_bot: false,
      first_name: "Test",
      username: "tester",
    },
    text: "hello",
    ...overrides,
  } as Message;
}

describe("enforceTelegramDmAccess", () => {
  beforeAll(async () => {
    ({ enforceTelegramDmAccess } = await import("./dm-access.js"));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    readConfigFileSnapshotForWriteMock.mockResolvedValue({
      snapshot: { valid: true, config: {} as OpenClawConfig },
      writeOptions: {},
    });
    writeConfigFileMock.mockResolvedValue(undefined);
  });

  it("allows DMs when policy is open", async () => {
    const bot = { api: { sendMessage: vi.fn(async () => undefined) } };

    const allowed = await enforceTelegramDmAccess({
      isGroup: false,
      dmPolicy: "open",
      msg: createDmMessage(),
      chatId: 42,
      effectiveDmAllow: normalizeAllowFrom([]),
      accountId: "main",
      bot: bot as never,
      logger: { info: vi.fn() },
      upsertPairingRequest: upsertChannelPairingRequestMock,
    });

    expect(allowed).toBe(true);
    expect(bot.api.sendMessage).not.toHaveBeenCalled();
  });

  it("blocks DMs when policy is disabled", async () => {
    const allowed = await enforceTelegramDmAccess({
      isGroup: false,
      dmPolicy: "disabled",
      msg: createDmMessage(),
      chatId: 42,
      effectiveDmAllow: normalizeAllowFrom([]),
      accountId: "main",
      bot: { api: { sendMessage: vi.fn(async () => undefined) } } as never,
      logger: { info: vi.fn() },
      upsertPairingRequest: upsertChannelPairingRequestMock,
    });

    expect(allowed).toBe(false);
  });

  it("allows DMs for allowlisted senders under pairing policy", async () => {
    const allowed = await enforceTelegramDmAccess({
      isGroup: false,
      dmPolicy: "pairing",
      msg: createDmMessage(),
      chatId: 42,
      effectiveDmAllow: normalizeAllowFrom(["12345"]),
      accountId: "main",
      bot: { api: { sendMessage: vi.fn(async () => undefined) } } as never,
      logger: { info: vi.fn() },
      upsertPairingRequest: upsertChannelPairingRequestMock,
    });

    expect(allowed).toBe(true);
    expect(createChannelPairingChallengeIssuerMock).not.toHaveBeenCalled();
  });

  it("auto-allowlists the first DM sender when pairing allowlist is empty", async () => {
    const sendMessage = vi.fn(async () => undefined);

    const allowed = await enforceTelegramDmAccess({
      isGroup: false,
      dmPolicy: "pairing",
      msg: createDmMessage(),
      chatId: 42,
      effectiveDmAllow: normalizeAllowFrom([]),
      accountId: "main",
      bot: { api: { sendMessage } } as never,
      logger: { info: vi.fn() },
      addAllowFromStoreEntry: addChannelAllowFromStoreEntryMock,
      upsertPairingRequest: upsertChannelPairingRequestMock,
    });

    expect(allowed).toBe(true);
    expect(addChannelAllowFromStoreEntryMock).toHaveBeenCalledWith({
      channel: "telegram",
      entry: "12345",
      accountId: "main",
    });
    expect(writeConfigFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        commands: expect.objectContaining({ ownerAllowFrom: ["telegram:12345"] }),
      }),
      {},
    );
    expect(createChannelPairingChallengeIssuerMock).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("does not duplicate commands.ownerAllowFrom when first sender is already owner", async () => {
    readConfigFileSnapshotForWriteMock.mockResolvedValue({
      snapshot: {
        valid: true,
        config: { commands: { ownerAllowFrom: ["telegram:12345"] } } as OpenClawConfig,
      },
      writeOptions: {},
    });

    const allowed = await enforceTelegramDmAccess({
      isGroup: false,
      dmPolicy: "pairing",
      msg: createDmMessage(),
      chatId: 42,
      effectiveDmAllow: normalizeAllowFrom([]),
      accountId: "main",
      bot: { api: { sendMessage: vi.fn(async () => undefined) } } as never,
      logger: { info: vi.fn() },
      addAllowFromStoreEntry: addChannelAllowFromStoreEntryMock,
      upsertPairingRequest: upsertChannelPairingRequestMock,
    });

    expect(allowed).toBe(true);
    expect(writeConfigFileMock).not.toHaveBeenCalled();
  });

  it("issues a pairing challenge for unauthorized DMs when pairing allowlist already has entries", async () => {
    const sendMessage = vi.fn(async () => undefined);
    const logger = { info: vi.fn() };
    createChannelPairingChallengeIssuerMock.mockReturnValueOnce(
      ({
        sendPairingReply,
        onCreated,
      }: Parameters<ReturnType<typeof createChannelPairingChallengeIssuer>>[0]) =>
        (async () => {
          onCreated?.({ code: "123456" });
          await sendPairingReply("Pairing code: 123456");
        })(),
    );

    const allowed = await enforceTelegramDmAccess({
      isGroup: false,
      dmPolicy: "pairing",
      msg: createDmMessage(),
      chatId: 42,
      effectiveDmAllow: normalizeAllowFrom(["67890"]),
      accountId: "main",
      bot: { api: { sendMessage } } as never,
      logger,
      addAllowFromStoreEntry: addChannelAllowFromStoreEntryMock,
      upsertPairingRequest: upsertChannelPairingRequestMock,
    });

    expect(allowed).toBe(false);
    expect(addChannelAllowFromStoreEntryMock).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [firstCall] = sendMessage.mock.calls as Array<unknown[]>;
    expect(firstCall?.[0]).toBe(42);
    const sentText = String(firstCall?.[1] ?? "");
    expect(sentText).toContain("Pairing code:");
    expect(firstCall?.[2]).toEqual(expect.objectContaining({ parse_mode: "HTML" }));
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: "42",
        senderUserId: "12345",
        username: "tester",
      }),
      "telegram pairing request",
    );
  });
});
