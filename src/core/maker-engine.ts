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
import { isUnknownOrderError } from "../utils/errors";
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
  sessionVolume: number;
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
  private readonly pendingCancelOrders = new Set<number>();

  private readonly tradeLog: ReturnType<typeof createTradeLog>;
  private readonly listeners = new Map<MakerEvent, Set<MakerListener>>();

  private timer: ReturnType<typeof setInterval> | null = null;
  private processing = false;
  private desiredOrders: DesiredOrder[] = [];
  private accountUnrealized = 0;
  private sessionQuoteVolume = 0;
  private prevPositionAmt = 0;
  private initializedPosition = false;
  private initialOrderSnapshotReady = false;
  private initialOrderResetDone = false;
  private entryPricePendingLogged = false;

  constructor(private readonly config: MakerConfig, private readonly exchange: ExchangeAdapter) {
    this.tradeLog = createTradeLog(this.config.maxLogEntries);
    this.bootstrap();
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
      const position = getPosition(snapshot, this.config.symbol);
      this.updateSessionVolume(position);
      this.emitUpdate();
    });

    this.exchange.watchOrders((orders) => {
      this.syncLocksWithOrders(orders);
      this.openOrders = Array.isArray(orders)
        ? orders.filter((order) => order.type !== "MARKET" && order.symbol === this.config.symbol)
        : [];
      const currentIds = new Set(this.openOrders.map((order) => order.orderId));
      for (const id of Array.from(this.pendingCancelOrders)) {
        if (!currentIds.has(id)) {
          this.pendingCancelOrders.delete(id);
        }
      }
      this.initialOrderSnapshotReady = true;
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
      if (!(await this.ensureStartupOrderReset())) {
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
        this.entryPricePendingLogged = false;
        desired.push({ side: "BUY", price: bidPrice, amount: this.config.tradeAmount, reduceOnly: false });
        desired.push({ side: "SELL", price: askPrice, amount: this.config.tradeAmount, reduceOnly: false });
      } else {
        const closeSide: "BUY" | "SELL" = position.positionAmt > 0 ? "SELL" : "BUY";
        const closePrice = closeSide === "SELL" ? askPrice : bidPrice;
        desired.push({ side: closeSide, price: closePrice, amount: absPosition, reduceOnly: true });
      }

      this.desiredOrders = desired;
      this.updateSessionVolume(position);
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

  private async ensureStartupOrderReset(): Promise<boolean> {
    if (this.initialOrderResetDone) return true;
    if (!this.initialOrderSnapshotReady) return false;
    if (!this.openOrders.length) {
      this.initialOrderResetDone = true;
      return true;
    }
    try {
      await this.exchange.cancelAllOrders({ symbol: this.config.symbol });
      this.pendingCancelOrders.clear();
      unlockOperating(this.locks, this.timers, this.pending, "LIMIT");
      this.openOrders = [];
      this.emitUpdate();
      this.tradeLog.push("order", "启动时清理历史挂单");
      this.initialOrderResetDone = true;
      return true;
    } catch (error) {
      if (isUnknownOrderError(error)) {
        this.tradeLog.push("order", "历史挂单已消失，跳过启动清理");
        this.initialOrderResetDone = true;
        this.openOrders = [];
        this.emitUpdate();
        return true;
      }
      this.tradeLog.push("error", `启动撤单失败: ${String(error)}`);
      return false;
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
      if (this.pendingCancelOrders.has(order.orderId)) {
        continue;
      }
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
      this.pendingCancelOrders.add(order.orderId);
      try {
        await this.exchange.cancelOrder({ symbol: this.config.symbol, orderId: order.orderId });
        this.tradeLog.push("order", `撤销不匹配订单 ${order.side} @ ${order.price} reduceOnly=${order.reduceOnly}`);
      } catch (error) {
        if (isUnknownOrderError(error)) {
          this.tradeLog.push("order", "撤销时发现订单已被成交/取消，忽略");
          this.pendingCancelOrders.delete(order.orderId);
        } else {
          this.tradeLog.push("error", `撤销订单失败: ${String(error)}`);
          this.pendingCancelOrders.delete(order.orderId);
        }
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

    const hasEntryPrice = Number.isFinite(position.entryPrice) && Math.abs(position.entryPrice) > 1e-8;
    if (!hasEntryPrice) {
      if (!this.entryPricePendingLogged) {
        this.tradeLog.push("info", "做市持仓均价未同步，等待账户快照刷新后再执行止损判断");
        this.entryPricePendingLogged = true;
      }
      return;
    }
    this.entryPricePendingLogged = false;

    const pnl = position.positionAmt > 0
      ? (bidPrice - position.entryPrice) * absPosition
      : (position.entryPrice - askPrice) * absPosition;
    const unrealized = Number.isFinite(position.unrealizedProfit)
      ? position.unrealizedProfit
      : null;
    const derivedLoss = pnl < -this.config.lossLimit;
    const snapshotLoss = Boolean(
      unrealized != null &&
        unrealized < -this.config.lossLimit &&
        pnl <= 0
    );

    if (derivedLoss || snapshotLoss) {
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
        if (isUnknownOrderError(error)) {
          this.tradeLog.push("order", "止损平仓时订单已不存在");
        } else {
          this.tradeLog.push("error", `止损平仓失败: ${String(error)}`);
        }
      }
    }
  }

  private async flushOrders(): Promise<void> {
    if (!this.openOrders.length) return;
    for (const order of this.openOrders) {
      if (this.pendingCancelOrders.has(order.orderId)) continue;
      this.pendingCancelOrders.add(order.orderId);
      try {
        await this.exchange.cancelOrder({ symbol: this.config.symbol, orderId: order.orderId });
      } catch (error) {
        if (isUnknownOrderError(error)) {
          this.tradeLog.push("order", "订单已不存在，撤销跳过");
          this.pendingCancelOrders.delete(order.orderId);
        } else {
          this.tradeLog.push("error", `撤销订单失败: ${String(error)}`);
          this.pendingCancelOrders.delete(order.orderId);
        }
      }
    }
  }

  private emitUpdate(): void {
    const snapshot = this.buildSnapshot();
    const handlers = this.listeners.get("update");
    if (handlers) {
      handlers.forEach((handler) => handler(snapshot));
    }
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
      sessionVolume: this.sessionQuoteVolume,
      openOrders: this.openOrders,
      desiredOrders: this.desiredOrders,
      tradeLog: this.tradeLog.all(),
      lastUpdated: Date.now(),
    };
  }

  private updateSessionVolume(position: PositionSnapshot): void {
    const price = this.getReferencePrice();
    if (!this.initializedPosition) {
      this.prevPositionAmt = position.positionAmt;
      this.initializedPosition = true;
      return;
    }
    if (price == null) {
      this.prevPositionAmt = position.positionAmt;
      return;
    }
    const delta = Math.abs(position.positionAmt - this.prevPositionAmt);
    if (delta > 0) {
      this.sessionQuoteVolume += delta * price;
    }
    this.prevPositionAmt = position.positionAmt;
  }

  private getReferencePrice(): number | null {
    const bid = Number(this.depthSnapshot?.bids?.[0]?.[0]);
    const ask = Number(this.depthSnapshot?.asks?.[0]?.[0]);
    if (Number.isFinite(bid) && Number.isFinite(ask)) return (bid + ask) / 2;
    if (this.tickerSnapshot) {
      const last = Number(this.tickerSnapshot.lastPrice);
      if (Number.isFinite(last)) return last;
    }
    return null;
  }

}
