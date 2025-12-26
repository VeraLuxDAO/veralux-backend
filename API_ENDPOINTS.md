# YNX Backend API Endpoints

Complete list of all available API endpoints in the YNX-backend.

---

## Authentication (`/auth`)

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/auth` | Login with wallet address | No |
| POST | `/auth/refresh` | Refresh access token | No |
| POST | `/auth/logout` | Logout and clear refresh token | Yes |
| GET | `/auth/profile` | Get current user profile | Yes |

---

## User Profile

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| PATCH | `/auth/me` | Update profile (username, displayName, bio) | Yes |
| POST | `/auth/me/avatar` | Upload user avatar image | Yes |
| GET | `/users/:walletAddress` | Get public user profile by wallet address | No |

---

## Groups (`/groups`)

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/groups` | List all groups (rooms + user's circles) | Optional |
| GET | `/groups/:groupId` | Get group details by ID | No |
| POST | `/groups/rooms` | Create new public room | Yes |
| POST | `/groups/circles` | Create new private circle with invite code | Yes |
| POST | `/groups/join` | Join a group (room or circle) | Yes |
| GET | `/groups/:groupId/members` | Get group members (creator only) | Yes |

---

## Circles (`/circles`)

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/circles/:groupId` | Get circle details (members only) | Yes |
| GET | `/circles/:groupId/invite-code` | Get circle invite code (creator only) | Yes |
| POST | `/circles/:groupId/regenerate-invite-code` | Regenerate invite code (creator only) | Yes |
| DELETE | `/circles/:groupId/members/:memberId` | Remove member from circle (creator only) | Yes |
| POST | `/circles/:groupId/leave` | Leave circle | Yes |

---

### **Chat** (`/chat`)

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/chat` | Send message to a group (supports reply with `replyToId`) | Yes |
| GET | `/chat/:groupId` | Get chat history for a group (includes reply data) | Yes |
| PATCH | `/chat/:messageId` | Edit own message | Yes |
| DELETE | `/chat/:messageId` | Delete own message | Yes |
| GET | `/chat/events/subscribe` | Subscribe to SSE for real-time updates | Yes |
| POST | `/chat/events/subscribe-group` | Subscribe to specific group's messages | Yes |
| POST | `/chat/events/unsubscribe-group` | Unsubscribe from group's messages | Yes |

---

## Flows (Posts)

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/flows` | Create new flow (text or image post) | No |
| GET | `/flows` | List flows with pagination | No |

---

## Social Actions

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/glows` | Glow (like) a flow | Yes |
| POST | `/promotes` | Promote a flow | Yes |

---

## Real-Time Events

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/events` | SSE event stream (legacy) | Optional |

---

## Media

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/image/:patchId` | Fetch image by Walrus patch ID | No |

---

## Blockchain

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/verify` | Verify blockchain action by patch ID | No |

---

## System

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/health` | API health check | No |
| GET | `/api-docs` | Swagger UI documentation | No |

---

## Total Endpoints: 34

### Key Features:
- 🔐 **JWT Authentication** - Wallet-based auth with access/refresh tokens
- 💬 **Real-time Chat** - SSE (Server-Sent Events) for live updates
- 🔒 **Private Circles** - Invite-code protected groups
- 📝 **Content Posts** - Text and image flows
- ❤️ **Social Interactions** - Glows (likes) and promotes
- ⛓️ **Blockchain Integration** - Sui network for on-chain logging
- 🗄️ **Walrus Storage** - Content-addressed decentralized storage

### Request/Response Format:
- All endpoints accept and return JSON (except image uploads/downloads)
- Authentication: `Authorization: Bearer <access_token>` header
- Standard response format: `{ ok: true/false, ... }`
