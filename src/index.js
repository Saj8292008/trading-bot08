import { config, tradingModeLabel } from "./config.js";
import { WebullBroker } from "./broker/webull.js";
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

async function main() {
  const broker = new WebullBroker(config.webull);
  const notifier = buildNotifier(config.notifications, logger);

  const trader = new EmaCrossoverTrader({
    broker,
    notifier,
    logger,
    settings: config.strategy
  });

  logger.info(`Starting bot in ${tradingModeLabel} mode for ${config.strategy.symbols.join(", ")}`);
  await notifier.send(
    `Trading bot started (${tradingModeLabel}). Symbols: ${config.strategy.symbols.join(", ")}`
  );

  let cycles = 0;
  while (true) {
    cycles += 1;

    try {
      const cycleResult = await trader.runCycle();

      if (cycleResult.status === "completed") {
        if (cycleResult.actions.length === 0) {
          logger.info("Cycle complete: no trades.");
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
      await notifier.send(`Trading bot error: ${message}`);
    }

    await sleep(config.strategy.pollIntervalMs);
  }
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
