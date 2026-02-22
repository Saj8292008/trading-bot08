export class YahooMarketData {
  constructor({ interval = "1m", range = "1d" } = {}) {
    this.interval = interval;
    this.range = range;
  }

  async getBars(symbol, limit = 100) {
    const params = new URLSearchParams({
      interval: this.interval,
      range: this.range,
      includePrePost: "false"
    });

    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${params.toString()}`;
    const response = await fetch(url);

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Yahoo chart request failed (${response.status}) for ${symbol}: ${body}`);
    }

    const payload = await response.json();
    const chart = payload?.chart;

    if (chart?.error) {
      throw new Error(`Yahoo chart error for ${symbol}: ${chart.error.description || chart.error.code}`);
    }

    const result = chart?.result?.[0];
    const timestamps = result?.timestamp || [];
    const closes = result?.indicators?.quote?.[0]?.close || [];

    const bars = [];
    const size = Math.min(timestamps.length, closes.length);

    for (let i = 0; i < size; i += 1) {
      const close = Number(closes[i]);
      const ts = Number(timestamps[i]);

      if (!Number.isFinite(close) || !Number.isFinite(ts)) {
        continue;
      }

      bars.push({
        close,
        timestamp: new Date(ts * 1000).toISOString()
      });
    }

    if (bars.length === 0) {
      throw new Error(`No intraday bars returned for ${symbol} from Yahoo.`);
    }

    return bars.slice(-Math.max(2, Math.floor(limit)));
  }
}
