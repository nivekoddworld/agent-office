import {
  ApplicationCommandOptionType,
  ChannelType,
  DiscordAPIError,
  Events,
  MessageFlags,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
  Routes,
  type Client,
  type Guild,
} from "discord.js";
import { UnknownMessageError, type DiscordApi } from "./types.js";

/** The forum, reaction and slash-command parts of the Discord API. */
export function extraApi(
  client: Client,
  guild: Guild,
  guildId: string,
): Pick<
  DiscordApi,
  | "ensureForum"
  | "createPost"
  | "updatePost"
  | "react"
  | "setCommands"
  | "onCommand"
> {
  const gone = (err: unknown) =>
    err instanceof DiscordAPIError &&
    (err.code === RESTJSONErrorCodes.UnknownMessage ||
      err.code === RESTJSONErrorCodes.UnknownChannel);
  /** Missing permissions etc.: log once per kind and carry on. */
  const warned = new Set<string>();
  const bestEffort = (what: string) => (err: unknown) => {
    if (gone(err)) throw err;
    if (!warned.has(what)) {
      warned.add(what);
      console.warn(
        `[discord] Couldn't ${what}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  return {
    async ensureForum(name, categoryId, opts) {
      const known = opts.knownId && guild.channels.cache.get(opts.knownId);
      let forum =
        known && known.type === ChannelType.GuildForum
          ? known
          : guild.channels.cache.find(
              (c) =>
                c.type === ChannelType.GuildForum &&
                c.name === name &&
                c.parentId === categoryId,
            );
      if (!forum || forum.type !== ChannelType.GuildForum) {
        forum = await guild.channels.create({
          name,
          type: ChannelType.GuildForum,
          parent: categoryId,
          ...(opts.topic ? { topic: opts.topic.slice(0, 1024) } : {}),
          availableTags: opts.tags.map((t) => ({ name: t })),
        });
      }
      const have = new Set(forum.availableTags.map((t) => t.name));
      const missing = opts.tags.filter((t) => !have.has(t));
      if (missing.length)
        forum = await forum.setAvailableTags([
          ...forum.availableTags,
          ...missing.map((t) => ({ name: t })),
        ]);
      const tags = Object.fromEntries(
        forum.availableTags.map((t) => [t.name, t.id]),
      );
      return { id: forum.id, tags };
    },

    async createPost(forumId, title, content, tagIds) {
      const forum = guild.channels.cache.get(forumId);
      if (!forum || forum.type !== ChannelType.GuildForum)
        throw new Error(`Discord forum ${forumId} not found`);
      const thread = await forum.threads.create({
        name: title.slice(0, 100),
        message: { content, allowedMentions: { parse: [] } },
        appliedTags: tagIds.slice(0, 5),
      });
      // A forum post's first message has the thread's id.
      return { threadId: thread.id, messageId: thread.id };
    },

    async updatePost(threadId, messageId, change) {
      try {
        const thread = await client.channels.fetch(threadId);
        if (!thread?.isThread()) throw new UnknownMessageError("not a thread");
        if (thread.archived && change.archived !== true)
          await thread
            .setArchived(false)
            .catch(bestEffort("reopen a task post"));
        if (change.content !== undefined)
          await thread.messages.edit(messageId, {
            content: change.content,
            allowedMentions: { parse: [] },
          });
        if (change.tagIds)
          await thread
            .setAppliedTags(change.tagIds.slice(0, 5))
            .catch(bestEffort("set a task post's tags"));
        if (
          change.archived !== undefined &&
          change.archived !== thread.archived
        )
          await thread
            .setArchived(change.archived)
            .catch(bestEffort("archive a task post"));
      } catch (err) {
        if (gone(err)) throw new UnknownMessageError(String(err));
        throw err;
      }
    },

    async react(channelId, messageId, emoji, on) {
      const route = Routes.channelMessageOwnReaction(
        channelId,
        messageId,
        encodeURIComponent(emoji),
      );
      await (on ? client.rest.put(route) : client.rest.delete(route));
    },

    async setCommands(defs, agentNames) {
      const choices = agentNames
        .slice(0, 25)
        .map((a) => ({ name: a, value: a }));
      await guild.commands.set(
        defs.map((d) => ({
          name: d.name,
          description: d.description,
          options: d.agentOption
            ? [
                {
                  type: ApplicationCommandOptionType.String,
                  name: "agent",
                  description: "Which agent",
                  required: true,
                  choices,
                },
              ]
            : [],
        })),
      );
    },

    onCommand(fn) {
      client.on(Events.InteractionCreate, (i) => {
        if (!i.isChatInputCommand() || i.guildId !== guildId) return;
        const member = i.member;
        const roleIds =
          member && "roles" in member && !Array.isArray(member.roles)
            ? [...member.roles.cache.keys()]
            : Array.isArray(member?.roles)
              ? member.roles
              : [];
        fn({
          name: i.commandName,
          agent: i.options.getString("agent") ?? undefined,
          roleIds,
          isManager: !!i.memberPermissions?.has(
            PermissionFlagsBits.ManageGuild,
          ),
          reply: async (text) => {
            await i.reply({
              content: text,
              flags: MessageFlags.Ephemeral,
              allowedMentions: { parse: [] },
            });
          },
        });
      });
    },
  };
}
