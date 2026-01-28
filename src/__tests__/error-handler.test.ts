/**
 * Error Handler Tests
 * Tests for global error handling middleware
 */

import { describe, it, expect, jest } from '@jest/globals';
import {
  AppError,
  NotFoundError,
  ValidationError,
  AuthorizationError,
  ConflictError,
  errorHandler,
  handlePrismaError
} from '../error-handler.js';

describe('Error Handler', () => {
  describe('Custom Error Classes', () => {
    it('should create NotFoundError with correct properties', () => {
      const error = new NotFoundError('User');
      expect(error.status).toBe(404);
      expect(error.message).toBe('User not found');
      expect(error.name).toBe('NotFoundError');
    });

    it('should create ValidationError with correct properties', () => {
      const error = new ValidationError('Invalid email format');
      expect(error.status).toBe(400);
      expect(error.message).toBe('Invalid email format');
      expect(error.name).toBe('ValidationError');
    });

    it('should create AuthorizationError with correct properties', () => {
      const error = new AuthorizationError('Access denied');
      expect(error.status).toBe(403);
      expect(error.message).toBe('Access denied');
      expect(error.name).toBe('AuthorizationError');
    });

    it('should create ConflictError with correct properties', () => {
      const error = new ConflictError('Resource already exists');
      expect(error.status).toBe(409);
      expect(error.message).toBe('Resource already exists');
      expect(error.name).toBe('ConflictError');
    });
  });

  describe('Error Handler Middleware', () => {
    it('should handle AppError correctly', () => {
      const error = new ValidationError('Test validation error');
      const req = {};
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      errorHandler(error, req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        ok: false,
        error: 'Test validation error',
        code: 'VALIDATION_ERROR'
      });
    });

    it('should handle generic errors with 500 status', () => {
      const error = new Error('Unexpected error');
      const req = {};
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      errorHandler(error, req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        ok: false,
        error: 'Internal server error',
        code: 'INTERNAL_ERROR'
      });
    });
  });

  describe('Prisma Error Handler', () => {
    it('should handle P2002 unique constraint error', () => {
      const prismaError = {
        code: 'P2002',
        meta: { target: ['email'] }
      };

      const result = handlePrismaError(prismaError);
      expect(result).toBeInstanceOf(ConflictError);
      expect(result.message).toContain('email');
    });

    it('should handle P2025 record not found error', () => {
      const prismaError = {
        code: 'P2025',
        meta: {}
      };

      const result = handlePrismaError(prismaError);
      expect(result).toBeInstanceOf(NotFoundError);
    });

    it('should return generic error for unknown Prisma errors', () => {
      const prismaError = {
        code: 'P9999',
        message: 'Unknown error'
      };

      const result = handlePrismaError(prismaError);
      expect(result).toBeInstanceOf(AppError);
      expect(result.status).toBe(500);
    });
  });

  describe('AsyncHandler', () => {
    it('should catch async errors and pass to next', async () => {
      const { asyncHandler } = await import('../error-handler.js');
      
      const handler = asyncHandler(async (req: any, res: any, next: any) => {
        throw new ValidationError('Async error');
      });

      const req: any = {};
      const res: any = {};
      const next = jest.fn();

      await handler(req, res, next);

      expect(next).toHaveBeenCalled();
      const passedError = next.mock.calls[0][0] as ValidationError;
      expect(passedError).toBeInstanceOf(ValidationError);
      expect(passedError.message).toBe('Async error');
    });

    it('should pass through successful async handlers', async () => {
      const { asyncHandler } = await import('../error-handler.js');
      
      const handler = asyncHandler(async (req: any, res: any, next: any) => {
        res.json({ success: true });
      });

      const req: any = {};
      const res: any = {
        json: jest.fn()
      };
      const next = jest.fn();

      await handler(req, res, next);

      expect(res.json).toHaveBeenCalledWith({ success: true });
      expect(next).not.toHaveBeenCalled();
    });
  });
});
