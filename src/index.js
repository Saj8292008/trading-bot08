import { config, tradingModeLabel } from "./config.js";
import { WebullBroker } from "./broker/webull.js";
import { YahooMarketData } from "./market/yahoo.js";
import { EmaSignalAdvisor } from "./signal/emaSignalAdvisor.js";
import { EmaCrossoverTrader } from "./strategy/emaCrossover.js";
import { buildNotifier } from "./notify/index.js";

const logger = {
  info: (msg) => console.log(`[${new Date().toISOString()}] INFO  ${msg}`),
  warn: (msg) => console.warn(`[${new Date().toISOString()}] WARN  ${msg}`),
  error: (msg) => console.error(`[${new Date().toISOString()}] ERROR ${msg}`)
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function buildRunner(notifier) {
  if (config.botMode === "signal_only") {
    if (config.marketData.source !== "yahoo") {
      throw new Error(`Unsupported MARKET_DATA_SOURCE: ${config.marketData.source}`);
    }

    const marketData = new YahooMarketData(config.marketData.yahoo);
    return new EmaSignalAdvisor({
      marketData,
      notifier,
      logger,
      settings: config.strategy
    });
  }

  const broker = new WebullBroker(config.webull);
  return new EmaCrossoverTrader({
    broker,
    notifier,
    logger,
    settings: config.strategy
  });
}

async function main() {
  const notifier = buildNotifier(config.notifications, logger);
  const runner = await buildRunner(notifier);

  logger.info(`Starting bot in ${tradingModeLabel} mode for ${config.strategy.symbols.join(", ")}`);

  if (config.botMode === "signal_only") {
    await notifier.send(
      `Signal bot started (${tradingModeLabel}). Symbols: ${config.strategy.symbols.join(", ")}`
    );
  } else {
    await notifier.send(
      `Trading bot started (${tradingModeLabel}). Symbols: ${config.strategy.symbols.join(", ")}`
    );
  }

  let cycles = 0;
  while (true) {
    cycles += 1;

    try {
      const cycleResult = await runner.runCycle();

      if (cycleResult.status === "halted") {
        logger.error(`Stopping bot after risk halt: ${cycleResult.reason}`);
        break;
      }

      if (cycleResult.status === "completed") {
        if (cycleResult.actions.length === 0) {
          logger.info("Cycle complete: no actions.");
        } else {
          logger.info(`Cycle complete: ${cycleResult.actions.length} action(s).`);
        }
      }

      if (cycles % config.strategy.heartbeatEveryCycles === 0) {
        await notifier.send(
          `Heartbeat: bot running (${tradingModeLabel}), cycle ${cycles}, ${new Date().toISOString()}`
        );
      }
    } catch (error) {
      const message = error?.message || String(error);
      logger.error(`Cycle failed: ${message}`);
      await notifier.send(`Bot error: ${message}`);
    }

    await sleep(config.strategy.pollIntervalMs);
  }

  logger.warn("Bot loop exited.");
}

process.on("SIGINT", () => {
  logger.warn("Received SIGINT. Exiting.");
  process.exit(0);
});

process.on("SIGTERM", () => {
  logger.warn("Received SIGTERM. Exiting.");
  process.exit(0);
});

main().catch((error) => {
  logger.error(`Fatal startup error: ${error?.message || error}`);
  process.exit(1);
});
