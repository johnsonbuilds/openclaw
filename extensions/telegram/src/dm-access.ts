import type { Message } from "@grammyjs/types";
import type { Bot } from "grammy";
import {
  addChannelAllowFromStoreEntry,
  upsertChannelPairingRequest,
} from "openclaw/plugin-sdk/conversation-runtime";
import { createChannelPairingChallengeIssuer } from "openclaw/plugin-sdk/channel-pairing";
import {
  readConfigFileSnapshotForWrite,
  type DmPolicy,
  type OpenClawConfig,
  writeConfigFile,
} from "openclaw/plugin-sdk/config-runtime";
import { logVerbose } from "openclaw/plugin-sdk/runtime-env";
import { withTelegramApiErrorLogging } from "./api-logging.js";
import { resolveSenderAllowMatch, type NormalizedAllowFrom } from "./bot-access.js";
import { renderTelegramHtmlText } from "./format.js";

type TelegramDmAccessLogger = {
  info: (obj: Record<string, unknown>, msg: string) => void;
};

type TelegramSenderIdentity = {
  username: string;
  userId: string | null;
  candidateId: string;
  firstName?: string;
  lastName?: string;
};

function resolveTelegramSenderIdentity(msg: Message, chatId: number): TelegramSenderIdentity {
  const from = msg.from;
  const userId = from?.id != null ? String(from.id) : null;
  return {
    username: from?.username ?? "",
    userId,
    candidateId: userId ?? String(chatId),
    firstName: from?.first_name,
    lastName: from?.last_name,
  };
}

function appendTelegramOwnerAllowFrom(config: OpenClawConfig, ownerEntry: string): OpenClawConfig {
  const current = Array.isArray(config.commands?.ownerAllowFrom) ? config.commands.ownerAllowFrom : [];
  const normalized = current
    .map((entry) => String(entry ?? "").trim())
    .filter((entry) => entry.length > 0);
  if (normalized.includes(ownerEntry)) {
    return config;
  }
  return {
    ...config,
    commands: {
      ...(config.commands ?? {}),
      ownerAllowFrom: [...normalized, ownerEntry],
    },
  } satisfies OpenClawConfig;
}

async function ensureTelegramFirstDmSenderIsOwner(params: {
  telegramUserId: string;
  logger: TelegramDmAccessLogger;
  chatId: number;
  username: string;
}): Promise<void> {
  const ownerEntry = `telegram:${params.telegramUserId}`;
  const { snapshot, writeOptions } = await readConfigFileSnapshotForWrite();
  const config = (snapshot.valid ? snapshot.config : {}) as OpenClawConfig;
  const nextConfig = appendTelegramOwnerAllowFrom(config, ownerEntry);
  if (nextConfig === config) {
    return;
  }
  await writeConfigFile(nextConfig, writeOptions);
  params.logger.info(
    {
      chatId: String(params.chatId),
      senderUserId: params.telegramUserId,
      username: params.username || undefined,
      ownerAllowFromEntry: ownerEntry,
    },
    "telegram auto-added first dm sender to commands.ownerAllowFrom",
  );
}

export async function enforceTelegramDmAccess(params: {
  isGroup: boolean;
  dmPolicy: DmPolicy;
  msg: Message;
  chatId: number;
  effectiveDmAllow: NormalizedAllowFrom;
  accountId: string;
  bot: Bot;
  logger: TelegramDmAccessLogger;
  addAllowFromStoreEntry?: typeof addChannelAllowFromStoreEntry;
  upsertPairingRequest?: typeof upsertChannelPairingRequest;
}): Promise<boolean> {
  const {
    isGroup,
    dmPolicy,
    msg,
    chatId,
    effectiveDmAllow,
    accountId,
    bot,
    logger,
    addAllowFromStoreEntry,
    upsertPairingRequest,
  } = params;
  if (isGroup) {
    return true;
  }
  if (dmPolicy === "disabled") {
    return false;
  }
  if (dmPolicy === "open") {
    return true;
  }

  const sender = resolveTelegramSenderIdentity(msg, chatId);
  const allowMatch = resolveSenderAllowMatch({
    allow: effectiveDmAllow,
    senderId: sender.candidateId,
    senderUsername: sender.username,
  });
  const allowMatchMeta = `matchKey=${allowMatch.matchKey ?? "none"} matchSource=${
    allowMatch.matchSource ?? "none"
  }`;
  const allowed =
    effectiveDmAllow.hasWildcard || (effectiveDmAllow.hasEntries && allowMatch.allowed);
  if (allowed) {
    return true;
  }

  if (dmPolicy === "pairing" && !effectiveDmAllow.hasEntries) {
    try {
      const telegramUserId = sender.userId ?? sender.candidateId;
      await (addAllowFromStoreEntry ?? addChannelAllowFromStoreEntry)({
        channel: "telegram",
        entry: telegramUserId,
        accountId,
      });
      await ensureTelegramFirstDmSenderIsOwner({
        telegramUserId,
        logger,
        chatId,
        username: sender.username,
      });
      logger.info(
        {
          chatId: String(chatId),
          senderUserId: telegramUserId,
          username: sender.username || undefined,
        },
        "telegram auto-allowlisted first dm sender",
      );
      return true;
    } catch (err) {
      logVerbose(`telegram auto-allowlist failed for chat ${chatId}: ${String(err)}`);
    }
  }

  if (dmPolicy === "pairing") {
    try {
      const telegramUserId = sender.userId ?? sender.candidateId;
      await createChannelPairingChallengeIssuer({
        channel: "telegram",
        upsertPairingRequest: async ({ id, meta }) =>
          await (upsertPairingRequest ?? upsertChannelPairingRequest)({
            channel: "telegram",
            id,
            accountId,
            meta,
          }),
      })({
        senderId: telegramUserId,
        senderIdLine: `Your Telegram user id: ${telegramUserId}`,
        meta: {
          username: sender.username || undefined,
          firstName: sender.firstName,
          lastName: sender.lastName,
        },
        onCreated: () => {
          logger.info(
            {
              chatId: String(chatId),
              senderUserId: sender.userId ?? undefined,
              username: sender.username || undefined,
              firstName: sender.firstName,
              lastName: sender.lastName,
              matchKey: allowMatch.matchKey ?? "none",
              matchSource: allowMatch.matchSource ?? "none",
            },
            "telegram pairing request",
          );
        },
        sendPairingReply: async (text) => {
          const html = renderTelegramHtmlText(text);
          await withTelegramApiErrorLogging({
            operation: "sendMessage",
            fn: () => bot.api.sendMessage(chatId, html, { parse_mode: "HTML" }),
          });
        },
        onReplyError: (err) => {
          logVerbose(`telegram pairing reply failed for chat ${chatId}: ${String(err)}`);
        },
      });
    } catch (err) {
      logVerbose(`telegram pairing reply failed for chat ${chatId}: ${String(err)}`);
    }
    return false;
  }

  logVerbose(
    `Blocked unauthorized telegram sender ${sender.candidateId} (dmPolicy=${dmPolicy}, ${allowMatchMeta})`,
  );
  return false;
}
