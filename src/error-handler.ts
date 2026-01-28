/**
 * Centralized Error Handling
 * Provides consistent error responses and logging across the API
 */

import { Request, Response, NextFunction } from "express";
import { createLogger } from "./logger.js";
import { ZodError } from "zod";

const logger = createLogger("error-handler");

/**
 * Application Error Class
 * Allows for structured error handling with status codes
 */
export class AppError extends Error {
  constructor(
    public message: string,
    public status: number = 500,
    public code?: string,
    public details?: any
  ) {
    super(message);
    this.name = "AppError";
  }
}

/**
 * Validation Error Class
 * For schema validation errors
 */
export class ValidationError extends AppError {
  constructor(message: string, public fieldErrors?: Record<string, string[]>) {
    super(message, 400, "VALIDATION_ERROR", fieldErrors);
    this.name = "ValidationError";
  }
}

/**
 * Authentication Error Class
 */
export class AuthenticationError extends AppError {
  constructor(message: string = "Authentication failed") {
    super(message, 401, "AUTHENTICATION_ERROR");
    this.name = "AuthenticationError";
  }
}

/**
 * Authorization Error Class
 */
export class AuthorizationError extends AppError {
  constructor(message: string = "Insufficient permissions") {
    super(message, 403, "AUTHORIZATION_ERROR");
    this.name = "AuthorizationError";
  }
}

/**
 * Not Found Error Class
 */
export class NotFoundError extends AppError {
  constructor(resource: string = "Resource") {
    super(`${resource} not found`, 404, "NOT_FOUND");
    this.name = "NotFoundError";
  }
}

/**
 * Conflict Error Class (for duplicate entries, etc.)
 */
export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, "CONFLICT");
    this.name = "ConflictError";
  }
}

/**
 * Convert Zod validation error to AppError
 */
export function handleZodError(error: ZodError): ValidationError {
  const fieldErrors: Record<string, string[]> = {};
  
  error.issues.forEach((issue) => {
    const path = issue.path.join(".");
    if (!fieldErrors[path]) {
      fieldErrors[path] = [];
    }
    fieldErrors[path].push(issue.message);
  });

  return new ValidationError("Validation failed", fieldErrors);
}

/**
 * Centralized Error Response Handler
 */
export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  // Log error details
  const errorLog = {
    method: req.method,
    path: req.path,
    status: err.status || 500,
    code: err.code || "INTERNAL_ERROR",
    message: err.message,
    details: err.details,
    userId: (req as any).user?.id,
    timestamp: new Date().toISOString()
  };

  if (err.status >= 500) {
    logger.error("Server error", errorLog);
  } else {
    logger.warn("Client error", errorLog);
  }

  // Determine response
  const status = err.status || 500;
  const response: any = {
    ok: false,
    error: err.message || "Internal server error",
    code: err.code || "INTERNAL_ERROR"
  };

  // Include validation details if available
  if (err.fieldErrors) {
    response.fieldErrors = err.fieldErrors;
  }

  // Include details if provided
  if (err.details && process.env.NODE_ENV !== "production") {
    response.details = err.details;
  }

  // Don't leak internal errors in production
  if (status >= 500 && process.env.NODE_ENV === "production") {
    response.error = "Internal server error";
  }

  res.status(status).json(response);
}

/**
 * Safe async route wrapper
 * Automatically catches errors and passes to error handler
 */
export function asyncHandler(fn: Function) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Prisma error handler
 * Converts Prisma errors to AppErrors
 */
export function handlePrismaError(error: any): AppError {
  // Unique constraint violation
  if (error.code === "P2002") {
    const field = error.meta?.target?.[0] || "field";
    return new ConflictError(`${field} already exists`);
  }

  // Record not found (shouldn't happen with findUniqueOrThrow)
  if (error.code === "P2025") {
    return new NotFoundError("Resource");
  }

  // Foreign key constraint
  if (error.code === "P2003") {
    return new AppError("Invalid reference", 400, "INVALID_REFERENCE");
  }

  // Generic database error
  logger.error("Prisma error", { code: error.code, message: error.message });
  return new AppError("Database operation failed", 500, "DB_ERROR");
}

/**
 * Request validation wrapper with proper error handling
 */
export function validateRequest(schema: any) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = schema.parse(req.body);
      (req as any).validated = validated;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(handleZodError(error));
      } else {
        next(error);
      }
    }
  };
}
