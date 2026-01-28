const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";

type LogLevel = "debug" | "info" | "warn" | "error";

const levels: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel = levels[LOG_LEVEL as LogLevel] ?? 1;

function formatMessage(level: string, module: string, message: string, data?: unknown): string {
  const timestamp = new Date().toISOString();
  const dataStr = data !== undefined ? ` ${JSON.stringify(data)}` : "";
  return `[${timestamp}] [${level.toUpperCase()}] [${module}] ${message}${dataStr}`;
}

function shouldLog(level: LogLevel): boolean {
  return levels[level] >= currentLevel;
}

export function createLogger(module: string) {
  return {
    debug: (message: string, data?: unknown) => {
      if (shouldLog("debug")) {
        console.debug(formatMessage("debug", module, message, data));
      }
    },
    info: (message: string, data?: unknown) => {
      if (shouldLog("info")) {
        console.info(formatMessage("info", module, message, data));
      }
    },
    warn: (message: string, data?: unknown) => {
      if (shouldLog("warn")) {
        console.warn(formatMessage("warn", module, message, data));
      }
    },
    error: (message: string, error?: unknown) => {
      if (shouldLog("error")) {
        const errorData = error instanceof Error 
          ? { message: error.message, stack: error.stack }
          : error;
        console.error(formatMessage("error", module, message, errorData));
      }
    },
  };
}
