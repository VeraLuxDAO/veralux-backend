/**
 * Media attachments handler for messages
 */

import { Request } from "express";
import multer from "multer";
import path from "path";
import { createLogger } from "./logger.js";

const logger = createLogger("media");

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const ALLOWED_FILE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "application/json"
];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * File filter for multer
 */
function fileFilter(req: any, file: Express.Multer.File, cb: Function): void {
  const isImage = ALLOWED_IMAGE_TYPES.includes(file.mimetype);
  const isAllowed = ALLOWED_FILE_TYPES.includes(file.mimetype);

  if (!isAllowed) {
    cb(new Error("File type not allowed"));
    return;
  }

  const maxSize = isImage ? MAX_IMAGE_SIZE : MAX_FILE_SIZE;
  if (file.size > maxSize) {
    cb(new Error(`File too large. Max size: ${maxSize / 1024 / 1024}MB`));
    return;
  }

  cb(null, true);
}

/**
 * Configure multer storage
 */
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, "./uploads/");
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext);
    cb(null, `${name}-${uniqueSuffix}${ext}`);
  }
});

/**
 * Create upload middleware
 */
export const uploadSingle = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE }
});

export const uploadMultiple = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE, files: 5 }
});

/**
 * Validate media file
 */
export function isValidMediaFile(mimetype: string, size: number): boolean {
  const isImage = ALLOWED_IMAGE_TYPES.includes(mimetype);
  const isAllowed = ALLOWED_FILE_TYPES.includes(mimetype);

  if (!isAllowed) return false;

  const maxSize = isImage ? MAX_IMAGE_SIZE : MAX_FILE_SIZE;
  return size <= maxSize;
}

/**
 * Get file info
 */
export function getFileInfo(file: Express.Multer.File) {
  return {
    filename: file.filename,
    path: file.path,
    size: file.size,
    mimetype: file.mimetype,
    uploadedAt: new Date()
  };
}

/**
 * Log media operation
 */
export function logMediaOperation(operation: string, details: any): void {
  logger.info(operation, details);
}
