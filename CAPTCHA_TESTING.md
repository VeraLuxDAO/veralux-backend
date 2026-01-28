# CAPTCHA & Testing Implementation Guide

## 🔐 CAPTCHA System

### Overview
Google reCAPTCHA v3 has been integrated to protect critical endpoints from bot spam and abuse.

### Protected Endpoints

| Endpoint | Protection Level | Reason |
|----------|-----------------|--------|
| `POST /v1/auth` | ✅ Required | Prevent bot account creation |
| `GET /v1/auth/nonce` | ✅ Required | Rate limit nonce generation |
| `POST /v1/groups/rooms` | ✅ Required | Prevent spam group creation |
| `POST /v1/groups/circles` | ✅ Required | Prevent spam circle creation |
| `POST /v1/groups/join` | ✅ Required | Prevent mass bot joining |
| `POST /v1/flows/:id/comments` | ✅ Required | Prevent comment spam |

### Configuration

#### 1. Get reCAPTCHA Keys
Visit https://www.google.com/recaptcha/admin and create a new site:
- Choose **reCAPTCHA v3**
- Add your domains
- Copy the **Site Key** (frontend) and **Secret Key** (backend)

#### 2. Environment Variables
```bash
# Required
RECAPTCHA_SECRET_KEY="your-secret-key-here"
RECAPTCHA_SITE_KEY="your-site-key-here"

# Optional (defaults shown)
RECAPTCHA_THRESHOLD="0.5"  # Score threshold (0.0-1.0)
CAPTCHA_ENABLED="true"     # Set to "false" to disable
```

#### 3. Frontend Integration

**Install reCAPTCHA Script:**
```html
<script src="https://www.google.com/recaptcha/api.js?render=YOUR_SITE_KEY"></script>
```

**Get Token Before API Call:**
```typescript
async function makeProtectedRequest() {
  // Get CAPTCHA token
  const token = await grecaptcha.execute(RECAPTCHA_SITE_KEY, { 
    action: 'submit' 
  });

  // Send with request
  const response = await fetch('/api/v1/auth', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Captcha-Token': token  // Token in header
    },
    body: JSON.stringify({
      walletAddress,
      signature,
      captchaToken: token  // Or in body
    })
  });
}
```

### How It Works

1. **Frontend**: Generates invisible token on user interaction
2. **Backend**: Verifies token with Google's API
3. **Scoring**: Google returns score (0.0 = bot, 1.0 = human)
4. **Decision**: If score < threshold, request is rejected

### Threshold Guidelines

| Threshold | Effect | Use Case |
|-----------|--------|----------|
| 0.1 | Very permissive | Testing only |
| 0.3 | Permissive | Public APIs |
| **0.5** | **Balanced** | **Recommended default** |
| 0.7 | Strict | High-security endpoints |
| 0.9 | Very strict | Admin actions |

### Development Mode

```bash
# Disable CAPTCHA during development
CAPTCHA_ENABLED="false"

# Or leave blank secret key (auto-disables in dev mode)
# RECAPTCHA_SECRET_KEY=""
```

### Monitoring

Check logs for CAPTCHA activity:
```bash
# View CAPTCHA verifications
grep "CAPTCHA verification" logs/app.log

# Check low scores
grep "score too low" logs/app.log
```

---

## 🧪 Testing System

### Overview
Comprehensive test suite using Jest and Supertest for unit and integration testing.

### Test Structure

```
src/
  __tests__/
    setup.ts                  # Test configuration
    error-handler.test.ts     # Error handling tests
    comments.test.ts          # Comments API tests
    captcha.test.ts          # CAPTCHA middleware tests
```

### Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run in watch mode (for development)
npm run test:watch

# Run with verbose output
npm run test:verbose
```

### Test Categories

#### 1. **Error Handler Tests** (`error-handler.test.ts`)
- Custom error class validation
- Error handler middleware behavior
- Prisma error transformation
- Async error handling

#### 2. **Comments API Tests** (`comments.test.ts`)
- Comment creation and validation
- Threaded replies
- Pagination
- Authorization checks
- Soft delete functionality

#### 3. **CAPTCHA Tests** (`captcha.test.ts`)
- Token verification
- Score validation
- Optional CAPTCHA behavior
- Environment configuration
- Error handling

### Writing New Tests

```typescript
import { describe, it, expect, beforeAll } from '@jest/globals';
import { prisma, createTestUser, cleanupTestData } from './setup.js';

describe('My Feature', () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  it('should do something', async () => {
    // Test logic
    expect(true).toBe(true);
  });
});
```

### Test Helpers

```typescript
// Create test user
const user = await createTestUser({
  walletAddress: '0xtest123'
});

// Create test flow
const flow = await createTestFlow(userId, {
  patchId: 'test-patch'
});

// Generate JWT token
const token = generateTestToken(userId);

// Cleanup test data
await cleanupTestData();
```

### Coverage Thresholds

Current thresholds (in `jest.config.js`):
- **Branches**: 60%
- **Functions**: 60%
- **Lines**: 60%
- **Statements**: 60%

---

## 📊 Current Implementation Status

### ✅ Completed

1. **CAPTCHA Middleware**
   - Full reCAPTCHA v3 integration
   - Configurable thresholds
   - Optional/required modes
   - Comprehensive logging

2. **Protected Endpoints**
   - Auth routes (login, nonce)
   - Group routes (create, join)
   - Comments routes (create)

3. **Error Handling**
   - Global error middleware
   - Custom error classes
   - Prisma error transformation
   - Async error wrapper

4. **Test Framework**
   - Jest configuration
   - Test setup utilities
   - 60% coverage threshold
   - Integration test examples

### 📝 Test Files Created

- `jest.config.js` - Jest configuration
- `src/__tests__/setup.ts` - Test utilities
- `src/__tests__/error-handler.test.ts` - Error handling tests
- `src/__tests__/comments.test.ts` - Comments API tests
- `src/__tests__/captcha.test.ts` - CAPTCHA tests

### 🚀 Usage

**Run tests before commits:**
```bash
npm test
```

**Check coverage:**
```bash
npm run test:coverage
```

**Development workflow:**
```bash
npm run test:watch
```

---

## 🛡️ Security Benefits

1. **Bot Prevention**: CAPTCHA blocks automated account creation
2. **Spam Protection**: Rate limiting + CAPTCHA on high-risk endpoints
3. **Type Safety**: Removed all `as any` casts from codebase
4. **Error Handling**: Consistent error responses across API
5. **Testing**: Automated tests catch regressions early

