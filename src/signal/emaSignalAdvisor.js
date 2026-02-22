function ema(series, period) {
  if (series.length < period) {
    return [];
  }

  const k = 2 / (period + 1);
  const seed = series.slice(0, period).reduce((acc, value) => acc + value, 0) / period;

  const result = [seed];
  for (let i = period; i < series.length; i += 1) {
    const next = series[i] * k + result[result.length - 1] * (1 - k);
    result.push(next);
  }

  return result;
}

function latestCrossSignal(closes, fastPeriod, slowPeriod) {
  const fast = ema(closes, fastPeriod);
  const slow = ema(closes, slowPeriod);

  const sharedLength = Math.min(fast.length, slow.length);
  if (sharedLength < 2) {
    return "HOLD";
  }

  const fastAligned = fast.slice(fast.length - sharedLength);
  const slowAligned = slow.slice(slow.length - sharedLength);

  const prevFast = fastAligned[sharedLength - 2];
  const prevSlow = slowAligned[sharedLength - 2];
  const currentFast = fastAligned[sharedLength - 1];
  const currentSlow = slowAligned[sharedLength - 1];

  if (prevFast <= prevSlow && currentFast > currentSlow) {
    return "BUY";
  }

  if (prevFast >= prevSlow && currentFast < currentSlow) {
    return "SELL";
  }

  return "HOLD";
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

  if (!["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday)) {
    return false;
  }

  const totalMinutes = hour * 60 + minute;
  return totalMinutes >= 570 && totalMinutes < 960;
}

export class EmaSignalAdvisor {
  constructor({ marketData, notifier, logger, settings }) {
    this.marketData = marketData;
    this.notifier = notifier;
    this.logger = logger;
    this.settings = settings;

    this.lastProcessedBarBySymbol = new Map();
    this.virtualLongBySymbol = new Map();

    const seedLongs = new Set(settings.signalStartInPositionSymbols || []);
    for (const symbol of settings.symbols) {
      this.virtualLongBySymbol.set(symbol, seedLongs.has(symbol));
    }
  }

  async runCycle() {
    if (!isUsRegularSessionOpen()) {
      this.logger.info("Market is closed; skipping cycle.");
      return { status: "market_closed" };
    }

    const actions = [];

    for (const symbol of this.settings.symbols) {
      const bars = await this.marketData.getBars(symbol, Math.max(this.settings.slowEma + 5, 40));
      if (bars.length < this.settings.slowEma + 2) {
        this.logger.warn(`Not enough bars for ${symbol}; skipping.`);
        continue;
      }

      const latestBarTs = bars[bars.length - 1].timestamp;
      if (this.lastProcessedBarBySymbol.get(symbol) === latestBarTs) {
        this.logger.info(`No new bar yet for ${symbol}; skipping.`);
        continue;
      }
      this.lastProcessedBarBySymbol.set(symbol, latestBarTs);

      const closes = bars.map((bar) => bar.close);
      const lastPrice = closes[closes.length - 1];
      const signal = latestCrossSignal(closes, this.settings.fastEma, this.settings.slowEma);
      const hasLongPosition = this.virtualLongBySymbol.get(symbol) === true;

      if (signal === "BUY" && !hasLongPosition) {
        this.virtualLongBySymbol.set(symbol, true);

        const detail = `BUY signal: ${symbol} near ${lastPrice.toFixed(2)} (EMA ${this.settings.fastEma}/${this.settings.slowEma} bullish cross)`;
        this.logger.info(detail);
        await this.notifier.send(detail);
        actions.push(detail);
      }

      if (signal === "SELL" && hasLongPosition) {
        this.virtualLongBySymbol.set(symbol, false);

        const detail = `SELL signal: ${symbol} near ${lastPrice.toFixed(2)} (EMA ${this.settings.fastEma}/${this.settings.slowEma} bearish cross)`;
        this.logger.info(detail);
        await this.notifier.send(detail);
        actions.push(detail);
      }
    }

    return {
      status: "completed",
      actions
    };
  }
}
