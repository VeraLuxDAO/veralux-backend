/**
 * Database Schema Enhancements
 * ============================
 * This file documents necessary database indices for optimal query performance
 * Add these to your Prisma schema or database directly
 */

// PRISMA SCHEMA ADDITIONS
// ======================
// Add these index definitions to prisma/schema.prisma

/*

// User model - frequently queried by wallet address
model User {
  // ... existing fields ...
  
  @@index([walletAddress])
  @@index([createdAt])
  @@index([lastLoginAt])
  @@index([username])  // For user search
}

// Group model - frequent queries for listing/filtering
model Group {
  // ... existing fields ...
  
  @@index([type])  // Filter by room/circle
  @@index([creatorId])  // Find groups created by user
  @@index([createdAt])  // Sort by creation date
}

// Chat model - critical for message queries
model Chat {
  // ... existing fields ...
  
  @@index([groupId, createdAt])  // Find messages in group, sorted by date
  @@index([actorId])  // Find messages by user
  @@index([replyToId])  // Find replies to a message
  @@index([createdAt])  // Sort messages
  @@index([updatedAt])  // Find edited messages
}

// Membership model - frequent joins
model Membership {
  // ... existing fields ...
  
  @@index([memberId])  // Find all groups a user is in
  @@index([groupId])  // Find all members in group
  @@unique([memberId, groupId])  // Prevent duplicate memberships
}

*/

// SQL EQUIVALENT (if adding directly to PostgreSQL)
// ================================================
// Run these SQL commands if not using Prisma migrations:

/*

-- User indices
CREATE INDEX idx_user_wallet_address ON "User"("walletAddress");
CREATE INDEX idx_user_created_at ON "User"("createdAt");
CREATE INDEX idx_user_last_login ON "User"("lastLoginAt");
CREATE INDEX idx_user_username ON "User"("username") WHERE "username" IS NOT NULL;

-- Group indices
CREATE INDEX idx_group_type ON "Group"("type");
CREATE INDEX idx_group_creator_id ON "Group"("creatorId");
CREATE INDEX idx_group_created_at ON "Group"("createdAt");

-- Chat indices (CRITICAL for performance)
CREATE INDEX idx_chat_group_created ON "Chat"("groupId", "createdAt" DESC);
CREATE INDEX idx_chat_actor_id ON "Chat"("actorId");
CREATE INDEX idx_chat_reply_to ON "Chat"("replyToId");
CREATE INDEX idx_chat_created_at ON "Chat"("createdAt");
CREATE INDEX idx_chat_updated_at ON "Chat"("updatedAt") WHERE "updatedAt" IS NOT NULL;

-- Membership indices
CREATE INDEX idx_membership_member_id ON "Membership"("memberId");
CREATE INDEX idx_membership_group_id ON "Membership"("groupId");
CREATE UNIQUE INDEX idx_membership_unique ON "Membership"("memberId", "groupId");

*/

// QUERY OPTIMIZATION PATTERNS
// ============================

// ✅ GOOD: Uses index, returns limited fields
// SELECT id, text, actorId, createdAt 
// FROM Chat 
// WHERE groupId = ? 
// ORDER BY createdAt DESC 
// LIMIT 20 OFFSET 0;

// ❌ BAD: Missing WHERE index, selects all fields
// SELECT * FROM Chat ORDER BY createdAt DESC;

// ✅ GOOD: Uses compound index
// SELECT * FROM Chat 
// WHERE groupId = ? AND createdAt > ? 
// ORDER BY createdAt DESC;

// ✅ GOOD: Count with index
// SELECT COUNT(*) FROM Chat WHERE groupId = ?;

// OPTIMIZATION CHECKLIST
// ======================
// ✅ All searchable/filterable columns are indexed
// ✅ Frequently joined columns are indexed
// ✅ Compound indices exist for common filter+sort combinations
// ✅ Unique constraints prevent duplicates
// ✅ Queries use SELECT specific columns, not SELECT *
// ✅ Pagination uses limit/offset or cursor-based
// ✅ N+1 queries are eliminated with includes/joins
// ✅ Large collections use pagination

export const DATABASE_INDICES_DOCUMENTATION = true;
