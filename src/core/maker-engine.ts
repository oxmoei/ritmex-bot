import type { MakerConfig } from "../config";
import type { ExchangeAdapter } from "../exchanges/adapter";
import type {
  AsterAccountSnapshot,
  AsterDepth,
  AsterOrder,
  AsterTicker,
} from "../exchanges/types";
import { toPrice1Decimal } from "../utils/math";
import { createTradeLog, type TradeLogEntry } from "../state/trade-log";
import { loadState, saveState } from "../utils/persistence";
import { getPosition, type PositionSnapshot } from "../utils/strategy";
import {
  marketClose,
  placeOrder,
  unlockOperating,
} from "./order-coordinator";
import type { OrderLockMap, OrderPendingMap, OrderTimerMap } from "./order-coordinator";

interface DesiredOrder {
  side: "BUY" | "SELL";
  price: number;
  amount: number;
  reduceOnly: boolean;
}

export interface MakerEngineSnapshot {
  ready: boolean;
  symbol: string;
  topBid: number | null;
  topAsk: number | null;
  spread: number | null;
  position: PositionSnapshot;
  pnl: number;
  accountUnrealized: number;
  openOrders: AsterOrder[];
  desiredOrders: DesiredOrder[];
  tradeLog: TradeLogEntry[];
  lastUpdated: number | null;
}

type MakerEvent = "update";
type MakerListener = (snapshot: MakerEngineSnapshot) => void;

const EPS = 1e-5;

export class MakerEngine {
  private accountSnapshot: AsterAccountSnapshot | null = null;
  private depthSnapshot: AsterDepth | null = null;
  private tickerSnapshot: AsterTicker | null = null;
  private openOrders: AsterOrder[] = [];

  private readonly locks: OrderLockMap = {};
  private readonly timers: OrderTimerMap = {};
  private readonly pending: OrderPendingMap = {};

  private readonly tradeLog: ReturnType<typeof createTradeLog>;
  private readonly listeners = new Map<MakerEvent, Set<MakerListener>>();
  private readonly stateFile: string;
  private savedStateApplied = false;
  private lastPersistedAt = 0;
  private savedOpenOrders: AsterOrder[] = [];

  private timer: ReturnType<typeof setInterval> | null = null;
  private processing = false;
  private desiredOrders: DesiredOrder[] = [];
  private accountUnrealized = 0;

  constructor(private readonly config: MakerConfig, private readonly exchange: ExchangeAdapter) {
    this.tradeLog = createTradeLog(this.config.maxLogEntries);
    this.stateFile = `maker-${this.config.symbol}.json`;
    this.bootstrap();
    void this.restoreState();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.config.refreshIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  on(event: MakerEvent, handler: MakerListener): void {
    const handlers = this.listeners.get(event) ?? new Set<MakerListener>();
    handlers.add(handler);
    this.listeners.set(event, handlers);
  }

  off(event: MakerEvent, handler: MakerListener): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    handlers.delete(handler);
    if (handlers.size === 0) {
      this.listeners.delete(event);
    }
  }

  getSnapshot(): MakerEngineSnapshot {
    return this.buildSnapshot();
  }

  private bootstrap(): void {
    this.exchange.watchAccount((snapshot) => {
      this.accountSnapshot = snapshot;
      const totalUnrealized = Number(snapshot.totalUnrealizedProfit ?? "0");
      if (Number.isFinite(totalUnrealized)) {
        this.accountUnrealized = totalUnrealized;
      }
      this.emitUpdate();
    });

    this.exchange.watchOrders((orders) => {
      this.syncLocksWithOrders(orders);
      this.openOrders = Array.isArray(orders)
        ? orders.filter((order) => order.type !== "MARKET" && order.symbol === this.config.symbol)
        : [];
      this.reconcileSavedOpenOrders();
      this.emitUpdate();
    });

    this.exchange.watchDepth(this.config.symbol, (depth) => {
      this.depthSnapshot = depth;
      this.emitUpdate();
    });

    this.exchange.watchTicker(this.config.symbol, (ticker) => {
      this.tickerSnapshot = ticker;
      this.emitUpdate();
    });

    // Maker strategy does not consume klines, but subscribe to keep parity with other modules
    this.exchange.watchKlines(this.config.symbol, "1m", () => {
      /* no-op */
    });
  }

