# Uncle John Trading Bot (Webull)

Automated day-trading bot that:
- Pulls 1-minute bars from Webull OpenAPI.
- Uses an EMA crossover strategy (fast vs slow EMA).
- Places market buy/sell orders automatically.
- Sends updates to Telegram and/or iMessage.

## Important Risk Note

This is software automation, not financial advice. Start in paper/simulated validation first and verify behavior for multiple market sessions before enabling live orders.

## Requirements

- Node.js 20+
- Webull OpenAPI access (`app_key` + `app_secret`)
- macOS (only if using iMessage notifications)

## Setup

1. Create env file:

```bash
cp .env.example .env
```

2. Fill in `.env`:
- `WEBULL_APP_KEY`, `WEBULL_APP_SECRET`
- optional `WEBULL_SEC_ACCOUNT_ID` (if account auto-discovery fails)
- optional `WEBULL_TICKER_IDS` (symbol-to-ticker_id mapping)
- optional `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- optional `IMESSAGE_RECIPIENT`

3. Keep this safe for paper validation first:
- `DRY_RUN=true`
- `ENABLE_LIVE_TRADING=false`

4. Start the bot:

```bash
npm run bot
```

## Going Live (After Validation)

Set:
- `DRY_RUN=false`
- `ENABLE_LIVE_TRADING=true`

If either setting is missing/misaligned, startup fails intentionally.

## Strategy

- Buy when fast EMA crosses above slow EMA and there is no long position.
- Sell when fast EMA crosses below slow EMA and there is a long position.
- Position size: `floor((equity * MAX_POSITION_PCT) / price)`.
- Runs once every `POLL_INTERVAL_MS`.

## Notes About Market Hours

- The bot guards trading to regular US market hours (Mon-Fri, 9:30 AM to 4:00 PM ET).
- This simple guard does not include market-holiday calendars; Webull order validation is still authoritative.

## iMessage Notes

- `IMESSAGE_RECIPIENT` should be the phone number or Apple ID email tied to iMessage.
- The first send attempt may trigger macOS automation permissions for `osascript`/Terminal.
- `IMESSAGE_SERVICE` supports `iMessage` (default) or `SMS`.

## Telegram Notes

- Create a bot with BotFather.
- Put bot token in `TELEGRAM_BOT_TOKEN`.
- Put your chat ID in `TELEGRAM_CHAT_ID`.

## File Layout

- `src/index.js` main runtime loop
- `src/broker/webull.js` Webull API integration
- `src/strategy/emaCrossover.js` signal and execution logic
- `src/notify/telegram.js` Telegram sender
- `src/notify/imessage.js` iMessage sender
- `src/config.js` env loading and validation
