import crypto from "node:crypto";

const JSON_HEADERS = {
  "Content-Type": "application/json"
};

function asSignatureValue(value) {
  if (typeof value === "boolean") {
    return value ? "True" : "False";
  }
  return String(value);
}

function collectSignaturePairs(value, prefix = "", result = []) {
  if (value == null) {
    return result;
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      collectSignaturePairs(value[index], `${prefix}[${index}]`, result);
    }
    return result;
  }

  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    for (const key of keys) {
      const nestedValue = value[key];
      if (nestedValue == null) {
        continue;
      }

      const nestedPrefix = prefix ? `${prefix}[${key}]` : key;
      collectSignaturePairs(nestedValue, nestedPrefix, result);
    }
    return result;
  }

  result.push(`${prefix}=${asSignatureValue(value)}`);
  return result;
}

function formatBodyForSignature(payload) {
  return collectSignaturePairs(payload).join("&");
}

function toSha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function firstFiniteNumber(...candidates) {
  for (const candidate of candidates) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return NaN;
}

function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === "object") {
    for (const candidate of Object.values(value)) {
      if (Array.isArray(candidate)) {
        return candidate;
      }
    }
  }
  return [];
}

function normalizeSide(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("long") || normalized.includes("buy")) {
    return "long";
  }
  if (normalized.includes("short") || normalized.includes("sell")) {
    return "short";
  }
  return null;
}

function normalizeTimestamp(raw) {
  if (raw == null) {
    return null;
  }

  if (typeof raw === "number" && Number.isFinite(raw)) {
    const ms = raw > 1_000_000_000_000 ? raw : raw * 1000;
    return new Date(ms).toISOString();
  }

  const asNumber = Number(raw);
  if (Number.isFinite(asNumber)) {
    const ms = asNumber > 1_000_000_000_000 ? asNumber : asNumber * 1000;
    return new Date(ms).toISOString();
  }

  const asDate = new Date(raw);
  if (!Number.isNaN(asDate.valueOf())) {
    return asDate.toISOString();
  }

  return String(raw);
}

function parseBarsResponse(data) {
  const barsRoot =
    data?.bars ||
    data?.bar_list ||
    data?.kline_list ||
    data?.items ||
    data?.list ||
    data;

  const rawBars = asArray(barsRoot);
  const normalized = [];

  for (const rawBar of rawBars) {
    let close = NaN;
    let timestamp = null;

    if (Array.isArray(rawBar)) {
      close = firstFiniteNumber(rawBar[4], rawBar[1]);
      timestamp = normalizeTimestamp(rawBar[0]);
    } else if (rawBar && typeof rawBar === "object") {
      close = firstFiniteNumber(
        rawBar.close,
        rawBar.c,
        rawBar.close_price,
        rawBar.price,
        rawBar.latest_price
      );
      timestamp = normalizeTimestamp(
        rawBar.timestamp ?? rawBar.ts ?? rawBar.time ?? rawBar.t ?? rawBar.trade_time
      );
    }

    if (Number.isFinite(close) && timestamp) {
      normalized.push({ close, timestamp });
    }
  }

  normalized.sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  return normalized;
}

function isUsRegularSessionOpen(now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  const parts = formatter.formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value || "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value || "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value || "0");

  const isWeekday = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday);
  if (!isWeekday) {
    return false;
  }

  const totalMinutes = hour * 60 + minute;
  return totalMinutes >= 570 && totalMinutes < 960;
}

export class WebullBroker {
  constructor({
    appKey,
    appSecret,
    baseUrl,
    secAccountId,
    regionId,
    exchangeCode,
    market,
    tokenExpireSeconds,
    tickerIdBySymbol
  }) {
    this.settings = {
      appKey,
      appSecret,
      baseUrl: baseUrl.replace(/\/$/, ""),
      secAccountId,
      regionId,
      exchangeCode,
      market,
      tokenExpireSeconds
    };

    this.accessToken = "";
    this.accessTokenExpiresAtMs = 0;
    this.secAccountId = secAccountId || "";
    this.tickerIdBySymbol = new Map(
      Object.entries(tickerIdBySymbol || {}).map(([symbol, tickerId]) => [
        symbol.toUpperCase(),
        String(tickerId)
      ])
    );
  }

