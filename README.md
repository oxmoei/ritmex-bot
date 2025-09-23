# ritmex-bot

A Bun-powered trading workstation for Aster perpetual contracts. The project ships two production strategies—an SMA30 trend follower and a dual-sided maker—that share a modular gateway, UI, and persistence layer. Everything runs in the terminal via Ink, with live websocket refresh and automatic recovery from restarts or network failures.

## Features
- **Live data over websockets** with REST fallbacks and automatic re-sync after reconnects.
- **Trend strategy**: SMA30 crossover entries, automated stop-loss / trailing-stop, and P&L tracking.
- **Maker strategy**: adaptive bid/ask chasing, risk stops, and target order introspection.
- **State persistence**: positions, open orders, and logs mirrored under `data/` so restarts continue where you left off.
- **Extensibility**: exchange gateway, engines, and UI components are modular for new venues or strategies.

## Requirements
- [Bun](https://bun.com) ≥ 1.2
- Node.js (optional, only if you prefer `npm` tooling)
- Valid Aster API credentials with futures access

## Installation
```bash
bun install
```

## Configuration
Create an `.env` (or export environment variables) with at least:
```bash
ASTER_API_KEY=your_key
ASTER_API_SECRET=your_secret
TRADE_SYMBOL=BTCUSDT        # optional, defaults to BTCUSDT
TRADE_AMOUNT=0.001          # position size used by both strategies
LOSS_LIMIT=0.03             # per-trade USD loss cap
```
Additional maker-specific knobs (`MAKER_*`) live in `src/config.ts` and may be overridden via env vars.

## Running the CLI
```bash
bun run index.ts   # or: bun run dev / bun run start
```
Pick a strategy with the arrow keys. Press `Esc` to return to the menu. The dashboard shows live order books, holdings, pending orders, and recent events. All state is mirrored in `data/trend-*.json` and `data/maker-*.json` so the bot can resume after crashes or manual stops.

## Testing
```bash
bun run test        # bun x vitest run
bun run test:watch  # stay in watch mode
```
Current tests cover the order coordinator utilities and strategy helpers; add unit tests beside new modules as you extend the system.

## Project Layout
- `src/config.ts` – shared runtime configuration
- `src/core/` – trend & maker engines plus order coordination
- `src/exchanges/` – Aster REST/WS gateway and adapters
- `src/ui/` – Ink components and strategy dashboards
- `src/utils/` – math helpers, persistence, strategy utilities
- `tests/` – Vitest suites for critical modules

## Persistence & Recovery Notes
- Important state is stored in `./data` (git-ignored). Deleting those files forces a fresh start.
- On reconnect or restart the bot re-pulls account/position/order snapshots and reconciles against local state. Orders on other symbols are ignored so you can trade manually without interference.

## Troubleshooting
- **Websocket reconnect loops**: ensure outbound access to `wss://fstream.asterdex.com/ws` and REST endpoints.
- **429 or 5xx responses**: the gateway backs off automatically, but check your rate limits and credentials.
- **CLI input errors**: run in a real TTY; non-interactive shells disable keyboard shortcuts but the UI still renders.

## Contributing
Issues and PRs are welcome. When adding strategies or exchanges, follow the modular patterns in `src/core` and add tests under `tests/`.
