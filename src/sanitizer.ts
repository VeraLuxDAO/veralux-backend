/**
 * Input Sanitization & XSS Prevention Module
 * ==========================================
 * Sanitizes user input to prevent XSS and injection attacks
 */

import { createLogger } from "./logger.js";

const logger = createLogger("sanitizer");

/**
 * Remove potentially dangerous HTML/script content
 */
function stripHtmlTags(input: string): string {
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
    .replace(/<on\w+\s*=/gi, "")
    .replace(/javascript:/gi, "");
}

/**
 * Escape special HTML characters
 */
function escapeHtml(text: string): string {
  const map: { [key: string]: string } = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (char) => map[char] || char);
}

/**
 * Remove null bytes which can cause truncation
 */
function removeNullBytes(input: string): string {
  return input.replace(/\0/g, "");
}

/**
 * Normalize whitespace (remove excessive spaces, newlines)
 */
function normalizeWhitespace(input: string): string {
  return input
    .replace(/\s+/g, " ")  // Replace multiple spaces with single space
    .trim();
}

/**
 * Remove control characters (except newlines/tabs)
 */
function removeControlCharacters(input: string): string {
  return input.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, "");
}

/**
 * Main sanitization function - applies all security measures
 */
export function sanitizeInput(
  input: string,
  options: {
    allowHtml?: boolean;
    maxLength?: number;
    stripTags?: boolean;
    normalizeSpace?: boolean;
  } = {}
): string {
  if (!input || typeof input !== "string") return "";

  const {
    allowHtml = false,
    maxLength = 10000,
    stripTags = true,
    normalizeSpace = true,
  } = options;

  let sanitized = input;

  // 1. Remove control characters
  sanitized = removeControlCharacters(sanitized);

  // 2. Remove null bytes
  sanitized = removeNullBytes(sanitized);

  // 3. Truncate if too long
  if (sanitized.length > maxLength) {
    logger.warn("Input exceeds max length", {
      length: sanitized.length,
      maxLength,
    });
    sanitized = sanitized.substring(0, maxLength);
  }

  // 4. Normalize whitespace
  if (normalizeSpace) {
    sanitized = normalizeWhitespace(sanitized);
  }

  // 5. Strip HTML/scripts if not allowed
  if (!allowHtml) {
    sanitized = stripHtmlTags(sanitized);
    sanitized = escapeHtml(sanitized);
  }

  return sanitized;
}

/**
 * Sanitize object keys and values
 */
export function sanitizeObject<T extends Record<string, any>>(
  obj: T,
  maxLength: number = 10000
): T {
  const sanitized: Record<string, any> = {};

  for (const [key, value] of Object.entries(obj)) {
    // Sanitize key
    const sanitizedKey = sanitizeInput(key, {
      maxLength: 255,
      normalizeSpace: false,
    });

    if (typeof value === "string") {
      sanitized[sanitizedKey] = sanitizeInput(value, { maxLength });
    } else if (Array.isArray(value)) {
      sanitized[sanitizedKey] = value.map((item) =>
        typeof item === "string" ? sanitizeInput(item, { maxLength }) : item
      );
    } else if (value && typeof value === "object") {
      sanitized[sanitizedKey] = sanitizeObject(value, maxLength);
    } else {
      sanitized[sanitizedKey] = value;
    }
  }

  return sanitized as T;
}

/**
 * Sanitize common user fields
 */
export function sanitizeUserInput(input: {
  username?: string;
  displayName?: string;
  bio?: string;
  text?: string;
  content?: string;
  [key: string]: any;
}): typeof input {
  return {
    ...input,
    username: input.username ? sanitizeInput(input.username, { maxLength: 30 }) : undefined,
    displayName: input.displayName ? sanitizeInput(input.displayName, { maxLength: 50 }) : undefined,
    bio: input.bio ? sanitizeInput(input.bio, { maxLength: 500 }) : undefined,
    text: input.text ? sanitizeInput(input.text, { maxLength: 2000 }) : undefined,
    content: input.content ? sanitizeInput(input.content, { maxLength: 2000 }) : undefined,
  };
}

/**
 * Validate file MIME type
 */
export function isValidImageMimeType(mimeType: string): boolean {
  const allowed = [
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
  ];
  return allowed.includes(mimeType.toLowerCase());
}

/**
 * Validate file size
 */
export function isValidFileSize(bytes: number, maxBytes: number = 10 * 1024 * 1024): boolean {
  return bytes > 0 && bytes <= maxBytes;
}

/**
 * Get file extension from MIME type
 */
export function getFileExtension(mimeType: string): string {
  const map: { [key: string]: string } = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
  };
  return map[mimeType.toLowerCase()] || "unknown";
}
