export type WalrusPatchId = string;
export type WalrusHash = WalrusPatchId; // temporary alias until blockchain module renamed

export type GroupType = "room" | "circle";

export enum ActionType {
  FLOW = "FLOW",
  GLOW = "GLOW",
  PROMOTE = "PROMOTE",
  CHAT = "CHAT",
  GROUP_CREATE = "GROUP_CREATE",
  GROUP_JOIN = "GROUP_JOIN"
}

// =============================================================================
// Express Request Extensions
// =============================================================================

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        walletAddress: string;
        username: string | null;
        displayName: string | null;
        avatarPatchId: string | null;
        bio: string | null;
      };
    }
  }
}

// =============================================================================
// Authentication Types
// =============================================================================

/**
 * User profile returned to clients (sensitive fields excluded)
 */
export interface UserProfile {
  id: string;
  walletAddress: string;
  username: string | null;
  displayName: string | null;
  avatarPatchId: string | null;
  bio: string | null;
  lastLoginAt: string;
  createdAt: string;
}

/**
 * Authentication tokens response
 */
export interface AuthTokensResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: UserProfile;
}

/**
 * Nonce response for wallet authentication
 */
export interface NonceResponse {
  nonce: string;
  message: string;
  expiresAt: string;
}

// =============================================================================
// Content Types (Walrus Objects)
// =============================================================================

// =============================================================================
// Content Types (Walrus Objects)
// =============================================================================

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
      imagePatchId: string;
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
  refPatchId?: string;           // generally points to another Walrus object
  flowPatchId?: string;          // used by GLOW/PROMOTE
  groupId?: string;              // GROUP_CREATE/GROUP_JOIN/CHAT
  visibilityBoost?: number;      // PROMOTE (+10)
  actorId?: string;
  createdAt: string;             // ISO
};
