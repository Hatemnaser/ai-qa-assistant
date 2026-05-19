export const CHAT_MESSAGE_ACTION = "chat_message";

export interface UsageIdentity {
  guestId?: string;
  ipAddress?: string;
  userId?: string;
}

export interface UsageCountInput {
  action: string;
  guestId?: string;
  ipHash?: string;
  since: Date;
  userId?: string;
}

export interface UsageRecordInput {
  action: string;
  guestId?: string;
  ipHash?: string;
  units: number;
  userId?: string;
}

export interface UsageReservation {
  limit: number;
  remaining: number;
  used: number;
}
