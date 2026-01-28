/**
 * Test Setup
 * Global test configuration and utilities
 */

import { PrismaClient } from '@prisma/client';
import { beforeAll, afterAll, beforeEach } from '@jest/globals';

// Create test database connection
export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL
    }
  }
});

// Setup before all tests
beforeAll(async () => {
  // Connect to database
  await prisma.$connect();
  console.log('✓ Test database connected');
});

// Cleanup after each test
beforeEach(async () => {
  // Optional: Clear specific tables between tests
  // Uncomment if you want fresh state per test
  /*
  await prisma.comment.deleteMany({});
  await prisma.flow.deleteMany({});
  await prisma.user.deleteMany({});
  */
});

// Cleanup after all tests
afterAll(async () => {
  await prisma.$disconnect();
  console.log('✓ Test database disconnected');
});

/**
 * Helper: Create test user
 */
export async function createTestUser(data?: Partial<any>) {
  return prisma.user.create({
    data: {
      walletAddress: data?.walletAddress || `0xtest${Date.now()}`,
      username: data?.username || `testuser${Date.now()}`,
      displayName: data?.displayName || 'Test User',
      ...data
    }
  });
}

/**
 * Helper: Create test flow
 */
export async function createTestFlow(authorId: string, data?: Partial<any>) {
  return prisma.flow.create({
    data: {
      type: 'TEXT',
      blobId: data?.blobId || `blob${Date.now()}`,
      patchId: data?.patchId || `patch${Date.now()}`,
      authorId,
      ...data
    }
  });
}

/**
 * Helper: Generate test JWT token
 */
export function generateTestToken(userId: string): string {
  // For testing, you can use a simple mock token or generate a real one
  // This should match your auth.ts JWT generation logic
  const jwt = require('jsonwebtoken');
  return jwt.sign(
    { userId, type: 'access' },
    process.env.JWT_SECRET || 'test-secret',
    { expiresIn: '1h' }
  );
}

/**
 * Helper: Clean up test data
 */
export async function cleanupTestData() {
  await prisma.comment.deleteMany({});
  await prisma.flow.deleteMany({});
  await prisma.user.deleteMany({});
}
