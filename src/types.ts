export type WalrusHash = string;

export type FlowPayload =
  | { type: "TEXT"; text: string }
  | { type: "IMAGE"; imageBuffer: Buffer; mime: string; caption?: string };

export type FlowObject = {
  kind: "flow";
  type: "TEXT" | "IMAGE";
  text?: string;
  imageHash?: WalrusHash;
  mime?: string;
  createdAt: string; // ISO
};

export type ActionObject = {
  kind: "action";
  action: "GLOW" | "PROMOTE";
  flowHash: WalrusHash;
  visibilityBoost?: number; // only for PROMOTE
  actorId?: string;
  createdAt: string; // ISO
};

export type GroupType = "room" | "circle";
