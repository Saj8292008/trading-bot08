# Uncle John Trading Bot

This bot supports two modes:
- `signal_only` (default): sends BUY/SELL alerts only, no broker API keys required.
- `webull`: places live/paper trades through Webull OpenAPI.

## Important Risk Note

This is software automation, not financial advice.

## Requirements

- Node.js 20+
- Webull OpenAPI keys only if using `BOT_MODE=webull`
- macOS only if using iMessage notifications

## Quick Start (No API Keys)

1. Create env file:

```bash
cp .env.example .env
```

2. Keep these settings:

```env
BOT_MODE=signal_only
MARKET_DATA_SOURCE=yahoo
SYMBOLS=SPY,QQQ,AAPL
```

3. Add a notification channel (optional but recommended):
- Telegram: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
- iMessage: `IMESSAGE_RECIPIENT`

4. Start:

```bash
npm run bot
```

The bot will send alerts like:
- `BUY signal: SPY near 598.31 ...`
- `SELL signal: SPY near 600.02 ...`

## Webull Trading Mode

Set:

```env
BOT_MODE=webull
WEBULL_APP_KEY=...
WEBULL_APP_SECRET=...
```

Keep safe first:

```env
DRY_RUN=true
ENABLE_LIVE_TRADING=false
```

Enable real orders only after validation:

```env
DRY_RUN=false
ENABLE_LIVE_TRADING=true
```

## Auto Stop Trading (Risk Kill-Switch)

These are used in `webull` mode:
- `STOP_TRADING_EQUITY_FLOOR`
- `STOP_TRADING_DAILY_LOSS_PCT`
- `STOP_TRADING_DAILY_PROFIT_PCT`

If any threshold is hit, the bot sends an alert and exits.

## Notes About Market Hours

The bot only runs strategy logic during regular US market hours (Mon-Fri, 9:30 AM to 4:00 PM ET).

## File Layout

- `src/index.js` main runtime loop and mode selection
- `src/signal/emaSignalAdvisor.js` signal-only advisor
- `src/market/yahoo.js` Yahoo intraday market data client
- `src/broker/webull.js` Webull API integration
- `src/strategy/emaCrossover.js` order-execution strategy (webull mode)
- `src/notify/telegram.js` Telegram sender
- `src/notify/imessage.js` iMessage sender
- `src/config.js` env loading and validation
