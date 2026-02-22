import { TelegramNotifier } from "./telegram.js";
import { IMessageNotifier } from "./imessage.js";

export class MultiNotifier {
  constructor(notifiers = [], logger = console) {
    this.notifiers = notifiers;
    this.logger = logger;
  }

  async send(message) {
    const active = this.notifiers.filter((notifier) => notifier.isEnabled());
    if (active.length === 0) {
      return;
    }

    const results = await Promise.allSettled(active.map((notifier) => notifier.send(message)));
    for (const result of results) {
      if (result.status === "rejected") {
        this.logger.error(`Notifier error: ${result.reason?.message || result.reason}`);
      }
    }
  }
}

export function buildNotifier(settings, logger = console) {
  return new MultiNotifier(
    [
      new TelegramNotifier(settings.telegram),
      new IMessageNotifier(settings.imessage)
    ],
    logger
  );
}
