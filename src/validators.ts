import { z } from "zod";

const linkRegex = /(https?:\/\/|www\.)/i;

export function assertNoLinks(text?: string) {
  if (!text) return;
  if (linkRegex.test(text)) {
    const error = new Error("Links are not allowed in text (no 'http'/'https').");
    (error as any).status = 400;
    throw error;
  }
}

export const postFlowTextSchema = z.object({
  text: z.string().min(1, "text is required").max(2000)
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
