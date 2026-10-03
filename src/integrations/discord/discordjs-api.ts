import {
  ActivityType,
  ChannelType,
  Client,
  DiscordAPIError,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
  WebhookClient,
  type Message,
  type Guild,
  type GuildBasedChannel,
} from "discord.js";
import type { RESTOptions } from "discord.js";
import { discordFetch } from "./discord-fetch.js";
import { isImage } from "../../egress/files.js";
import { extraApi } from "./discordjs-extras.js";
import {
  UnknownMessageError,
  UnknownWebhookError,
  type DiscordApi,
  type IncomingMessage,
  type WebhookMessage,
  type WebhookRef,
} from "./types.js";

/** Permissions the bot needs in the server. */
const REQUIRED = {
  ViewChannel: PermissionFlagsBits.ViewChannel,
  SendMessages: PermissionFlagsBits.SendMessages,
  AttachFiles: PermissionFlagsBits.AttachFiles,
  ReadMessageHistory: PermissionFlagsBits.ReadMessageHistory,
  ManageChannels: PermissionFlagsBits.ManageChannels,
  ManageRoles: PermissionFlagsBits.ManageRoles,
  ManageWebhooks: PermissionFlagsBits.ManageWebhooks,
  AddReactions: PermissionFlagsBits.AddReactions,
  SendMessagesInThreads: PermissionFlagsBits.SendMessagesInThreads,
};

