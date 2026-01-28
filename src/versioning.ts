/**
 * API Versioning middleware
 * Handles API version routing and deprecation warnings
 */

import { Request, Response, NextFunction } from "express";
import { createLogger } from "./logger.js";

const logger = createLogger("versioning");

export const API_CURRENT_VERSION = "1.0.0";
export const API_DEPRECATED_VERSIONS = {
  "0.9.0": { deprecatedAt: "2025-01-15", sunsetDate: "2025-07-15", reason: "Initial beta release" }
};

/**
 * Middleware to add API version headers
 */
export function versioningMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Add current API version to response headers
  res.setHeader("API-Version", API_CURRENT_VERSION);
  
  // Check if client is using a deprecated version
  const clientVersion = req.headers["api-version"] as string;
  if (clientVersion && API_DEPRECATED_VERSIONS[clientVersion as keyof typeof API_DEPRECATED_VERSIONS]) {
    const deprecation = API_DEPRECATED_VERSIONS[clientVersion as keyof typeof API_DEPRECATED_VERSIONS];
    res.setHeader("Deprecation", "true");
    res.setHeader("Sunset", new Date(deprecation.sunsetDate).toUTCString());
    res.setHeader("Warning", `299 - "API version ${clientVersion} is deprecated. Reason: ${deprecation.reason}. Migrate to ${API_CURRENT_VERSION} before ${deprecation.sunsetDate}"`);
    
    logger.warn("Deprecated API version used", {
      clientVersion,
      currentVersion: API_CURRENT_VERSION,
      sunsetDate: deprecation.sunsetDate
    });
  }
  
  next();
}

/**
 * Helper to check if client accepts a specific version
 */
export function acceptsVersion(req: Request, version: string): boolean {
  const acceptedVersions = req.headers["api-version"] as string;
  if (!acceptedVersions) return true; // Default to current version
  return acceptedVersions.includes(version);
}

/**
 * Helper to get client requested version
 */
export function getRequestedVersion(req: Request): string {
  return (req.headers["api-version"] as string) || API_CURRENT_VERSION;
}

/**
 * Middleware to enforce minimum API version
 */
export function requireMinVersion(minVersion: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const requestedVersion = getRequestedVersion(req);
    
    // Simple version comparison (major.minor.patch)
    const [reqMajor, reqMinor] = requestedVersion.split(".").map(Number);
    const [minMajor, minMinor] = minVersion.split(".").map(Number);
    
    if (reqMajor < minMajor || (reqMajor === minMajor && reqMinor < minMinor)) {
      res.status(400).json({
        error: "API version not supported",
        details: `Minimum required version: ${minVersion}, requested: ${requestedVersion}`,
        currentVersion: API_CURRENT_VERSION
      });
      return;
    }
    
    next();
  };
}
