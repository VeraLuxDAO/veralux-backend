/**
 * Presence tracking (in-memory)
 */

const ONLINE_THRESHOLD_MS = 60_000;

interface PresenceEntry {
  connections: number;
  lastSeen: number;
}

const presence = new Map<string, PresenceEntry>();

export function setOnline(userId: string) {
  const now = Date.now();
  const entry = presence.get(userId) || { connections: 0, lastSeen: now };
  presence.set(userId, { connections: entry.connections + 1, lastSeen: now });
}

export function setOffline(userId: string) {
  const entry = presence.get(userId);
  if (!entry) return;
  const remaining = Math.max(0, entry.connections - 1);
  const now = Date.now();
  if (remaining === 0) {
    presence.set(userId, { connections: 0, lastSeen: now });
  } else {
    presence.set(userId, { connections: remaining, lastSeen: now });
  }
}

export function touch(userId: string) {
  const entry = presence.get(userId) || { connections: 0, lastSeen: Date.now() };
  presence.set(userId, { ...entry, lastSeen: Date.now() });
}

export function getStatus(userId: string) {
  const entry = presence.get(userId);
  if (!entry) return { status: "offline", lastSeen: null } as const;
  const now = Date.now();
  const online = entry.connections > 0 && now - entry.lastSeen < ONLINE_THRESHOLD_MS;
  return {
    status: online ? "online" : "offline",
    lastSeen: entry.lastSeen
  } as const;
}

export function getPresenceSnapshot(userIds: string[]) {
  return userIds.map((id) => ({ userId: id, ...getStatus(id) }));
}
