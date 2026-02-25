import type { IncomingMessage, ServerResponse } from "node:http";

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  params: Record<string, string>,
) => Promise<void> | void;

export interface RouteDefinition {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  pattern: RegExp;
  paramNames?: string[];
  handler: RouteHandler;
}

export class Router {
  private routes: RouteDefinition[] = [];

  register(routes: RouteDefinition[]): void {
    this.routes.push(...routes);
  }

  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<boolean> {
    const method = req.method ?? "GET";
    const path = url.pathname;
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = path.match(route.pattern);
      if (!match) continue;
      const params: Record<string, string> = {};
      if (route.paramNames) {
        route.paramNames.forEach((name, i) => {
          params[name] = match[i + 1] ?? "";
        });
      }
      await route.handler(req, res, url, params);
      return true;
    }
    return false;
  }
}
