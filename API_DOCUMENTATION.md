# YNX Backend API Documentation

**Version:** 1.0.0  
**Base URL:** `http://localhost:4000/v1`  
**Last Updated:** January 2026

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Authentication](#authentication)
3. [Response Format](#response-format)
4. [Error Handling](#error-handling)
5. [Rate Limiting](#rate-limiting)
6. [API Endpoints](#api-endpoints)
   - [Authentication](#1-authentication-endpoints)
   - [Users](#2-user-endpoints)
   - [Groups](#3-group-endpoints)
   - [Circles](#4-circle-endpoints)
   - [Chat](#5-chat-endpoints)
   - [Reactions](#6-reaction-endpoints)
   - [Moderation](#7-moderation-endpoints)
   - [Audit](#8-audit-endpoints)
   - [Real-Time Events](#9-real-time-events-sse)
7. [Data Models](#data-models)
8. [WebSocket/SSE Events](#websocketsse-events)

---

## Getting Started

### Base URL
All API endpoints are prefixed with `/v1`:
```
http://localhost:4000/v1
```

### Headers
Every request should include:
```http
Content-Type: application/json
```

Authenticated requests must include:
```http
Authorization: Bearer <access_token>
```

### Response Headers
All responses include:
```http
API-Version: 1.0.0
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 999
X-RateLimit-Reset: 1704067200
```

---

## Authentication

YNX uses **wallet-based authentication** with the Sui blockchain. The flow is:

1. **Request Nonce** → `GET /v1/auth/nonce?walletAddress=0x...`
2. **Sign Message** → Client signs the returned message with their wallet
3. **Submit Signature** → `POST /v1/auth` with wallet address and signature
4. **Receive Tokens** → Get `accessToken` (1 hour) and `refreshToken` (30 days)
5. **Use Access Token** → Include in `Authorization: Bearer <token>` header

### Token Refresh
When access token expires, use `POST /v1/auth/refresh` with the refresh token to get new tokens.

---

## Response Format

### Success Response
```json
{
  "ok": true,
  "data": { ... }
}
```

### Error Response
```json
{
  "ok": false,
  "error": "Error message",
  "code": "ERROR_CODE",
  "details": { ... }
}
```

---

## Error Handling

| Status Code | Meaning | Common Causes |
|-------------|---------|---------------|
| `200` | Success | Request completed successfully |
| `201` | Created | Resource created successfully |
| `400` | Bad Request | Invalid input, validation error |
| `401` | Unauthorized | Missing or invalid token |
| `403` | Forbidden | Insufficient permissions |
| `404` | Not Found | Resource doesn't exist |
| `409` | Conflict | Duplicate resource |
| `429` | Too Many Requests | Rate limit exceeded |
| `500` | Server Error | Internal error |

---

## Rate Limiting

| Endpoint Type | Limit | Window |
|---------------|-------|--------|
| Global | 1000 requests | 1 hour |
| Auth/Nonce | 5 requests | 1 minute |
| Auth/Login | 10 requests | 1 minute |
| Login Failures | 5 attempts | 15 min lockout |

---

## API Endpoints

---

## 1. Authentication Endpoints

### GET /v1/auth/nonce

Request a nonce to sign for wallet authentication.

**Authentication:** Not required

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `walletAddress` | string | Yes | Sui wallet address (0x + 64 hex chars) |

**Example Request:**
```bash
curl "http://localhost:4000/v1/auth/nonce?walletAddress=0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
```

**Success Response (200):**
```json
{
  "ok": true,
  "walletAddress": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  "nonce": "abc123xyz",
  "message": "Sign this message to authenticate with YNX:\n\nNonce: abc123xyz\nTimestamp: 2026-01-09T12:00:00Z",
  "expiresAt": "2026-01-09T12:05:00.000Z"
}
```

**Error Response (400):**
```json
{
  "ok": false,
  "error": "Invalid Sui wallet address format",
  "code": "VALIDATION_ERROR"
}
```

---

### POST /v1/auth

Authenticate with wallet signature.

**Authentication:** Not required

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `walletAddress` | string | Yes | Sui wallet address |
| `signature` | string | Yes | Ed25519 signature of the nonce message |

**Example Request:**
```bash
curl -X POST "http://localhost:4000/v1/auth" \
  -H "Content-Type: application/json" \
  -d '{
    "walletAddress": "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    "signature": "base64_encoded_signature_here"
  }'
```

**Success Response (200):**
```json
{
  "ok": true,
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 3600,
  "user": {
    "id": "clx1abc123",
    "walletAddress": "0x1234...abcdef",
    "username": "alice",
    "displayName": "Alice",
    "avatarPatchId": null,
    "bio": null,
    "lastLoginAt": "2026-01-09T12:00:00.000Z",
    "createdAt": "2026-01-01T00:00:00.000Z"
  }
}
```

**Error Response (401):**
```json
{
  "ok": false,
  "error": "Invalid signature",
  "code": "INVALID_SIGNATURE"
}
```

---

### POST /v1/auth/refresh

Refresh access token using refresh token.

**Authentication:** Not required

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `refreshToken` | string | Yes | Valid refresh token |

**Example Request:**
```bash
curl -X POST "http://localhost:4000/v1/auth/refresh" \
  -H "Content-Type: application/json" \
  -d '{
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }'
```

**Success Response (200):**
```json
{
  "ok": true,
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 3600
}
```

---

### POST /v1/auth/logout

Logout and invalidate refresh token.

**Authentication:** Required

**Example Request:**
```bash
curl -X POST "http://localhost:4000/v1/auth/logout" \
  -H "Authorization: Bearer <access_token>"
```

**Success Response (200):**
```json
{
  "ok": true,
  "message": "Logged out successfully"
}
```

---

### GET /v1/auth/profile

Get current authenticated user's profile.

**Authentication:** Required

**Example Request:**
```bash
curl "http://localhost:4000/v1/auth/profile" \
  -H "Authorization: Bearer <access_token>"
```

**Success Response (200):**
```json
{
  "ok": true,
  "user": {
    "id": "clx1abc123",
    "walletAddress": "0x1234...abcdef",
    "username": "alice",
    "displayName": "Alice",
    "avatarPatchId": "patch_abc123",
    "bio": "Hello, I'm Alice!",
    "lastLoginAt": "2026-01-09T12:00:00.000Z",
    "createdAt": "2026-01-01T00:00:00.000Z"
  }
}
```

---

## 2. User Endpoints

### GET /v1/users/search

Search for users by username, display name, or wallet address.

**Authentication:** Required

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search query (min 2 characters) |
| `limit` | number | No | Results per page (default: 20, max: 50) |

**Example Request:**
```bash
curl "http://localhost:4000/v1/users/search?query=alice&limit=10" \
  -H "Authorization: Bearer <access_token>"
```

**Success Response (200):**
```json
{
  "ok": true,
  "users": [
    {
      "id": "clx1abc123",
      "walletAddress": "0x1234...abcdef",
      "username": "alice",
      "displayName": "Alice",
      "avatarPatchId": "patch_abc123",
      "status": "online"
    }
  ]
}
```

---

### POST /v1/users/:userId/block

Block a user.

**Authentication:** Required

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `userId` | string | ID of user to block |

**Example Request:**
```bash
curl -X POST "http://localhost:4000/v1/users/clx1xyz789/block" \
  -H "Authorization: Bearer <access_token>"
```

**Success Response (200):**
```json
{
  "ok": true,
  "blockedId": "clx1xyz789"
}
```

---

### DELETE /v1/users/:userId/block

Unblock a user.

**Authentication:** Required

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `userId` | string | ID of user to unblock |

**Example Request:**
```bash
curl -X DELETE "http://localhost:4000/v1/users/clx1xyz789/block" \
  -H "Authorization: Bearer <access_token>"
```

**Success Response (200):**
```json
{
  "ok": true,
  "unblockedId": "clx1xyz789"
}
```

---

### GET /v1/users/blocked

Get list of blocked users.

**Authentication:** Required

**Example Request:**
```bash
curl "http://localhost:4000/v1/users/blocked" \
  -H "Authorization: Bearer <access_token>"
```

**Success Response (200):**
```json
{
  "ok": true,
  "blocked": [
    {
      "id": "clx1xyz789",
      "walletAddress": "0x9876...fedcba",
      "username": "bob",
      "displayName": "Bob",
      "avatarPatchId": null,
      "blockedAt": "2026-01-09T10:00:00.000Z"
    }
  ]
}
```

---

### GET /v1/users/presence

Get user's online status.

**Authentication:** Required

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `userId` | string | Yes | User ID to check |

**Example Request:**
```bash
curl "http://localhost:4000/v1/users/presence?userId=clx1abc123" \
  -H "Authorization: Bearer <access_token>"
```

**Success Response (200):**
```json
{
  "ok": true,
  "userId": "clx1abc123",
  "status": "online",
  "lastSeen": "2026-01-09T12:00:00.000Z"
}
```

---

## 3. Group Endpoints

### GET /v1/groups

List all available groups with pagination.

**Authentication:** Optional (shows more groups when authenticated)

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `limit` | number | No | Results per page (default: 20, max: 50) |
| `offset` | number | No | Skip N results (default: 0) |

**Example Request:**
```bash
curl "http://localhost:4000/v1/groups?limit=10&offset=0"
```

**Success Response (200):**
```json
{
  "ok": true,
  "groups": [
    {
      "id": "clx1grp001",
      "name": "General Chat",
      "description": "Welcome to the general chat room",
      "type": "room",
      "creatorId": "clx1abc123",
      "createdAt": "2026-01-01T00:00:00.000Z",
      "membersCount": 42,
      "hasInviteCode": false
    }
  ],
  "pagination": {
    "offset": 0,
    "limit": 10,
    "total": 25,
    "hasMore": true
  }
}
```

---

### GET /v1/groups/:groupId

Get details of a specific group.

**Authentication:** Not required

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `groupId` | string | Group ID |

**Example Request:**
```bash
curl "http://localhost:4000/v1/groups/clx1grp001"
```

**Success Response (200):**
```json
{
  "ok": true,
  "group": {
    "id": "clx1grp001",
    "name": "General Chat",
    "description": "Welcome to the general chat room",
    "type": "room",
    "creatorId": "clx1abc123",
    "createdAt": "2026-01-01T00:00:00.000Z",
    "membersCount": 42,
    "hasInviteCode": false
  }
}
```

---

### POST /v1/groups/rooms

Create a new public room.

**Authentication:** Required

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Room name (1-80 chars) |
| `description` | string | No | Room description |

**Example Request:**
```bash
curl -X POST "http://localhost:4000/v1/groups/rooms" \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Gaming Lounge",
    "description": "A place to discuss games"
  }'
```

**Success Response (201):**
```json
{
  "ok": true,
  "group": {
    "id": "clx1grp002",
    "name": "Gaming Lounge",
    "description": "A place to discuss games",
    "type": "room",
    "creatorId": "clx1abc123",
    "createdAt": "2026-01-09T12:00:00.000Z",
    "membersCount": 1,
    "hasInviteCode": false
  }
}
```

---

### POST /v1/groups/circles

Create a new private circle (invite-only).

**Authentication:** Required

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Circle name (1-80 chars) |
| `description` | string | No | Circle description |

**Example Request:**
```bash
curl -X POST "http://localhost:4000/v1/groups/circles" \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Close Friends",
    "description": "Private circle for close friends"
  }'
```

**Success Response (201):**
```json
{
  "ok": true,
  "group": {
    "id": "clx1cir001",
    "name": "Close Friends",
    "description": "Private circle for close friends",
    "type": "circle",
    "creatorId": "clx1abc123",
    "createdAt": "2026-01-09T12:00:00.000Z",
    "membersCount": 1,
    "hasInviteCode": true
  },
  "inviteCode": "ABC123XYZ"
}
```

---

### POST /v1/groups/join

Join a group (room or circle).

**Authentication:** Required

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `groupId` | string | Yes | Group ID to join |
| `inviteCode` | string | No | Required for circles |

**Example Request (Room):**
```bash
curl -X POST "http://localhost:4000/v1/groups/join" \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "groupId": "clx1grp001"
  }'
```

**Example Request (Circle with invite code):**
```bash
curl -X POST "http://localhost:4000/v1/groups/join" \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "groupId": "clx1cir001",
    "inviteCode": "ABC123XYZ"
  }'
```

**Success Response (200):**
```json
{
  "ok": true,
  "message": "Joined Gaming Lounge",
  "groupId": "clx1grp002"
}
```

---

### GET /v1/groups/:groupId/members

Get group members list.

**Authentication:** Required (Admin or Creator only)

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `groupId` | string | Group ID |

**Example Request:**
```bash
curl "http://localhost:4000/v1/groups/clx1grp001/members" \
  -H "Authorization: Bearer <access_token>"
```

**Success Response (200):**
```json
{
  "ok": true,
  "members": [
    {
      "id": "clx1mem001",
      "memberId": "clx1abc123",
      "role": "CREATOR",
      "createdAt": "2026-01-01T00:00:00.000Z",
      "member": {
        "id": "clx1abc123",
        "walletAddress": "0x1234...abcdef",
        "username": "alice",
        "displayName": "Alice",
        "avatarPatchId": "patch_abc123"
      }
    }
  ]
}
```

---

## 4. Circle Endpoints

### GET /v1/circles/:groupId

Get circle details with invite code (creator only sees invite code).

**Authentication:** Required

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `groupId` | string | Circle ID |

**Example Request:**
```bash
curl "http://localhost:4000/v1/circles/clx1cir001" \
  -H "Authorization: Bearer <access_token>"
```

**Success Response (200):**
```json
{
  "ok": true,
  "circle": {
    "id": "clx1cir001",
    "name": "Close Friends",
    "description": "Private circle for close friends",
    "type": "circle",
    "creatorId": "clx1abc123",
    "membersCount": 5,
    "createdAt": "2026-01-09T12:00:00.000Z"
  },
  "inviteCode": "ABC123XYZ"
}
```

---

### GET /v1/circles/:groupId/invite-code

Get circle's invite code (creator only).

**Authentication:** Required (Creator only)

**Success Response (200):**
```json
{
  "ok": true,
  "groupId": "clx1cir001",
  "inviteCode": "ABC123XYZ"
}
```

---

### POST /v1/circles/:groupId/regenerate-invite-code

Generate a new invite code (invalidates old one).

**Authentication:** Required (Creator only)

**Success Response (200):**
```json
{
  "ok": true,
  "groupId": "clx1cir001",
  "inviteCode": "NEW456CODE"
}
```

---

### DELETE /v1/circles/:groupId/members/:memberId

Remove a member from circle.

**Authentication:** Required (Creator only)

**Success Response (200):**
```json
{
  "ok": true,
  "message": "Member removed"
}
```

---

## 5. Chat Endpoints

### POST /v1/chat

Send a message to a group.

**Authentication:** Required

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `groupId` | string | Yes | Group to send message to |
| `text` | string | Yes | Message content (1-2000 chars) |
| `replyToId` | string | No | ID of message to reply to |

**Example Request:**
```bash
curl -X POST "http://localhost:4000/v1/chat" \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "groupId": "clx1grp001",
    "text": "Hello everyone! 👋"
  }'
```

**Example Request (Reply):**
```bash
curl -X POST "http://localhost:4000/v1/chat" \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "groupId": "clx1grp001",
    "text": "I agree with you!",
    "replyToId": "clx1msg001"
  }'
```

**Success Response (200):**
```json
{
  "ok": true,
  "message": {
    "id": "clx1msg002",
    "text": "Hello everyone! 👋",
    "actorId": "clx1abc123",
    "groupId": "clx1grp001",
    "actor": {
      "id": "clx1abc123",
      "walletAddress": "0x1234...abcdef",
      "username": "alice",
      "displayName": "Alice",
      "avatarPatchId": "patch_abc123"
    },
    "replyToId": null,
    "replyTo": null,
    "createdAt": "2026-01-09T12:00:00.000Z"
  }
}
```

---

### GET /v1/chat/:groupId

Get messages from a group.

**Authentication:** Required

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `groupId` | string | Group ID |

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `limit` | number | No | Messages per page (default: 20, max: 100) |
| `offset` | number | No | Skip N messages (default: 0) |

**Example Request:**
```bash
curl "http://localhost:4000/v1/chat/clx1grp001?limit=50&offset=0" \
  -H "Authorization: Bearer <access_token>"
```

**Success Response (200):**
```json
{
  "ok": true,
  "groupId": "clx1grp001",
  "messages": [
    {
      "id": "clx1msg001",
      "text": "Welcome to the group!",
      "actorId": "clx1abc123",
      "groupId": "clx1grp001",
      "actor": {
        "id": "clx1abc123",
        "walletAddress": "0x1234...abcdef",
        "username": "alice",
        "displayName": "Alice",
        "avatarPatchId": "patch_abc123"
      },
      "replyToId": null,
      "replyTo": null,
      "createdAt": "2026-01-09T12:00:00.000Z",
      "updatedAt": null
    }
  ],
  "pagination": {
    "offset": 0,
    "limit": 50,
    "total": 150,
    "hasMore": true
  }
}
```

---

### PATCH /v1/chat/:messageId

Edit a message (author only).

**Authentication:** Required

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `messageId` | string | Message ID |

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `text` | string | Yes | New message content |

**Example Request:**
```bash
curl -X PATCH "http://localhost:4000/v1/chat/clx1msg001" \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Updated message content"
  }'
```

**Success Response (200):**
```json
{
  "ok": true,
  "message": {
    "id": "clx1msg001",
    "text": "Updated message content",
    "actorId": "clx1abc123",
    "groupId": "clx1grp001",
    "actor": { ... },
    "createdAt": "2026-01-09T12:00:00.000Z",
    "updatedAt": "2026-01-09T12:05:00.000Z"
  }
}
```

---

### DELETE /v1/chat/:messageId

Delete a message (author only).

**Authentication:** Required

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `messageId` | string | Message ID |

**Example Request:**
```bash
curl -X DELETE "http://localhost:4000/v1/chat/clx1msg001" \
  -H "Authorization: Bearer <access_token>"
```

**Success Response (200):**
```json
{
  "ok": true,
  "message": "Message deleted successfully",
  "messageId": "clx1msg001"
}
```

---

## 6. Reaction Endpoints

### POST /v1/chat/:messageId/reaction

Add or toggle a reaction on a message.

**Authentication:** Required

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `messageId` | string | Message ID |

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `emoji` | string | Yes | Emoji character (see allowed list) |

**Allowed Emojis:**
`👍` `❤️` `😂` `😮` `😢` `🔥` `👎` `🎉` `😍` `🤔` `😴` `🤗` `👏` `🙏` `💯` `✨`

**Example Request:**
```bash
curl -X POST "http://localhost:4000/v1/chat/clx1msg001/reaction" \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "emoji": "👍"
  }'
```

**Success Response - Added (200):**
```json
{
  "action": "added",
  "emoji": "👍",
  "userId": "clx1abc123",
  "messageId": "clx1msg001",
  "createdAt": "2026-01-09T12:00:00.000Z"
}
```

**Success Response - Removed (toggle) (200):**
```json
{
  "action": "removed",
  "emoji": "👍"
}
```

---

### GET /v1/chat/:messageId/reactions

Get all reactions on a message.

**Authentication:** Optional

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `messageId` | string | Message ID |

**Example Request:**
```bash
curl "http://localhost:4000/v1/chat/clx1msg001/reactions"
```

**Success Response (200):**
```json
{
  "reactions": [
    {
      "emoji": "👍",
      "count": 5,
      "reacted": true
    },
    {
      "emoji": "❤️",
      "count": 3,
      "reacted": false
    }
  ]
}
```

---

### DELETE /v1/chat/:messageId/reaction/:emoji

Remove a specific reaction.

**Authentication:** Required

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `messageId` | string | Message ID |
| `emoji` | string | Emoji to remove |

**Example Request:**
```bash
curl -X DELETE "http://localhost:4000/v1/chat/clx1msg001/reaction/👍" \
  -H "Authorization: Bearer <access_token>"
```

**Success Response (200):**
```json
{
  "success": true
}
```

---

## 7. Moderation Endpoints

### POST /v1/groups/:groupId/members/:memberId/kick

Kick a member from group.

**Authentication:** Required (Admin, Moderator, or Creator)

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `groupId` | string | Group ID |
| `memberId` | string | Member's user ID |

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `reason` | string | No | Reason for kick |

**Example Request:**
```bash
curl -X POST "http://localhost:4000/v1/groups/clx1grp001/members/clx1xyz789/kick" \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Spamming"
  }'
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Member kicked"
}
```

---

### POST /v1/groups/:groupId/members/:memberId/ban

Ban a member from group (permanent until unbanned).

**Authentication:** Required (Creator only)

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `groupId` | string | Group ID |
| `memberId` | string | Member's user ID |

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `reason` | string | No | Reason for ban |

**Example Request:**
```bash
curl -X POST "http://localhost:4000/v1/groups/clx1grp001/members/clx1xyz789/ban" \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Repeated violations"
  }'
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Member banned",
  "ban": {
    "id": "clx1ban001",
    "groupId": "clx1grp001",
    "bannedUserId": "clx1xyz789",
    "bannedBy": "clx1abc123",
    "reason": "Repeated violations",
    "createdAt": "2026-01-09T12:00:00.000Z"
  }
}
```

---

### DELETE /v1/groups/:groupId/members/:memberId/ban

Unban a member.

**Authentication:** Required (Creator only)

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `groupId` | string | Group ID |
| `memberId` | string | Member's user ID |

**Success Response (200):**
```json
{
  "success": true,
  "message": "Member unbanned"
}
```

---

### GET /v1/groups/:groupId/bans

List all banned members.

**Authentication:** Required (Creator only)

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `groupId` | string | Group ID |

**Success Response (200):**
```json
{
  "bans": [
    {
      "id": "clx1ban001",
      "bannedUserId": "clx1xyz789",
      "reason": "Repeated violations",
      "createdAt": "2026-01-09T12:00:00.000Z"
    }
  ]
}
```

---

### DELETE /v1/chat/:messageId/moderate

Delete a message as moderator (creates audit log).

**Authentication:** Required (Admin, Moderator, or Creator)

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `messageId` | string | Message ID |

**Request Body:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `reason` | string | No | Reason for deletion |

**Success Response (200):**
```json
{
  "success": true,
  "message": "Message deleted"
}
```

---

## 8. Audit Endpoints

### GET /v1/audit/logs

Get audit logs for a group.

**Authentication:** Required (Admin or Creator)

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `groupId` | string | Yes | Group ID |
| `limit` | number | No | Results per page (default: 50, max: 100) |
| `offset` | number | No | Skip N results (default: 0) |

**Example Request:**
```bash
curl "http://localhost:4000/v1/audit/logs?groupId=clx1grp001&limit=20" \
  -H "Authorization: Bearer <access_token>"
```

**Success Response (200):**
```json
{
  "logs": [
    {
      "id": "clx1aud001",
      "action": "MEMBER_KICK",
      "actorId": "clx1abc123",
      "targetId": "clx1xyz789",
      "groupId": "clx1grp001",
      "details": "{\"reason\":\"Spamming\"}",
      "timestamp": "2026-01-09T12:00:00.000Z"
    }
  ]
}
```

**Audit Action Types:**
| Action | Description |
|--------|-------------|
| `USER_JOIN` | User joined group |
| `MESSAGE_DELETE` | Message deleted |
| `MESSAGE_EDIT` | Message edited |
| `MEMBER_KICK` | Member kicked |
| `MEMBER_BAN` | Member banned |
| `ROLE_CHANGE` | Role updated |
| `MODERATION` | Moderation action |

---

### GET /v1/audit/user/:userId

Get audit logs for actions by a specific user.

**Authentication:** Required (Admin or Creator)

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `userId` | string | User ID |

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `groupId` | string | Yes | Group ID |
| `limit` | number | No | Results per page (default: 50) |
| `offset` | number | No | Skip N results (default: 0) |

**Success Response (200):**
```json
{
  "logs": [
    {
      "id": "clx1aud001",
      "action": "MESSAGE_DELETE",
      "actorId": "clx1xyz789",
      "targetId": "clx1msg001",
      "groupId": "clx1grp001",
      "timestamp": "2026-01-09T12:00:00.000Z"
    }
  ]
}
```

---

## 9. Real-Time Events (SSE)

### GET /v1/events

Connect to real-time event stream.

**Authentication:** Optional (provides personalized events when authenticated)

**Headers:**
```http
Accept: text/event-stream
```

**Example (JavaScript):**
```javascript
const eventSource = new EventSource('http://localhost:4000/v1/events', {
  headers: { 'Authorization': 'Bearer <access_token>' }
});

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Event received:', data);
};

eventSource.addEventListener('message', (e) => {
  const message = JSON.parse(e.data);
  console.log('New message:', message);
});

eventSource.addEventListener('message-edited', (e) => {
  const message = JSON.parse(e.data);
  console.log('Message edited:', message);
});

eventSource.addEventListener('message-deleted', (e) => {
  const data = JSON.parse(e.data);
  console.log('Message deleted:', data.messageId);
});

eventSource.addEventListener('presence', (e) => {
  const presence = JSON.parse(e.data);
  console.log('Presence update:', presence);
});

eventSource.onerror = (error) => {
  console.error('SSE error:', error);
  // Reconnect after 5 seconds
  setTimeout(() => {
    // Reconnect logic
  }, 5000);
};
```

**Event Types:**

### `message`
New message in a group.
```json
{
  "type": "message",
  "groupId": "clx1grp001",
  "message": {
    "id": "clx1msg001",
    "text": "Hello!",
    "actorId": "clx1abc123",
    "groupId": "clx1grp001",
    "actor": { ... },
    "createdAt": "2026-01-09T12:00:00.000Z"
  }
}
```

### `message-edited`
Message was edited.
```json
{
  "type": "message-edited",
  "groupId": "clx1grp001",
  "message": {
    "id": "clx1msg001",
    "text": "Updated text",
    "updatedAt": "2026-01-09T12:05:00.000Z"
  }
}
```

### `message-deleted`
Message was deleted.
```json
{
  "type": "message-deleted",
  "groupId": "clx1grp001",
  "messageId": "clx1msg001",
  "deletedAt": "2026-01-09T12:10:00.000Z"
}
```

### `presence`
User online/offline status change.
```json
{
  "type": "presence",
  "userId": "clx1abc123",
  "status": "online",
  "ts": 1704801600000
}
```

### `ping`
Heartbeat (every 15 seconds).
```json
{}
```

---

## Data Models

### User
| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (CUID) |
| `walletAddress` | string | Sui wallet address |
| `username` | string | Unique username |
| `displayName` | string | Display name |
| `avatarPatchId` | string | Walrus patch ID for avatar |
| `bio` | string | User bio (max 500 chars) |
| `lastLoginAt` | string | Last login timestamp (ISO 8601) |
| `createdAt` | string | Account creation timestamp |

### Group
| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier |
| `name` | string | Group name (1-80 chars) |
| `description` | string | Group description |
| `type` | string | `room` (public) or `circle` (private) |
| `creatorId` | string | Creator's user ID |
| `membersCount` | number | Number of members |
| `hasInviteCode` | boolean | Whether group has invite code |
| `createdAt` | string | Creation timestamp |

### Message
| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier |
| `text` | string | Message content (1-2000 chars) |
| `actorId` | string | Author's user ID |
| `groupId` | string | Group ID |
| `actor` | User | Author details |
| `replyToId` | string | ID of replied message |
| `replyTo` | Message | Replied message details |
| `createdAt` | string | Creation timestamp |
| `updatedAt` | string | Edit timestamp |

### Membership Roles
| Role | Permissions |
|------|------------|
| `CREATOR` | Full access, can delete group, manage all |
| `ADMIN` | Can kick/ban, manage roles, moderate |
| `MODERATOR` | Can kick, delete messages |
| `MEMBER` | Can send messages, react |

---

## Quick Start Example

### 1. Authenticate
```bash
# Get nonce
NONCE_RESPONSE=$(curl -s "http://localhost:4000/v1/auth/nonce?walletAddress=0x...")

# Sign the message with your wallet (client-side)

# Login
TOKEN_RESPONSE=$(curl -s -X POST "http://localhost:4000/v1/auth" \
  -H "Content-Type: application/json" \
  -d '{"walletAddress": "0x...", "signature": "..."}')

ACCESS_TOKEN=$(echo $TOKEN_RESPONSE | jq -r '.accessToken')
```

### 2. Join a Room
```bash
curl -X POST "http://localhost:4000/v1/groups/join" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"groupId": "clx1grp001"}'
```

### 3. Send a Message
```bash
curl -X POST "http://localhost:4000/v1/chat" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"groupId": "clx1grp001", "text": "Hello from the API!"}'
```

### 4. Listen for Real-Time Updates
```javascript
const eventSource = new EventSource('http://localhost:4000/v1/events');
eventSource.onmessage = (e) => console.log(JSON.parse(e.data));
```

---

## SDK Examples

### JavaScript/TypeScript
```typescript
class YNXClient {
  private baseUrl: string;
  private accessToken: string | null = null;

  constructor(baseUrl = 'http://localhost:4000/v1') {
    this.baseUrl = baseUrl;
  }

  async login(walletAddress: string, signature: string) {
    const res = await fetch(`${this.baseUrl}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress, signature })
    });
    const data = await res.json();
    this.accessToken = data.accessToken;
    return data;
  }

  async sendMessage(groupId: string, text: string) {
    return fetch(`${this.baseUrl}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.accessToken}`
      },
      body: JSON.stringify({ groupId, text })
    }).then(r => r.json());
  }

  async getMessages(groupId: string, limit = 50) {
    return fetch(`${this.baseUrl}/chat/${groupId}?limit=${limit}`, {
      headers: { 'Authorization': `Bearer ${this.accessToken}` }
    }).then(r => r.json());
  }

  subscribeToEvents(onMessage: (data: any) => void) {
    const es = new EventSource(`${this.baseUrl}/events`);
    es.onmessage = (e) => onMessage(JSON.parse(e.data));
    return es;
  }
}
```

### Python
```python
import requests

class YNXClient:
    def __init__(self, base_url='http://localhost:4000/v1'):
        self.base_url = base_url
        self.access_token = None

    def login(self, wallet_address: str, signature: str):
        res = requests.post(f'{self.base_url}/auth', json={
            'walletAddress': wallet_address,
            'signature': signature
        })
        data = res.json()
        self.access_token = data['accessToken']
        return data

    def send_message(self, group_id: str, text: str):
        return requests.post(
            f'{self.base_url}/chat',
            headers={'Authorization': f'Bearer {self.access_token}'},
            json={'groupId': group_id, 'text': text}
        ).json()

    def get_messages(self, group_id: str, limit=50):
        return requests.get(
            f'{self.base_url}/chat/{group_id}?limit={limit}',
            headers={'Authorization': f'Bearer {self.access_token}'}
        ).json()
```

---

## Support

- **API Version:** 1.0.0
- **Last Updated:** January 2026
- **Issues:** Report on GitHub
- **Documentation:** This file

---

**© 2026 YNX Backend**
