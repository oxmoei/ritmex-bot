import type { TradingConfig } from "../config";
import type { ExchangeAdapter } from "../exchanges/adapter";
import type {
  AsterAccountSnapshot,
  AsterOrder,
  AsterTicker,
  AsterDepth,
  AsterKline,
} from "../exchanges/types";
import {
  calcStopLossPrice,
  calcTrailingActivationPrice,
  getPosition,
  getSMA,
  type PositionSnapshot,
} from "../utils/strategy";
import {
  marketClose,
  OrderLockMap,
  OrderPendingMap,
  OrderTimerMap,
  placeMarketOrder,
  placeStopLossOrder,
  placeTrailingStopOrder,
  unlockOperating,
} from "./order-coordinator";
import { toPrice1Decimal } from "../utils/math";
import { createTradeLog, type TradeLogEntry } from "../state/trade-log";

export interface TrendEngineSnapshot {
  ready: boolean;
  symbol: string;
  lastPrice: number | null;
  sma30: number | null;
  trend: "做多" | "做空" | "无信号";
  position: PositionSnapshot;
  pnl: number;
  unrealized: number;
  totalProfit: number;
  totalTrades: number;
  tradeLog: TradeLogEntry[];
  openOrders: AsterOrder[];
  depth: AsterDepth | null;
  ticker: AsterTicker | null;
  lastUpdated: number | null;
  lastOpenSignal: OpenOrderPlan;
}

export interface OpenOrderPlan {
  side: "BUY" | "SELL" | null;
  price: number | null;
}

type TrendEngineEvent = "update";

type TrendEngineListener = (snapshot: TrendEngineSnapshot) => void;

export class TrendEngine {
  private accountSnapshot: AsterAccountSnapshot | null = null;
  private openOrders: AsterOrder[] = [];
  private depthSnapshot: AsterDepth | null = null;
  private tickerSnapshot: AsterTicker | null = null;
  private klineSnapshot: AsterKline[] = [];

  private readonly locks: OrderLockMap = {};
  private readonly timers: OrderTimerMap = {};
  private readonly pending: OrderPendingMap = {};

  private readonly tradeLog: ReturnType<typeof createTradeLog>;

  private timer: ReturnType<typeof setInterval> | null = null;
  private processing = false;
  private lastPrice: number | null = null;
  private lastSma30: number | null = null;
  private totalProfit = 0;
  private totalTrades = 0;
  private lastOpenPlan: OpenOrderPlan = { side: null, price: null };

  private readonly listeners = new Map<TrendEngineEvent, Set<TrendEngineListener>>();

  constructor(private readonly config: TradingConfig, private readonly exchange: ExchangeAdapter) {
    this.tradeLog = createTradeLog(this.config.maxLogEntries);
    this.bootstrap();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.config.pollIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  on(event: TrendEngineEvent, handler: TrendEngineListener): void {
    const handlers = this.listeners.get(event) ?? new Set<TrendEngineListener>();
    handlers.add(handler);
    this.listeners.set(event, handlers);
  }

  off(event: TrendEngineEvent, handler: TrendEngineListener): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    handlers.delete(handler);
    if (handlers.size === 0) {
      this.listeners.delete(event);
    }
  }

  getSnapshot(): TrendEngineSnapshot {
    return this.buildSnapshot();
  }

