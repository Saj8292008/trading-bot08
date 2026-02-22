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

function computeBuyQty({ equity, maxPositionPct, price }) {
  const maxNotional = equity * maxPositionPct;
  return Math.max(0, Math.floor(maxNotional / price));
}

export class EmaCrossoverTrader {
  constructor({ broker, notifier, logger, settings }) {
    this.broker = broker;
    this.notifier = notifier;
    this.logger = logger;
    this.settings = settings;
    this.lastProcessedBarBySymbol = new Map();
  }

  async runCycle() {
    const clock = await this.broker.getClock();
    if (!clock.is_open) {
      this.logger.info("Market is closed; skipping cycle.");
      return { status: "market_closed" };
    }

    const account = await this.broker.getAccount();
    const equity = Number(account.equity);

    const actions = [];

    for (const symbol of this.settings.symbols) {
      const bars = await this.broker.getBars(symbol, Math.max(this.settings.slowEma + 5, 40));
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

      const position = await this.broker.getPositionForSymbol(symbol);
      const currentQty = position ? Math.abs(Number(position.qty)) : 0;
      const positionSide = position?.side || null;
      const hasLongPosition = currentQty > 0 && positionSide === "long";

      if (position && positionSide !== "long") {
        this.logger.warn(
          `Ignoring non-long ${symbol} position (side=${positionSide}, qty=${position.qty}).`
        );
      }

      if (signal === "BUY" && !hasLongPosition) {
        const qty = computeBuyQty({
          equity,
          maxPositionPct: this.settings.maxPositionPct,
          price: lastPrice
        });

        if (qty < 1) {
          this.logger.warn(`Calculated qty is 0 for ${symbol}; skipping buy.`);
          continue;
        }

        const detail = `${symbol} BUY ${qty} @ ${lastPrice.toFixed(2)}`;
        if (this.settings.dryRun) {
          this.logger.info(`[DRY RUN] ${detail}`);
          await this.notifier.send(`DRY RUN: ${detail}`);
          actions.push(detail);
        } else {
          await this.broker.placeMarketOrder({ symbol, side: "buy", qty });
          this.logger.info(detail);
          await this.notifier.send(`Executed: ${detail}`);
          actions.push(detail);
        }
      }

      if (signal === "SELL" && hasLongPosition) {
        const detail = `${symbol} SELL ${currentQty} @ ${lastPrice.toFixed(2)}`;
        if (this.settings.dryRun) {
          this.logger.info(`[DRY RUN] ${detail}`);
          await this.notifier.send(`DRY RUN: ${detail}`);
          actions.push(detail);
        } else {
          await this.broker.placeMarketOrder({ symbol, side: "sell", qty: currentQty });
          this.logger.info(detail);
          await this.notifier.send(`Executed: ${detail}`);
          actions.push(detail);
        }
      }
    }

    return {
      status: "completed",
      actions
    };
  }
}
