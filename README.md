# ritmex-bot

一个基于 Bun 的 Aster 永续合约终端机器人，内置趋势跟随（SMA30）与做市策略，使用 websocket 实时行情，命令行界面由 Ink 驱动，可在断线后自动恢复运行。

## 快速上手

使用优惠码获取 30% 手续费折扣：[注册 Aster 获取手续费优惠](https://www.asterdex.com/zh-CN/referral/4665f3)

1. **下载代码**
   - 如果会使用 Git：`git clone https://github.com/discountry/ritmex-bot.git`
   - 如果不会使用 Git：点击仓库页面的 `Code` → `Download ZIP`，将压缩包解压到如 `桌面/ritmex-bot` 的目录。
2. **打开命令行并进入项目目录**
   - macOS：通过 Spotlight (`⌘ + 空格`) 搜索 “Terminal” 并打开。
   - Windows：在开始菜单搜索 “PowerShell” 或 “Windows Terminal” 并打开。
   - 使用 `cd` 切换到项目目录，例如：
     ```bash
     # macOS / Linux
     cd ~/Desktop/ritmex-bot  
     # Windows         
     cd C:\Users\用户名\Desktop\ritmex-bot   
     ```
3. **安装 [Bun](https://bun.com) ≥ 1.2**
   - macOS / Linux：
     ```bash
     curl -fsSL https://bun.sh/install | bash
     ```
   - Windows（PowerShell）：
     ```powershell
     powershell -c "irm bun.sh/install.ps1 | iex"
     ```
   安装完成后关闭并重新打开终端，运行 `bun -v` 确认命令可用。

   如果上述命令无法完成安装，请尝试 [bun官网](https://bun.com/get) 提供的各种安装方式。

   Windows 用户如果无法正常安装，可以尝试先[安装 nodejs](https://nodejs.org/en/download)

   然后使用 `npm` 安装 `bun`：
   ```bash
   npm install -g bun
   ```
4. **安装依赖**
   ```bash
   bun install
   ```
5. **配置环境变量**
   复制 `.env.example` 为 `.env` 并填入你的 Aster API Key/Secret：
   ```bash
   cp .env.example .env
   ```
   然后根据需要修改 `.env` 中的配置项：
   - API KEY 获取地址 [https://www.asterdex.com/zh-CN/api-management](https://www.asterdex.com/zh-CN/api-management)
   - `ASTER_API_KEY` / `ASTER_API_SECRET`：Aster 交易所提供的 API 凭证，必须具备合约交易权限。
   - `TRADE_SYMBOL`：策略运行的交易对（默认 `BTCUSDT`），需与 API 权限范围一致。
   - `TRADE_AMOUNT`：单次下单数量（合约张数折算后单位为标的货币，例如 BTC）。
   - `LOSS_LIMIT`：单笔允许的最大亏损（USDT），触发即强制平仓。
   - `TRAILING_PROFIT` / `TRAILING_CALLBACK_RATE`：趋势策略的动态止盈触发值与回撤百分比。
   - `MAKER_*` 参数：做市策略追价阈值、报价偏移、刷新频率等，可按流动性需求调节。
6. **运行机器人**
   ```bash
   bun run index.ts
   ```
   在终端中按 ↑/↓ 选择 “趋势策略” 或 “做市策略”，回车启动。按 `Esc` 可返回选择菜单，`Ctrl+C` 退出。
7. **风险提示**
   建议先在小额或仿真环境中测试策略；真实资金操作前请确认 API 仅开启必要权限，并逐步验证配置。

A Bun-powered trading workstation for Aster perpetual contracts. The project ships two production strategies—an SMA30 trend follower and a dual-sided maker—that share a modular gateway, UI, and persistence layer. Everything runs in the terminal via Ink, with live websocket refresh and automatic recovery from restarts or network failures.

## Features
- **Live data over websockets** with REST fallbacks and automatic re-sync after reconnects.
- **Trend strategy**: SMA30 crossover entries, automated stop-loss / trailing-stop, and P&L tracking.
- **Maker strategy**: adaptive bid/ask chasing, risk stops, and target order introspection.
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
Pick a strategy with the arrow keys. Press `Esc` to return to the menu. The dashboard shows live order books, holdings, pending orders, and recent events. 状态完全以交易所数据为准，重新启动时会自动同步账户和挂单。

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

## Troubleshooting
- **Websocket reconnect loops**: ensure outbound access to `wss://fstream.asterdex.com/ws` and REST endpoints.
- **429 or 5xx responses**: the gateway backs off automatically, but check your rate limits and credentials.
- **CLI input errors**: run in a real TTY; non-interactive shells disable keyboard shortcuts but the UI still renders.

## Contributing
Issues and PRs are welcome. When adding strategies or exchanges, follow the modular patterns in `src/core` and add tests under `tests/`.
