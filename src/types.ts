export type WalrusHash = string;

export type GroupType = "room" | "circle";

export enum ActionType {
  FLOW = "FLOW",
  GLOW = "GLOW",
  PROMOTE = "PROMOTE",
  CHAT = "CHAT",
  GROUP_CREATE = "GROUP_CREATE",
  GROUP_JOIN = "GROUP_JOIN"
}

/** Content objects that land in Walrus */
export type FlowObject =
  | {
      kind: "flow";
      type: "TEXT";
      text: string;
      createdAt: string; // ISO
    }
  | {
      kind: "flow";
      type: "IMAGE";
      imageHash: WalrusHash;
      mime: string;
      caption?: string;
      createdAt: string;
    };

export type ChatObject = {
  kind: "chat";
  groupId?: string;
  text: string;
  actorId?: string;
  createdAt: string; // ISO
};

export type GroupMetaObject = {
  kind: "groupMeta";
  type: GroupType;
  name: string;
  createdAt: string; // ISO
};

export type ActionObject = {
  kind: "action";
  action: ActionType;
  walrusRef?: WalrusHash;        // generally points to another Walrus object
  flowHash?: WalrusHash;         // used by GLOW/PROMOTE
  groupId?: string;              // GROUP_CREATE/GROUP_JOIN/CHAT
  visibilityBoost?: number;      // PROMOTE (+10)
  actorId?: string;
  createdAt: string;             // ISO
};