  private bootstrap(): void {
    this.exchange.watchAccount((snapshot) => {
      this.accountSnapshot = snapshot;
      this.emitUpdate();
    });
    this.exchange.watchOrders((orders) => {
      this.synchronizeLocks(orders);
      this.openOrders = Array.isArray(orders)
        ? orders.filter((order) => order.type !== "MARKET")
        : [];
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
    this.exchange.watchKlines(this.config.symbol, this.config.klineInterval, (klines) => {
      this.klineSnapshot = klines;
      this.emitUpdate();
    });
  }

  private synchronizeLocks(orders: AsterOrder[]): void {
    Object.keys(this.pending).forEach((type) => {
      const pendingId = this.pending[type];
      if (!pendingId) return;
      const match = orders.find((order) => String(order.orderId) === pendingId);
      if (!match || (match.status && match.status !== "NEW")) {
        unlockOperating(this.locks, this.timers, this.pending, type);
      }
    });
  }

  private isReady(): boolean {
    return Boolean(
      this.accountSnapshot &&
        this.tickerSnapshot &&
        this.depthSnapshot &&
        this.klineSnapshot.length >= 30
    );
  }

  private async tick(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      if (!this.isReady()) {
        this.emitUpdate();
        return;
      }
      const sma30 = getSMA(this.klineSnapshot, 30);
      if (sma30 == null) {
        return;
      }
      const ticker = this.tickerSnapshot!;
      const price = Number(ticker.lastPrice);
      const position = getPosition(this.accountSnapshot, this.config.symbol);

      if (Math.abs(position.positionAmt) < 1e-5) {
        await this.handleOpenPosition(price, sma30);
      } else {
        const result = await this.handlePositionManagement(position, price);
        if (result.closed) {
          this.totalTrades += 1;
          this.totalProfit += result.pnl;
        }
      }

      this.lastSma30 = sma30;
      this.lastPrice = price;
      this.emitUpdate();
    } catch (error) {
      this.tradeLog.push("error", `策略循环异常: ${String(error)}`);
      this.emitUpdate();
    } finally {
      this.processing = false;
    }
  }

  private async handleOpenPosition(currentPrice: number, currentSma: number): Promise<void> {
    if (this.lastPrice == null) {
      this.lastPrice = currentPrice;
      return;
    }
    if (this.openOrders.length > 0) {
      try {
        await this.exchange.cancelAllOrders({ symbol: this.config.symbol });
      } catch (err) {
        this.tradeLog.push("error", `撤销挂单失败: ${String(err)}`);
      }
    }
    if (this.lastPrice > currentSma && currentPrice < currentSma) {
      await this.submitMarketOrder("SELL", currentPrice, "下穿SMA30，市价开空");
    } else if (this.lastPrice < currentSma && currentPrice > currentSma) {
      await this.submitMarketOrder("BUY", currentPrice, "上穿SMA30，市价开多");
    }
  }

  private async submitMarketOrder(side: "BUY" | "SELL", price: number, reason: string): Promise<void> {
    try {
      await placeMarketOrder(
        this.exchange,
        this.config.symbol,
        this.openOrders,
        this.locks,
        this.timers,
        this.pending,
        side,
        this.config.tradeAmount,
        (type, detail) => this.tradeLog.push(type, detail)
      );
      this.tradeLog.push("open", `${reason}: ${side} @ ${price}`);
      this.lastOpenPlan = { side, price };
    } catch (err) {
      this.tradeLog.push("error", `市价下单失败: ${String(err)}`);
    }
  }

  private async handlePositionManagement(
    position: PositionSnapshot,
    price: number
  ): Promise<{ closed: boolean; pnl: number }> {
    const direction = position.positionAmt > 0 ? "long" : "short";
    const pnl =
      (direction === "long"
        ? price - position.entryPrice
        : position.entryPrice - price) * Math.abs(position.positionAmt);
    const stopSide = direction === "long" ? "SELL" : "BUY";
    const stopPrice = calcStopLossPrice(
      position.entryPrice,
      Math.abs(position.positionAmt),
      direction,
      this.config.lossLimit
    );
    const activationPrice = calcTrailingActivationPrice(
      position.entryPrice,
      Math.abs(position.positionAmt),
      direction,
      this.config.trailingProfit
    );

    const currentStop = this.openOrders.find(
      (o) => o.type === "STOP_MARKET" && o.side === stopSide
    );
    const currentTrailing = this.openOrders.find(
      (o) => o.type === "TRAILING_STOP_MARKET" && o.side === stopSide
    );

    const profitLockStopPrice = direction === "long"
      ? toPrice1Decimal(
          position.entryPrice + this.config.profitLockOffsetUsd / Math.abs(position.positionAmt)
        )
      : toPrice1Decimal(
          position.entryPrice - this.config.profitLockOffsetUsd / Math.abs(position.positionAmt)
        );

    if (pnl > this.config.profitLockTriggerUsd || position.unrealizedProfit > this.config.profitLockTriggerUsd) {
      if (!currentStop) {
        await this.tryPlaceStopLoss(stopSide, profitLockStopPrice, price);
      } else {
        const existingPrice = Number(currentStop.stopPrice);
        if (Math.abs(existingPrice - profitLockStopPrice) > 0.01) {
          await this.tryReplaceStop(stopSide, currentStop, profitLockStopPrice, price);
        }
      }
    }

    if (!currentStop) {
      await this.tryPlaceStopLoss(stopSide, toPrice1Decimal(stopPrice), price);
    }

    if (!currentTrailing) {
      await this.tryPlaceTrailingStop(
        stopSide,
        toPrice1Decimal(activationPrice),
        Math.abs(position.positionAmt)
      );
    }

    if (pnl < -this.config.lossLimit || position.unrealizedProfit < -this.config.lossLimit) {
      try {
        if (this.openOrders.length > 0) {
          const orderIdList = this.openOrders.map((order) => order.orderId);
          await this.exchange.cancelOrders({ symbol: this.config.symbol, orderIdList });
        }
        await marketClose(
          this.exchange,
          this.config.symbol,
          this.openOrders,
          this.locks,
          this.timers,
          this.pending,
          direction === "long" ? "SELL" : "BUY",
          this.config.tradeAmount,
          (type, detail) => this.tradeLog.push(type, detail)
        );
        this.tradeLog.push("close", `止损平仓: ${direction === "long" ? "SELL" : "BUY"}`);
      } catch (err) {
        this.tradeLog.push("error", `止损平仓失败: ${String(err)}`);
      }
      return { closed: true, pnl };
    }

    return { closed: false, pnl };
  }

  private async tryPlaceStopLoss(
    side: "BUY" | "SELL",
    stopPrice: number,
    lastPrice: number
  ): Promise<void> {
    try {
      await placeStopLossOrder(
        this.exchange,
        this.config.symbol,
        this.openOrders,
        this.locks,
        this.timers,
        this.pending,
        side,
        stopPrice,
        this.config.tradeAmount,
        lastPrice,
        (type, detail) => this.tradeLog.push(type, detail)
      );
    } catch (err) {
      this.tradeLog.push("error", `挂止损单失败: ${String(err)}`);
    }
  }

  private async tryReplaceStop(
    side: "BUY" | "SELL",
    currentOrder: AsterOrder,
    nextStopPrice: number,
    lastPrice: number
  ): Promise<void> {
    try {
      await this.exchange.cancelOrder({ symbol: this.config.symbol, orderId: currentOrder.orderId });
    } catch (err) {
      this.tradeLog.push("error", `取消原止损单失败: ${String(err)}`);
    }
    await this.tryPlaceStopLoss(side, nextStopPrice, lastPrice);
    this.tradeLog.push("stop", `移动止损到 ${nextStopPrice}`);
  }

  private async tryPlaceTrailingStop(
    side: "BUY" | "SELL",
    activationPrice: number,
    quantity: number
  ): Promise<void> {
    try {
      await placeTrailingStopOrder(
        this.exchange,
        this.config.symbol,
        this.openOrders,
        this.locks,
        this.timers,
        this.pending,
        side,
        activationPrice,
        quantity,
        this.config.trailingCallbackRate,
        (type, detail) => this.tradeLog.push(type, detail)
      );
    } catch (err) {
      this.tradeLog.push("error", `挂动态止盈失败: ${String(err)}`);
    }
  }

  private emitUpdate(): void {
    const snapshot = this.buildSnapshot();
    const handlers = this.listeners.get("update");
    if (!handlers) return;
    handlers.forEach((handler) => handler(snapshot));
  }

  private buildSnapshot(): TrendEngineSnapshot {
    const position = getPosition(this.accountSnapshot, this.config.symbol);
    const price = this.tickerSnapshot ? Number(this.tickerSnapshot.lastPrice) : null;
    const sma30 = this.lastSma30;
    const trend = price == null || sma30 == null
      ? "无信号"
      : price > sma30
      ? "做多"
      : price < sma30
      ? "做空"
      : "无信号";
    const pnl = price != null && position
      ? (position.positionAmt > 0
          ? (price - position.entryPrice) * Math.abs(position.positionAmt)
          : (position.entryPrice - price) * Math.abs(position.positionAmt))
      : 0;
    return {
      ready: this.isReady(),
      symbol: this.config.symbol,
      lastPrice: price,
      sma30,
      trend,
      position,
      pnl,
      unrealized: position.unrealizedProfit,
      totalProfit: this.totalProfit,
      totalTrades: this.totalTrades,
      tradeLog: this.tradeLog.all(),
      openOrders: this.openOrders,
      depth: this.depthSnapshot,
      ticker: this.tickerSnapshot,
      lastUpdated: Date.now(),
      lastOpenSignal: this.lastOpenPlan,
    };
  }
}
