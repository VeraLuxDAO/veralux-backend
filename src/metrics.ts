/**
 * Performance metrics collection middleware
 */

import { Request, Response, NextFunction } from "express";
import { createLogger } from "./logger.js";

const logger = createLogger("metrics");

export interface MetricsData {
  method: string;
  path: string;
  statusCode: number;
  duration: number;
  timestamp: Date;
}

class MetricsCollector {
  private metrics: MetricsData[] = [];
  private maxMetrics = 10000;

  recordMetric(data: MetricsData): void {
    this.metrics.push(data);

    // Keep only recent metrics to avoid memory overflow
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics);
    }
  }

  getMetrics(limit = 100): MetricsData[] {
    return this.metrics.slice(-limit);
  }

  getStats() {
    if (this.metrics.length === 0) {
      return {
        totalRequests: 0,
        averageResponseTime: 0,
        p50ResponseTime: 0,
        p95ResponseTime: 0,
        p99ResponseTime: 0,
        errorRate: 0
      };
    }

    const durations = this.metrics.map(m => m.duration).sort((a, b) => a - b);
    const errorCount = this.metrics.filter(m => m.statusCode >= 400).length;

    return {
      totalRequests: this.metrics.length,
      averageResponseTime: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
      p50ResponseTime: durations[Math.floor(durations.length * 0.5)],
      p95ResponseTime: durations[Math.floor(durations.length * 0.95)],
      p99ResponseTime: durations[Math.floor(durations.length * 0.99)],
      errorRate: (errorCount / this.metrics.length * 100).toFixed(2) + "%"
    };
  }

  getEndpointStats(method: string, path: string) {
    const matching = this.metrics.filter(m => m.method === method && m.path === path);

    if (matching.length === 0) {
      return null;
    }

    const durations = matching.map(m => m.duration).sort((a, b) => a - b);
    const errorCount = matching.filter(m => m.statusCode >= 400).length;

    return {
      requests: matching.length,
      averageResponseTime: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
      minResponseTime: Math.min(...durations),
      maxResponseTime: Math.max(...durations),
      errorRate: (errorCount / matching.length * 100).toFixed(2) + "%"
    };
  }

  clear(): void {
    this.metrics = [];
  }
}

export const metricsCollector = new MetricsCollector();

/**
 * Middleware to collect performance metrics
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();

  // Intercept response to track status code
  const originalSend = res.send;
  res.send = function(data) {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;

    // Skip static files and health checks from detailed metrics
    if (!req.path.includes("/api-docs") && !req.path.includes("swagger")) {
      metricsCollector.recordMetric({
        method: req.method,
        path: req.path,
        statusCode,
        duration,
        timestamp: new Date()
      });

      // Log slow requests (> 1 second)
      if (duration > 1000) {
        logger.warn("Slow request", {
          method: req.method,
          path: req.path,
          duration,
          statusCode
        });
      }
    }

    return originalSend.call(this, data);
  };

  next();
}
