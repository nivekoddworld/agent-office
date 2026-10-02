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
  type Guild,
  type GuildBasedChannel,
} from "discord.js";
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
};

/** Log in as the bot and return the Discord operations the bridge uses. */
export async function connectDiscord(
  token: string,
  guildId: string,
): Promise<DiscordApi> {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
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
  const find = (pred: (c: GuildBasedChannel) => boolean) =>
    guild.channels.cache.find(pred);

  return {
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
      if (!channel || channel.type !== ChannelType.GuildText)
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
          { rest: { timeout: 60_000, retries: 1 } },
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
      const channel = guild.channels.cache.get(channelId);
      if (!channel || channel.type !== ChannelType.GuildText)
        throw new Error(`Discord channel ${channelId} not found`);
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
      client.on(Events.MessageCreate, (m) => {
        if (m.guildId !== guildId) return;
        fn({
          channelId: m.channelId,
          content: m.content,
          roleIds: [...m.mentions.roles.keys()],
          attachmentUrls: [...m.attachments.values()].map((a) => a.url),
          fromBot: m.author.bot || !!m.webhookId,
        });
      });
    },

    async close() {
      for (const wc of webhookClients.values()) wc.destroy();
      await client.destroy();
    },
  };
}
