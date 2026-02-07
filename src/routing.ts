/** Chat-to-agent routing for transport bridges (Telegram, etc.). */
export class Router {
  private routes = new Map<string, string>();

  set(chatId: string, agentName: string): void {
    this.routes.set(chatId, agentName);
  }

  get(chatId: string): string | undefined {
    return this.routes.get(chatId);
  }

  list(): Map<string, string> {
    return new Map(this.routes);
  }
}