  async #sendSigned(path, body, { requiresAuth = true, allowRetry = true } = {}) {
    if (requiresAuth) {
      await this.#ensureAccessToken();
    }

    const timestamp = Date.now();
    const params = formatBodyForSignature(body);
    const signature = toSha256Hex(`${path}${timestamp}${params}${this.settings.appSecret}`);

    const headers = {
      ...JSON_HEADERS,
      "x-app-key": this.settings.appKey,
      "x-signature": signature,
      "x-timestamp": String(timestamp),
      "x-platform": "Node",
      "x-osv": process.version
    };

    if (requiresAuth && this.accessToken) {
      headers["x-access-token"] = this.accessToken;
    }

    const response = await fetch(`${this.settings.baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });

    const rawText = await response.text();
    let payload = {};

    if (rawText) {
      try {
        payload = JSON.parse(rawText);
      } catch {
        throw new Error(`Webull API returned non-JSON at ${path}: ${rawText}`);
      }
    }

    const isFailure = !response.ok || payload?.success === false;
    if (isFailure) {
      const reason =
        payload?.message ||
        payload?.msg ||
        payload?.code ||
        `HTTP ${response.status}`;

      const tokenError =
        response.status === 401 || /token/i.test(String(reason));

      if (requiresAuth && allowRetry && tokenError) {
        this.accessToken = "";
        this.accessTokenExpiresAtMs = 0;
        return this.#sendSigned(path, body, {
          requiresAuth,
          allowRetry: false
        });
      }

      throw new Error(`Webull API error at ${path}: ${reason}`);
    }

    return payload?.data ?? payload;
  }

  async #ensureAccessToken() {
    const refreshLeewayMs = 60_000;
    if (this.accessToken && Date.now() < this.accessTokenExpiresAtMs - refreshLeewayMs) {
      return;
    }

    const body = {
      expire_in_seconds: this.settings.tokenExpireSeconds
    };

    const data = await this.#sendSigned("/openapi/auth/v1/create-token", body, {
      requiresAuth: false
    });

    const token =
      data?.access_token ||
      data?.token ||
      data?.accessToken;

    if (!token) {
      throw new Error("Webull create-token succeeded but no access_token was returned.");
    }

    const expiresIn = firstFiniteNumber(
      data?.expire_in_seconds,
      data?.expires_in,
      this.settings.tokenExpireSeconds
    );

    this.accessToken = String(token);
    this.accessTokenExpiresAtMs = Date.now() + Math.max(300, expiresIn) * 1000;
  }

  async #ensureSecAccountId() {
    if (this.secAccountId) {
      return this.secAccountId;
    }

    const data = await this.#sendSigned("/openapi/account/v1/get-account-list", {});
    const accounts = asArray(data);
    const first = accounts[0];

    const resolvedId =
      first?.sec_account_id ||
      first?.secAccountId ||
      first?.account_id ||
      first?.accountId;

    if (!resolvedId) {
      throw new Error(
        "Unable to resolve sec_account_id from Webull account list. Set WEBULL_SEC_ACCOUNT_ID explicitly."
      );
    }

    this.secAccountId = String(resolvedId);
    return this.secAccountId;
  }

  async #resolveTickerId(symbol) {
    const normalizedSymbol = symbol.toUpperCase();
    const existing = this.tickerIdBySymbol.get(normalizedSymbol);
    if (existing) {
      return existing;
    }

    const data = await this.#sendSigned("/openapi/quote/v1/get-ticker", {
      region_id: this.settings.regionId,
      exchange_code: this.settings.exchangeCode,
      symbol_list: [normalizedSymbol]
    });

    const tickers = asArray(data);
    const matchedTicker =
      tickers.find(
        (ticker) =>
          String(ticker?.symbol || ticker?.ticker_symbol || "").toUpperCase() === normalizedSymbol
      ) || tickers[0];

    const tickerId =
      matchedTicker?.ticker_id ||
      matchedTicker?.tickerId ||
      matchedTicker?.id;

    if (!tickerId) {
      throw new Error(
        `Unable to resolve ticker_id for ${normalizedSymbol}. Set WEBULL_TICKER_IDS in .env.`
      );
    }

    const normalizedTickerId = String(tickerId);
    this.tickerIdBySymbol.set(normalizedSymbol, normalizedTickerId);
    return normalizedTickerId;
  }

  async getClock() {
    return {
      is_open: isUsRegularSessionOpen()
    };
  }

  async getAccount() {
    const secAccountId = await this.#ensureSecAccountId();
    const data = await this.#sendSigned("/openapi/assets/v1/get-account-assets", {
      sec_account_id: secAccountId
    });

    const equity = firstFiniteNumber(
      data?.net_liquidation_value,
      data?.netLiquidationValue,
      data?.total_assets,
      data?.totalAssets,
      data?.equity
    );

    if (!Number.isFinite(equity)) {
      throw new Error("Unable to parse account equity from Webull account assets response.");
    }

    return {
      equity,
      sec_account_id: secAccountId
    };
  }

  async getPositions() {
    const secAccountId = await this.#ensureSecAccountId();
    const data = await this.#sendSigned("/openapi/assets/v1/get-positions", {
      sec_account_id: secAccountId
    });

    const positions = asArray(data);
    return positions
      .map((position) => {
        const qty = firstFiniteNumber(position?.quantity, position?.qty, position?.position);
        return {
          symbol: String(position?.symbol || "").toUpperCase(),
          qty,
          side: normalizeSide(position?.direction || position?.side)
        };
      })
      .filter((position) => position.symbol && Number.isFinite(position.qty) && position.qty > 0);
  }

  async getBars(symbol, limit = 100) {
    const tickerId = await this.#resolveTickerId(symbol);
    const data = await this.#sendSigned("/openapi/quote/v1/get-history-bar", {
      ticker_id: tickerId,
      timeframe: "m1",
      count: Math.max(2, Math.floor(limit)),
      adjust_type: "none",
      ext_session: false
    });

    const bars = parseBarsResponse(data);
    if (bars.length === 0) {
      throw new Error(`No bars returned for ${symbol}.`);
    }

    return bars.slice(-limit);
  }

  async getPositionForSymbol(symbol) {
    const normalizedSymbol = symbol.toUpperCase();
    const positions = await this.getPositions();
    const matched = positions.find((position) => position.symbol === normalizedSymbol);

    if (!matched) {
      return null;
    }

    return {
      qty: String(matched.qty),
      side: matched.side
    };
  }

  async placeMarketOrder({ symbol, side, qty }) {
    const secAccountId = await this.#ensureSecAccountId();
    const normalizedSide = side.toUpperCase();

    if (!["BUY", "SELL"].includes(normalizedSide)) {
      throw new Error(`Unsupported side for Webull order: ${side}`);
    }

    const requestBody = {
      sec_account_id: secAccountId,
      new_orders: [
        {
          client_order_id: crypto.randomUUID(),
          instrument_type: "EQUITY",
          symbol: symbol.toUpperCase(),
          market: this.settings.market,
          side: normalizedSide,
          order_type: "MARKET",
          quantity: Math.floor(Number(qty)),
          support_trading_session: "CORE",
          entrust_type: "QTY",
          time_in_force: "DAY",
          combo_type: "NORMAL"
        }
      ]
    };

    if (!Number.isFinite(requestBody.new_orders[0].quantity) || requestBody.new_orders[0].quantity < 1) {
      throw new Error(`Invalid order quantity for ${symbol}: ${qty}`);
    }

    return this.#sendSigned("/openapi/trade/v1/place-order", requestBody);
  }
}
