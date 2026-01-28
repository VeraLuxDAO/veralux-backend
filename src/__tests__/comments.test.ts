/**
 * Comments Routes Tests
 * Integration tests for comments API endpoints
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import commentsRouter from '../routes/comments.js';
import { 
  prisma, 
  createTestUser, 
  createTestFlow, 
  generateTestToken,
  cleanupTestData 
} from './setup.js';

// Setup Express app for testing
const app = express();
app.use(express.json());
app.set('prisma', prisma);
app.use('/v1/flows', commentsRouter);
app.use('/v1/comments', commentsRouter);

describe('Comments API', () => {
  let authToken: string;
  let userId: string;
  let flowId: string;
  let commentId: string;

  beforeAll(async () => {
    // Create test user
    const user = await createTestUser({
      walletAddress: '0xtest_comments_user'
    });
    userId = user.id;
    authToken = generateTestToken(userId);

    // Create test flow
    const flow = await createTestFlow(userId, {
      patchId: 'test-flow-patch-001'
    });
    flowId = flow.id;
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  describe('POST /flows/:flowId/comments', () => {
    it('should create a comment successfully', async () => {
      const response = await request(app)
        .post(`/v1/flows/${flowId}/comments`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ 
          content: 'This is a test comment',
          captchaToken: 'skip' // For testing
        });

      expect(response.status).toBe(201);
      expect(response.body.ok).toBe(true);
      expect(response.body.comment).toHaveProperty('id');
      expect(response.body.comment.content).toBe('This is a test comment');
      expect(response.body.comment.flowId).toBe(flowId);
      expect(response.body.comment.author.id).toBe(userId);

      commentId = response.body.comment.id;
    });

    it('should reject empty comments', async () => {
      const response = await request(app)
        .post(`/v1/flows/${flowId}/comments`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ 
          content: '',
          captchaToken: 'skip'
        });

      expect(response.status).toBe(400);
      expect(response.body.ok).toBe(false);
    });

    it('should reject comments over 2000 characters', async () => {
      const longContent = 'a'.repeat(2001);
      const response = await request(app)
        .post(`/v1/flows/${flowId}/comments`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ 
          content: longContent,
          captchaToken: 'skip'
        });

      expect(response.status).toBe(400);
      expect(response.body.ok).toBe(false);
    });

    it('should reject unauthenticated requests', async () => {
      const response = await request(app)
        .post(`/v1/flows/${flowId}/comments`)
        .send({ 
          content: 'Test',
          captchaToken: 'skip'
        });

      expect(response.status).toBe(401);
    });

    it('should reject comments on non-existent flows', async () => {
      const response = await request(app)
        .post('/v1/flows/non-existent-flow/comments')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ 
          content: 'Test comment',
          captchaToken: 'skip'
        });

      expect(response.status).toBe(404);
    });
  });

  describe('GET /flows/:flowId/comments', () => {
    it('should return list of comments', async () => {
      const response = await request(app)
        .get(`/v1/flows/${flowId}/comments`);

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
      expect(Array.isArray(response.body.comments)).toBe(true);
      expect(response.body.comments.length).toBeGreaterThan(0);
      expect(response.body.pagination).toBeDefined();
    });

    it('should support pagination', async () => {
      const response = await request(app)
        .get(`/v1/flows/${flowId}/comments?limit=5&offset=0`);

      expect(response.status).toBe(200);
      expect(response.body.pagination.limit).toBe(5);
      expect(response.body.pagination.offset).toBe(0);
    });

    it('should not return deleted comments', async () => {
      // First delete a comment
      if (commentId) {
        await request(app)
          .delete(`/v1/comments/${commentId}`)
          .set('Authorization', `Bearer ${authToken}`);

        // Then check it's not in the list
        const response = await request(app)
          .get(`/v1/flows/${flowId}/comments`);

        const deletedComment = response.body.comments.find(
          (c: any) => c.id === commentId
        );
        expect(deletedComment).toBeUndefined();
      }
    });
  });

  describe('GET /comments/:commentId/replies', () => {
    let parentCommentId: string;
    let replyId: string;

    beforeAll(async () => {
      // Create parent comment
      const parentResponse = await request(app)
        .post(`/v1/flows/${flowId}/comments`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ 
          content: 'Parent comment',
          captchaToken: 'skip'
        });
      parentCommentId = parentResponse.body.comment.id;

      // Create reply
      const replyResponse = await request(app)
        .post(`/v1/flows/${flowId}/comments`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ 
          content: 'Reply to parent',
          parentId: parentCommentId,
          captchaToken: 'skip'
        });
      replyId = replyResponse.body.comment.id;
    });

    it('should return replies to a comment', async () => {
      const response = await request(app)
        .get(`/v1/comments/${parentCommentId}/replies`);

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
      expect(Array.isArray(response.body.replies)).toBe(true);
      expect(response.body.replies.length).toBeGreaterThan(0);
    });
  });

  describe('PUT /comments/:commentId', () => {
    let editableCommentId: string;

    beforeAll(async () => {
      const response = await request(app)
        .post(`/v1/flows/${flowId}/comments`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ 
          content: 'Original content',
          captchaToken: 'skip'
        });
      editableCommentId = response.body.comment.id;
    });

    it('should update comment content', async () => {
      const response = await request(app)
        .put(`/v1/comments/${editableCommentId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ content: 'Updated content' });

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
      expect(response.body.comment.content).toBe('Updated content');
    });

    it('should reject updates from non-authors', async () => {
      const otherUser = await createTestUser({
        walletAddress: '0xother_user'
      });
      const otherToken = generateTestToken(otherUser.id);

      const response = await request(app)
        .put(`/v1/comments/${editableCommentId}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .send({ content: 'Hacked content' });

      expect(response.status).toBe(403);
    });
  });

  describe('DELETE /comments/:commentId', () => {
    let deletableCommentId: string;

    beforeAll(async () => {
      const response = await request(app)
        .post(`/v1/flows/${flowId}/comments`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ 
          content: 'To be deleted',
          captchaToken: 'skip'
        });
      deletableCommentId = response.body.comment.id;
    });

    it('should soft delete a comment', async () => {
      const response = await request(app)
        .delete(`/v1/comments/${deletableCommentId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
    });

    it('should reject deletion from non-authors', async () => {
      const otherUser = await createTestUser({
        walletAddress: '0xanother_user'
      });
      const otherToken = generateTestToken(otherUser.id);

      const newComment = await request(app)
        .post(`/v1/flows/${flowId}/comments`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ 
          content: 'Another comment',
          captchaToken: 'skip'
        });

      const response = await request(app)
        .delete(`/v1/comments/${newComment.body.comment.id}`)
        .set('Authorization', `Bearer ${otherToken}`);

      expect(response.status).toBe(403);
    });
  });

  describe('GET /flows/:flowId/comments/count', () => {
    it('should return comment count', async () => {
      const response = await request(app)
        .get(`/v1/flows/${flowId}/comments/count`);

      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
      expect(typeof response.body.count).toBe('number');
      expect(response.body.count).toBeGreaterThanOrEqual(0);
    });
  });
});