  private syncLocksWithOrders(orders: AsterOrder[]): void {
    Object.keys(this.pending).forEach((type) => {
      const pendingId = this.pending[type];
      if (!pendingId) return;
      const match = orders.find((order) => String(order.orderId) === pendingId);
      if (!match || (match.status && match.status !== "NEW" && match.status !== "PARTIALLY_FILLED")) {
        unlockOperating(this.locks, this.timers, this.pending, type);
      }
    });
  }

  private isReady(): boolean {
    return Boolean(this.accountSnapshot && this.depthSnapshot);
  }

  private async tick(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      if (!this.isReady()) {
        this.emitUpdate();
        return;
      }

      const depth = this.depthSnapshot!;
      const bidLevel = depth.bids?.[0];
      const askLevel = depth.asks?.[0];
      const topBid = bidLevel ? Number(bidLevel[0]) : undefined;
      const topAsk = askLevel ? Number(askLevel[0]) : undefined;
      if (!Number.isFinite(topBid) || !Number.isFinite(topAsk)) {
        this.emitUpdate();
        return;
      }

      const bidPrice = toPrice1Decimal(topBid! - this.config.bidOffset);
      const askPrice = toPrice1Decimal(topAsk! + this.config.askOffset);
      const position = getPosition(this.accountSnapshot, this.config.symbol);
      const absPosition = Math.abs(position.positionAmt);
      const desired: DesiredOrder[] = [];

      if (absPosition < EPS) {
        desired.push({ side: "BUY", price: bidPrice, amount: this.config.tradeAmount, reduceOnly: false });
        desired.push({ side: "SELL", price: askPrice, amount: this.config.tradeAmount, reduceOnly: false });
      } else {
        const closeSide: "BUY" | "SELL" = position.positionAmt > 0 ? "SELL" : "BUY";
        const closePrice = closeSide === "SELL" ? askPrice : bidPrice;
        desired.push({ side: closeSide, price: closePrice, amount: absPosition, reduceOnly: true });
      }

      this.desiredOrders = desired;
      await this.syncOrders(desired);
      await this.checkRisk(position, bidPrice, askPrice);
      this.emitUpdate();
    } catch (error) {
      this.tradeLog.push("error", `做市循环异常: ${String(error)}`);
      this.emitUpdate();
    } finally {
      this.processing = false;
    }
  }

  private async syncOrders(targets: DesiredOrder[]): Promise<void> {
    const tolerance = this.config.priceChaseThreshold;
    const unmatched = new Set(targets.map((_, idx) => idx));
    const toCancel: AsterOrder[] = [];

    for (const order of this.openOrders) {
      const price = Number(order.price);
      if (!Number.isFinite(price)) {
        toCancel.push(order);
        continue;
      }
      const reduceOnly = order.reduceOnly === true;
      const matchedIndex = targets.findIndex((target, index) => {
        if (!unmatched.has(index)) return false;
        if (target.side !== order.side) return false;
        if (target.reduceOnly !== reduceOnly) return false;
        return Math.abs(price - target.price) <= tolerance;
      });
      if (matchedIndex >= 0) {
        unmatched.delete(matchedIndex);
        continue;
      }
      toCancel.push(order);
    }

    for (const order of toCancel) {
      try {
        await this.exchange.cancelOrder({ symbol: this.config.symbol, orderId: order.orderId });
        this.tradeLog.push("order", `撤销不匹配订单 ${order.side} @ ${order.price} reduceOnly=${order.reduceOnly}`);
      } catch (error) {
        this.tradeLog.push("error", `撤销订单失败: ${String(error)}`);
      }
    }

    for (const index of unmatched) {
      const target = targets[index];
      if (!target) continue;
      if (target.amount < EPS) continue;
      try {
        await placeOrder(
          this.exchange,
          this.config.symbol,
          this.openOrders,
          this.locks,
          this.timers,
          this.pending,
          target.side,
          target.price,
          target.amount,
          (type, detail) => this.tradeLog.push(type, detail),
          target.reduceOnly
        );
      } catch (error) {
        this.tradeLog.push("error", `挂单失败(${target.side} ${target.price}): ${String(error)}`);
      }
    }
  }

  private async checkRisk(position: PositionSnapshot, bidPrice: number, askPrice: number): Promise<void> {
    const absPosition = Math.abs(position.positionAmt);
    if (absPosition < EPS) return;

    const pnl = position.positionAmt > 0
      ? (bidPrice - position.entryPrice) * absPosition
      : (position.entryPrice - askPrice) * absPosition;

    if (pnl < -this.config.lossLimit || position.unrealizedProfit < -this.config.lossLimit) {
      this.tradeLog.push(
        "stop",
        `触发止损，方向=${position.positionAmt > 0 ? "多" : "空"} 当前亏损=${pnl.toFixed(4)} USDT`
      );
      try {
        await this.flushOrders();
        await marketClose(
          this.exchange,
          this.config.symbol,
          this.openOrders,
          this.locks,
          this.timers,
          this.pending,
          position.positionAmt > 0 ? "SELL" : "BUY",
          absPosition,
          (type, detail) => this.tradeLog.push(type, detail)
        );
      } catch (error) {
        this.tradeLog.push("error", `止损平仓失败: ${String(error)}`);
      }
    }
  }

  private async flushOrders(): Promise<void> {
    if (!this.openOrders.length) return;
    for (const order of this.openOrders) {
      try {
        await this.exchange.cancelOrder({ symbol: this.config.symbol, orderId: order.orderId });
      } catch (error) {
        this.tradeLog.push("error", `撤销订单失败: ${String(error)}`);
      }
    }
  }

  private emitUpdate(): void {
    const snapshot = this.buildSnapshot();
    const handlers = this.listeners.get("update");
    if (handlers) {
      handlers.forEach((handler) => handler(snapshot));
    }
    void this.persistSnapshot(snapshot);
  }

  private buildSnapshot(): MakerEngineSnapshot {
    const position = getPosition(this.accountSnapshot, this.config.symbol);
    const bid = this.depthSnapshot?.bids?.[0]?.[0];
    const ask = this.depthSnapshot?.asks?.[0]?.[0];
    const bidNum = Number(bid);
    const askNum = Number(ask);
    const spread = Number.isFinite(bidNum) && Number.isFinite(askNum) ? askNum - bidNum : null;
    const priceForPnl = position.positionAmt > 0 ? bidNum : askNum;
    const pnl = Number.isFinite(priceForPnl)
      ? (position.positionAmt > 0
          ? (priceForPnl! - position.entryPrice) * Math.abs(position.positionAmt)
          : (position.entryPrice - priceForPnl!) * Math.abs(position.positionAmt))
      : 0;

    return {
      ready: this.isReady(),
      symbol: this.config.symbol,
      topBid: Number.isFinite(bidNum) ? bidNum : null,
      topAsk: Number.isFinite(askNum) ? askNum : null,
      spread,
      position,
      pnl,
      accountUnrealized: this.accountUnrealized,
      openOrders: this.openOrders,
      desiredOrders: this.desiredOrders,
      tradeLog: this.tradeLog.all(),
      lastUpdated: Date.now(),
    };
  }

  private async restoreState(): Promise<void> {
    if (this.savedStateApplied) return;
    this.savedStateApplied = true;
    const state = await loadState<{
      tradeLog?: TradeLogEntry[];
      accountUnrealized?: number;
      openOrders?: AsterOrder[];
    }>(this.stateFile);
    if (!state) return;
    if (Array.isArray(state.tradeLog)) this.tradeLog.replace(state.tradeLog);
    if (typeof state.accountUnrealized === "number") this.accountUnrealized = state.accountUnrealized;
    if (Array.isArray(state.openOrders)) this.savedOpenOrders = state.openOrders;
  }

  private reconcileSavedOpenOrders(): void {
    if (!this.savedOpenOrders.length) return;
    const currentIds = new Set(this.openOrders.map((order) => order.orderId));
    const missing = this.savedOpenOrders.filter((order) => !currentIds.has(order.orderId));
    if (missing.length) {
      this.tradeLog.push("order", `检测到 ${missing.length} 个历史挂单与当前状态不一致，将重新同步`);
    }
    this.savedOpenOrders = [];
  }

  private async persistSnapshot(snapshot?: MakerEngineSnapshot): Promise<void> {
    const now = Date.now();
    if (now - this.lastPersistedAt < 1000) return;
    this.lastPersistedAt = now;
    const current = snapshot ?? this.buildSnapshot();
    await saveState(this.stateFile, {
      tradeLog: current.tradeLog,
      accountUnrealized: current.accountUnrealized,
      openOrders: current.openOrders.filter((order) => order.symbol === this.config.symbol),
      position: current.position,
      timestamp: current.lastUpdated,
    });
  }
}
