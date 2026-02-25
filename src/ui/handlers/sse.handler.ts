import type { ServerResponse } from "node:http";
import type { HandlerContext } from "../handler-context.js";
import type { RouteDefinition } from "../router.js";
import type { EventBuffer } from "../event-buffer.js";
import { getBootstrapState } from "../routes.js";

export interface SseHandlerContext extends HandlerContext {
  sseClients: Set<ServerResponse>;
  eventBuffer: EventBuffer;
}

export function register(ctx: SseHandlerContext): RouteDefinition[] {
  const { workspace, officeId, sseClients, eventBuffer } = ctx;

  return [
    {
      method: "GET",
      pattern: /^\/api\/events$/,
      handler: (req, res, url) => {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        res.flushHeaders();
        res.write(":ok\n\n");
        sseClients.add(res);
        req.on("close", () => sseClients.delete(res));

        const headerVal = req.headers["last-event-id"] as
          | string
          | undefined;
        const queryVal = url.searchParams.get("lastEventId");
        const lastId = parseInt(headerVal ?? queryVal ?? "", 10);
        if (!isNaN(lastId)) {
          const replay = eventBuffer.replaySince(lastId);
          if (replay === null) {
            const snapshot = getBootstrapState(workspace, officeId);
            const snapshotEvent = eventBuffer.push("snapshot", snapshot);
            res.write(
              `id: ${snapshotEvent.id}\nevent: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`,
            );
          } else {
            for (const e of replay) {
              res.write(
                `id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify(e.data)}\n\n`,
              );
            }
          }
        }
      },
    },
  ];
}
