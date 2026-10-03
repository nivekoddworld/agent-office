# Voice calls with agents (experimental)

Talk to an agent out loud in Discord. Each agent gets a voice channel under
**Agent Voice**. Join one and the bot joins you, renamed to that agent, and you
can just talk:

- What you say is turned into text (NVIDIA Nemotron Speech Streaming 0.6B).
- The agent answers in a few spoken sentences, from its own model, with
  thinking off so it answers quickly.
- The answer is read out in the agent's voice (Kyutai Pocket TTS), a sentence
  at a time as it's written.
- Talk over it and it stops (once it hears words, not at every noise).

Speech-to-text and text-to-speech run on the **CPU** in the `voice` container
(about 2–3 GB of RAM, no GPU memory), so the GPU stays free for your model.

## Turning it on

1. Give the bot **Connect** and **Speak** (and **Change Nickname**, so it shows
   up as the agent you're talking to): Server Settings → Roles → the bot's role.
2. In `.env`:
   ```
   COMPOSE_PROFILES=voice
   VOICE_URL=http://voice:8000
   ```
3. `docker compose up -d --build`. The first build downloads the speech models
   (about 1.5 GB). The logs say `[voice] Voice channels ready` once it's on.
4. Join an agent's voice channel and say hi.

## What the agent knows and does during a call

The call has its own short conversation, so it can answer in a second or two
instead of loading the agent's whole working context. It knows:

- who the agent is (its `IDENTITY`, `SOUL` and `CONTEXT` files);
- its open tasks;
- your recent DMs with it;
- what's been said in the call so far.

It can't use tools while talking. When you ask for real work ("send me the
sheets", "make a task for the logo"), it says it'll do it, and the request goes
to the agent as a message (`[From our voice call] …`). The agent then does it
as usual, and you'll see it in its DM channel.

Both sides of the call are kept in the agent's DM history (marked `(voice)`):

- in the dashboard;
- in its `#dm-` channel in Discord;
- where the agent can read them with `read_dm`.

## Group calls

Bring more agents into a call:

- **Ask the agent:** "lead, can you bring artist in?" It says it will and
  brings them in.
- **Or type `/invite artist`** while you're in the call.

Everyone hears everything, and each agent speaks in its own voice; the bot's
name shows who's on the call ("lead & artist").

- **Who answers you:** the agent you name ("artist, what colour…"), or
  otherwise whoever spoke last. Agents answer to the `Name:` in their
  IDENTITY.md too (e.g. "Jim").
- **Agents talk to each other:** one that addresses another ("Lead, does
  that fit?") hands it the floor. After 3 answers in a row they wait for you;
  talking stops whoever's speaking, as usual.
- **Work they take on** goes to whichever agent took it, as in a one-on-one
  call (and gets done even while the office is paused).
- **Each reply is one model call**, so a question passed from lead to artist
  takes two answers' worth of time. `/pause` keeps the model free for the call.

## Voices

Each agent gets a stock voice picked from its name, and keeps it. To choose one,
add a line to the agent's `instructions/IDENTITY.md`, or ask the agent to:

```
Voice: vera
```

Stock voices:

| Women                                                                | Men                                                  |
| -------------------------------------------------------------------- | ---------------------------------------------------- |
| alba, anna, vera, mary, jane, eve, fantine, eponine, azelma, cosette | marius, george, michael, paul, charles, jean, javert |

## Limits

- **One call at a time.** A bot can only be in one voice channel per server.
  Joining another agent's channel moves the bot there; use a group call to
  talk to several agents at once.
- **Your model is shared.** With `--parallel 2`, a call waits for a free slot if
  two agents are both mid-request. `/pause` the office first to have the
  model to yourself, then `/resume`. Calls work while paused, and so does what
  you ask for in a call: that agent does it right away
  (`[scheduler] Paused, but letting lead do what you asked for in a voice call`);
  everything else waits. The logs show where the time goes, for each
  reply:
  `[voice] artist: first words 850 ms, first audio 1400 ms after hearing you`.
- **Use headphones**, or keep Discord's echo cancellation on. If your mic picks
  up the agent's voice, it hears itself and stops talking.
- English only for now.

## Tuning

| Setting                | Default | What it does                                                                                        |
| ---------------------- | ------- | --------------------------------------------------------------------------------------------------- |
| `VOICE_STT_THREADS`    | 4       | CPU threads for speech-to-text                                                                      |
| `VOICE_TTS_THREADS`    | 4       | CPU threads for text-to-speech                                                                      |
| `VOICE_END_OF_TURN_MS` | 900     | Quiet this long and your turn is over. Lower answers sooner but cuts in when you pause mid-sentence |
| `VOICE_DEBUG`          | off     | `on` logs Discord voice connection details, and noises it ignored                                   |

## When nothing happens

`docker compose logs agent-office | grep "\[voice\]"` shows each step of a call:

- `Joined …`: the bot is in the channel.
- `Listening to …`: it's getting your audio.
- `Heard … : "…"`: what it understood.
- `lead says: "…"`: each sentence it speaks.
- `… first words …`: how long the answer took.
- `interrupted (Mazladore said "wait"), stopped talking after 2 sentence(s), last: "…"`:
  someone talked over it, with the words that did it.

The voice container's own log (`docker compose logs voice`) shows each stretch
of speech it transcribed and each reply it spoke. Wherever the steps stop is
where it's stuck.
