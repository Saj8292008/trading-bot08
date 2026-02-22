import fs from "node:fs";
import path from "node:path";

function loadDotEnv(filePath = ".env") {
  const absolutePath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolutePath)) {
    return;
  }

  const raw = fs.readFileSync(absolutePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equalIndex = trimmed.indexOf("=");
    if (equalIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, equalIndex).trim();
    let value = trimmed.slice(equalIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function asBoolean(value, fallback = false) {
  if (value == null || value === "") {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function asNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asOptionalNumber(value) {
  if (value == null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseTickerIdMap(value) {
  const mapping = {};
  if (!value) {
    return mapping;
  }

  for (const entry of value.split(",")) {
    const [symbolRaw, tickerIdRaw] = entry.split(":");
    const symbol = symbolRaw?.trim().toUpperCase();
    const tickerId = tickerIdRaw?.trim();

    if (symbol && tickerId) {
      mapping[symbol] = tickerId;
    }
  }

  return mapping;
}

loadDotEnv();

const appKey = requiredEnv("WEBULL_APP_KEY");
const appSecret = requiredEnv("WEBULL_APP_SECRET");

const symbols = (process.env.SYMBOLS || "SPY")
  .split(",")
  .map((symbol) => symbol.trim().toUpperCase())
  .filter(Boolean);

if (symbols.length === 0) {
  throw new Error("SYMBOLS must include at least one ticker.");
}

const dryRun = asBoolean(process.env.DRY_RUN, true);
const enableLiveTrading = asBoolean(process.env.ENABLE_LIVE_TRADING, false);

if (!dryRun && !enableLiveTrading) {
  throw new Error(
    "Safety check failed: DRY_RUN is false but ENABLE_LIVE_TRADING is not true."
  );
}

export const config = {
  webull: {
    appKey,
    appSecret,
    baseUrl: process.env.WEBULL_BASE_URL || "https://openapi.webull.com",
    secAccountId: process.env.WEBULL_SEC_ACCOUNT_ID || "",
    regionId: asNumber(process.env.WEBULL_REGION_ID, 6),
    exchangeCode: process.env.WEBULL_EXCHANGE_CODE || "US",
    market: process.env.WEBULL_MARKET || "US",
    tokenExpireSeconds: Math.max(300, Math.floor(asNumber(process.env.WEBULL_TOKEN_EXPIRE_SECONDS, 3600))),
    tickerIdBySymbol: parseTickerIdMap(process.env.WEBULL_TICKER_IDS || "")
  },
  strategy: {
    symbols,
    pollIntervalMs: asNumber(process.env.POLL_INTERVAL_MS, 60_000),
    fastEma: asNumber(process.env.FAST_EMA, 9),
    slowEma: asNumber(process.env.SLOW_EMA, 21),
    maxPositionPct: asNumber(process.env.MAX_POSITION_PCT, 0.2),
    stopTradingEquityFloor: asOptionalNumber(process.env.STOP_TRADING_EQUITY_FLOOR),
    stopTradingDailyLossPct: asOptionalNumber(process.env.STOP_TRADING_DAILY_LOSS_PCT),
    stopTradingDailyProfitPct: asOptionalNumber(process.env.STOP_TRADING_DAILY_PROFIT_PCT),
    heartbeatEveryCycles: Math.max(1, Math.floor(asNumber(process.env.HEARTBEAT_EVERY_CYCLES, 15))),
    dryRun
  },
  notifications: {
    telegram: {
      token: process.env.TELEGRAM_BOT_TOKEN || "",
      chatId: process.env.TELEGRAM_CHAT_ID || ""
    },
    imessage: {
      recipient: process.env.IMESSAGE_RECIPIENT || "",
      service: process.env.IMESSAGE_SERVICE || "iMessage"
    }
  }
};

export const tradingModeLabel = dryRun ? "DRY_RUN" : "LIVE";
