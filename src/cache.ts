/**
 * Simple in-memory cache with TTL
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class Cache<T> {
  private data = new Map<string, CacheEntry<T>>();
  private ttlMs: number;

  constructor(ttlMs = 5 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  get(key: string): T | undefined {
    const entry = this.data.get(key);
    if (!entry) return undefined;

    if (entry.expiresAt < Date.now()) {
      this.data.delete(key);
      return undefined;
    }

    return entry.value;
  }

  set(key: string, value: T, ttlMs?: number): void {
    this.data.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.ttlMs)
    });
  }

  delete(key: string): void {
    this.data.delete(key);
  }

  invalidate(pattern: string): number {
    let count = 0;
    for (const key of this.data.keys()) {
      if (key.includes(pattern)) {
        this.data.delete(key);
        count++;
      }
    }
    return count;
  }

  clear(): void {
    this.data.clear();
  }

  size(): number {
    return this.data.size;
  }
}

export const userCache = new Cache(5 * 60 * 1000); // 5 minutes
export const groupCache = new Cache(10 * 60 * 1000); // 10 minutes
export const memberCache = new Cache(5 * 60 * 1000); // 5 minutes

export function invalidateUserCache(userId: string) {
  userCache.delete(`user:${userId}`);
  groupCache.invalidate(userId);
  memberCache.invalidate(userId);
}

export function invalidateGroupCache(groupId: string) {
  groupCache.delete(`group:${groupId}`);
  memberCache.invalidate(groupId);
}
