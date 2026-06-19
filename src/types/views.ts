export type Mode = "split" | "thread" | "report";

export type ChannelStatus = "connected" | "disconnected";

export interface Channel {
  name: string;
  status: ChannelStatus;
}
