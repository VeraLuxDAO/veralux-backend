import { z } from "zod";

const urlRegex = /(https?:\/\/[^\s]+)/gi;

export function parseAllowedHosts(): string[] {
  const raw = process.env.ALLOWED_LINK_HOSTS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Blocks any http/https links unless host is in ALLOWED_LINK_HOSTS.
 * If ALLOWED_LINK_HOSTS is empty => blocks all external links.
 */
export function assertNoExternalLinks(text?: string) {
  if (!text) return;
  const matches = text.match(urlRegex);
  if (!matches) return;

  const allowed = new Set(parseAllowedHosts());
  for (const m of matches) {
    try {
      const u = new URL(m);
      const host = u.hostname.toLowerCase();
      if (!allowed.size || !allowed.has(host)) {
        const err = new Error(
          "External links are not allowed. Only permitted hosts in ALLOWED_LINK_HOSTS may be used."
        );
        (err as any).status = 400;
        throw err;
      }
    } catch {
      const err = new Error("Invalid URL detected in text.");
      (err as any).status = 400;
      throw err;
    }
  }
}

export const postFlowTextSchema = z.object({
  text: z.string().min(1).max(2000)
});

export const postGlowSchema = z.object({
  flowHash: z.string().min(10),
  actorId: z.string().optional()
});

export const postPromoteSchema = z.object({
  flowHash: z.string().min(10),
  actorId: z.string().optional()
});

export const postGroupSchema = z.object({
  type: z.enum(["room", "circle"]),
  name: z.string().min(1).max(80)
});

export const postJoinSchema = z.object({
  groupId: z.string().min(1),
  memberId: z.string().min(1)
});

export const postChatSchema = z.object({
  text: z.string().min(1).max(2000),
  groupId: z.string().optional(),
  actorId: z.string().optional()
});