/** Log in as the bot and return the Discord operations the bridge uses. */
export async function connectDiscord(
  token: string,
  guildId: string,
): Promise<DiscordApi & { raw: { client: Client; guild: Guild } }> {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      // Voice calls (VOICE_URL): who joins which voice channel.
      GatewayIntentBits.GuildVoiceStates,
    ],
  });
  const ready = new Promise<void>((resolve) =>
    client.once(Events.ClientReady, () => resolve()),
  );
  try {
    await client.login(token);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      /disallowed intents/i.test(msg)
        ? 'The bot needs the "Message Content Intent": Discord Developer Portal → your app → Bot → Privileged Gateway Intents.'
        : /token/i.test(msg)
          ? "Discord rejected DISCORD_BOT_TOKEN. Copy it again from Developer Portal → your app → Bot → Reset Token."
          : msg,
    );
  }
  await ready;

  let guild: Guild;
  try {
    guild = await client.guilds.fetch(guildId);
  } catch {
    await client.destroy();
    throw new Error(
      `The bot isn't in the server ${guildId}. Invite it (Developer Portal → OAuth2 → URL Generator, scope "bot") or check DISCORD_GUILD_ID.`,
    );
  }
  await guild.channels.fetch();
  await guild.roles.fetch();
  const me = await guild.members.fetchMe();
  const missing = Object.entries(REQUIRED)
    .filter(([, flag]) => !me.permissions.has(flag))
    .map(([name]) => name);
  if (missing.length)
    console.warn(
      `[discord] The bot is missing permissions: ${missing.join(", ")}. Give its role these in Server Settings → Roles.`,
    );

  const webhookClients = new Map<string, WebhookClient>();
  /** A channel or thread the bot can post in (threads aren't always cached). */
  const sendable = async (id: string) => {
    const c =
      guild.channels.cache.get(id) ??
      (await client.channels.fetch(id).catch(() => null));
    return c && c.isSendable() && "guildId" in c ? c : undefined;
  };
  const find = (pred: (c: GuildBasedChannel) => boolean) =>
    guild.channels.cache.find(pred);
  const extras = extraApi(client, guild, guildId);
  return {
    raw: { client, guild },
    botName: client.user?.username ?? "bot",
    guildName: guild.name,

    async ensureCategory(name, opts = {}) {
      const known = opts.knownId && guild.channels.cache.get(opts.knownId);
      if (known && known.type === ChannelType.GuildCategory) return known.id;
      const existing = find(
        (c) => c.type === ChannelType.GuildCategory && c.name === name,
      );
      if (existing) return existing.id;
      const created = await guild.channels.create({
        name,
        type: ChannelType.GuildCategory,
        ...(opts.readOnly
          ? {
              permissionOverwrites: [
                {
                  id: guild.roles.everyone.id,
                  deny: [PermissionFlagsBits.SendMessages],
                },
                {
                  id: client.user!.id,
                  allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.AttachFiles,
                    PermissionFlagsBits.ManageWebhooks,
                  ],
                },
              ],
            }
          : {}),
      });
      return created.id;
    },

    async ensureTextChannel(name, categoryId, opts = {}) {
      const known = opts.knownId && guild.channels.cache.get(opts.knownId);
      if (known && known.type === ChannelType.GuildText) return known.id;
      const existing = find(
        (c) =>
          c.type === ChannelType.GuildText &&
          c.name === name &&
          c.parentId === categoryId,
      );
      if (existing) return existing.id;
      const created = await guild.channels.create({
        name,
        type: ChannelType.GuildText,
        parent: categoryId,
        ...(opts.topic ? { topic: opts.topic.slice(0, 1024) } : {}),
      });
      // Take the category's permissions (e.g. read-only Agent DMs).
      await created.lockPermissions().catch(() => {});
      return created.id;
    },

    async ensureRole(name, knownId) {
      const known = knownId && guild.roles.cache.get(knownId);
      if (known) return known.id;
      const existing = guild.roles.cache.find((r) => r.name === name);
      if (existing) return existing.id;
      const created = await guild.roles.create({
        name,
        mentionable: true,
        reason: "agent-office: lets you @mention this agent",
      });
      return created.id;
    },

    async createWebhook(channelId) {
      const channel = guild.channels.cache.get(channelId);
      if (
        !channel ||
        (channel.type !== ChannelType.GuildText &&
          channel.type !== ChannelType.GuildForum &&
          // A voice channel's text chat (call transcripts).
          channel.type !== ChannelType.GuildVoice)
      )
        throw new Error(`Discord channel ${channelId} not found`);
      const hook = await channel.createWebhook({ name: "agent-office" });
      if (!hook.token)
        throw new Error("Discord returned a webhook without a token");
      return { id: hook.id, token: hook.token };
    },

    async sendWebhook(hook: WebhookRef, msg: WebhookMessage) {
      let wc = webhookClients.get(hook.id);
      if (!wc) {
        // Uploads can take longer than the default 15 s timeout.
        wc = new WebhookClient(
          { id: hook.id, token: hook.token },
          {
            rest: {
              timeout: 60_000,
              retries: 1,
              makeRequest: discordFetch as RESTOptions["makeRequest"],
            },
          },
        );
        webhookClients.set(hook.id, wc);
      }
      try {
        await wc.send({
          content: msg.content,
          username: msg.username.slice(0, 80),
          ...(msg.avatarUrl ? { avatarURL: msg.avatarUrl } : {}),
          // Only the roles we mean to ping; never @everyone or users.
          allowedMentions: { parse: [], roles: msg.pingRoles ?? [] },
          ...(msg.threadId ? { threadId: msg.threadId } : {}),
          ...(msg.files?.length
            ? {
                files: msg.files.map((f) => ({
                  attachment: f.path,
                  name: f.name,
                })),
              }
            : {}),
        });
      } catch (err) {
        if (
          err instanceof DiscordAPIError &&
          err.code === RESTJSONErrorCodes.UnknownWebhook
        ) {
          wc.destroy();
          webhookClients.delete(hook.id);
          throw new UnknownWebhookError(err.message);
        }
        if (err instanceof Error && err.name === "AbortError")
          throw new Error("Discord didn't answer within 60 s", { cause: err });
        throw err;
      }
    },

    async sendMessage(channelId, content) {
      const channel = await sendable(channelId);
      if (!channel) throw new Error(`Discord channel ${channelId} not found`);
      const msg = await channel.send({
        content,
        allowedMentions: { parse: [] },
      });
      return msg.id;
    },

    async editMessage(channelId, messageId, content) {
      const channel = guild.channels.cache.get(channelId);
      if (!channel || channel.type !== ChannelType.GuildText)
        throw new UnknownMessageError(`Discord channel ${channelId} not found`);
      try {
        await channel.messages.edit(messageId, {
          content,
          allowedMentions: { parse: [] },
        });
      } catch (err) {
        if (
          err instanceof DiscordAPIError &&
          err.code === RESTJSONErrorCodes.UnknownMessage
        )
          throw new UnknownMessageError(err.message);
        throw err;
      }
    },

    ...extras,

    async sendTyping(channelId) {
      const channel = guild.channels.cache.get(channelId);
      if (channel?.type === ChannelType.GuildText) await channel.sendTyping();
    },

    setPresence(text, busy) {
      client.user?.setPresence({
        status: busy ? "online" : "idle",
        activities: [
          { name: "Custom Status", type: ActivityType.Custom, state: text },
        ],
      });
    },

    onMessage(fn: (m: IncomingMessage) => void) {
      // In order, though a reply waits for the message it answers.
      let inOrder: Promise<void> = Promise.resolve();
      client.on(Events.MessageCreate, (m) => {
        if (m.guildId !== guildId) return;
        const fromBot = m.author.bot || !!m.webhookId;
        inOrder = inOrder.then(async () => {
          const ref =
            m.reference?.messageId && !fromBot
              ? await m.fetchReference().catch(() => undefined)
              : undefined;
          deliver(m, fromBot, ref);
        });
      });
      const deliver = (
        m: Message,
        fromBot: boolean,
        ref: Message | undefined,
      ) => {
        const thread = m.channel.isThread() ? m.channel : undefined;
        fn({
          ...(ref
            ? {
                replyTo: {
                  // A webhook post's author is the name it was posted as.
                  name: ref.author.username,
                  text: ref.content,
                  fromBot: ref.author.bot || !!ref.webhookId,
                },
              }
            : {}),
          id: m.id,
          channelId: m.channelId,
          ...(thread
            ? {
                parentId: thread.parentId ?? undefined,
                threadName: thread.name,
              }
            : {}),
          content: m.content,
          roleIds: [...m.mentions.roles.keys()],
          attachmentUrls: [...m.attachments.values()].map((a) => a.url),
          images: [...m.attachments.values()]
            .filter((a) => isImage(a.contentType ?? ""))
            .map((a) => ({
              url: a.url,
              name: a.name,
              contentType: a.contentType!,
              size: a.size,
            })),
          fromBot,
        });
      };
    },

    async close() {
      for (const wc of webhookClients.values()) wc.destroy();
      await client.destroy();
    },
  };
}
