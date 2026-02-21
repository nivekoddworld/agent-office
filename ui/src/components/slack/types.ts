export interface MessageUsage {
  totalTokens: number;
  totalCost: number;
}

export interface SlackMessageData {
  id: string;
  sender: string;
  text: string;
  timestamp: number;
  isBot: boolean;
  eventType?: string;
  usage?: MessageUsage;
}
