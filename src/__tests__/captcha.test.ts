/**
 * CAPTCHA Middleware Tests
 * Tests for CAPTCHA verification
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import axios from 'axios';
import { verifyCaptcha, optionalCaptcha } from '../middleware/captcha.js';
import { ValidationError } from '../error-handler.js';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('CAPTCHA Middleware', () => {
  let req: any;
  let res: any;
  let next: jest.Mock;

  beforeEach(() => {
    req = {
      headers: {},
      body: {},
      ip: '127.0.0.1',
      path: '/test',
      method: 'POST'
    };
    res = {};
    next = jest.fn();
    
    // Reset environment
    process.env.CAPTCHA_ENABLED = 'true';
    process.env.RECAPTCHA_SECRET_KEY = 'test-secret';
    process.env.RECAPTCHA_THRESHOLD = '0.5';
  });

  describe('verifyCaptcha', () => {
    it('should pass verification with valid token and high score', async () => {
      req.headers['x-captcha-token'] = 'valid-token';
      
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          success: true,
          score: 0.9,
          action: 'submit'
        }
      });

      await verifyCaptcha(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(req.captchaScore).toBe(0.9);
      expect(req.captchaAction).toBe('submit');
    });

    it('should reject verification with low score', async () => {
      req.headers['x-captcha-token'] = 'suspicious-token';
      
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          success: true,
          score: 0.2,
          action: 'submit'
        }
      });

      await expect(verifyCaptcha(req, res, next)).rejects.toThrow(ValidationError);
    });

    it('should reject when token is missing', async () => {
      await expect(verifyCaptcha(req, res, next)).rejects.toThrow(ValidationError);
      await expect(verifyCaptcha(req, res, next)).rejects.toThrow('CAPTCHA verification required');
    });

    it('should reject when reCAPTCHA returns success: false', async () => {
      req.headers['x-captcha-token'] = 'invalid-token';
      
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          success: false,
          'error-codes': ['invalid-input-response']
        }
      });

      await expect(verifyCaptcha(req, res, next)).rejects.toThrow(ValidationError);
    });

    it('should skip verification when CAPTCHA_ENABLED is false', async () => {
      process.env.CAPTCHA_ENABLED = 'false';

      await verifyCaptcha(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('should handle network errors gracefully', async () => {
      req.headers['x-captcha-token'] = 'valid-token';
      
      mockedAxios.post.mockRejectedValueOnce(new Error('Network error'));

      await expect(verifyCaptcha(req, res, next)).rejects.toThrow(ValidationError);
    });

    it('should accept token from body', async () => {
      req.body.captchaToken = 'valid-token';
      
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          success: true,
          score: 0.8,
          action: 'submit'
        }
      });

      await verifyCaptcha(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('optionalCaptcha', () => {
    it('should continue without token', async () => {
      await optionalCaptcha(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('should verify if token is provided', async () => {
      req.headers['x-captcha-token'] = 'valid-token';
      
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          success: true,
          score: 0.9,
          action: 'submit'
        }
      });

      await optionalCaptcha(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(mockedAxios.post).toHaveBeenCalled();
    });

    it('should not block on verification failure', async () => {
      req.headers['x-captcha-token'] = 'invalid-token';
      
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          success: false
        }
      });

      await optionalCaptcha(req, res, next);

      // Should still call next even on failure
      expect(next).toHaveBeenCalled();
    });
  });

  describe('Environment Configuration', () => {
    it('should use custom threshold from environment', async () => {
      process.env.RECAPTCHA_THRESHOLD = '0.7';
      req.headers['x-captcha-token'] = 'medium-score-token';
      
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          success: true,
          score: 0.6,
          action: 'submit'
        }
      });

      await expect(verifyCaptcha(req, res, next)).rejects.toThrow(ValidationError);
    });

    it('should skip in development without secret key', async () => {
      delete process.env.RECAPTCHA_SECRET_KEY;
      process.env.NODE_ENV = 'development';
      req.headers['x-captcha-token'] = 'any-token';

      await verifyCaptcha(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('should fail in production without secret key', async () => {
      delete process.env.RECAPTCHA_SECRET_KEY;
      process.env.NODE_ENV = 'production';
      req.headers['x-captcha-token'] = 'any-token';

      await expect(verifyCaptcha(req, res, next)).rejects.toThrow(ValidationError);
    });
  });
});
