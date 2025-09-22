import type {
  AccountListener,
  DepthListener,
  ExchangeAdapter,
  KlineListener,
  OrderListener,
  TickerListener,
} from "./adapter";
import type { AsterOrder, CreateOrderParams, AsterDepth, AsterTicker, AsterKline } from "./types";
import { AsterGateway } from "./aster/client";

export interface AsterCredentials {
  apiKey?: string;
  apiSecret?: string;
  symbol?: string;
}

export class AsterExchangeAdapter implements ExchangeAdapter {
  readonly id = "aster";
  private readonly gateway: AsterGateway;
  private readonly symbol: string;
  private initPromise: Promise<void> | null = null;

  constructor(credentials: AsterCredentials = {}) {
    this.gateway = new AsterGateway({ apiKey: credentials.apiKey, apiSecret: credentials.apiSecret });
    this.symbol = (credentials.symbol ?? process.env.TRADE_SYMBOL ?? "BTCUSDT").toUpperCase();
  }

  private ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.gateway.ensureInitialized(this.symbol);
    }
    return this.initPromise;
  }

  watchAccount(cb: AccountListener): void {
    void this.ensureInitialized();
    this.gateway.onAccount((snapshot) => {
      cb(snapshot);
    });
  }

  watchOrders(cb: OrderListener): void {
    void this.ensureInitialized();
    this.gateway.onOrders((orders) => {
      cb(orders);
    });
  }

  watchDepth(symbol: string, cb: DepthListener): void {
    void this.ensureInitialized();
    this.gateway.onDepth(symbol, (depth: AsterDepth) => {
      cb(depth);
    });
  }

  watchTicker(symbol: string, cb: TickerListener): void {
    void this.ensureInitialized();
    this.gateway.onTicker(symbol, (ticker: AsterTicker) => {
      cb(ticker);
    });
  }

  watchKlines(symbol: string, interval: string, cb: KlineListener): void {
    void this.ensureInitialized();
    this.gateway.onKlines(symbol, interval, (klines: AsterKline[]) => {
      cb(klines);
    });
  }

  async createOrder(params: CreateOrderParams): Promise<AsterOrder> {
    await this.ensureInitialized();
    return this.gateway.createOrder(params);
  }

  async cancelOrder(params: { symbol: string; orderId: number | string }): Promise<void> {
    await this.ensureInitialized();
    await this.gateway.cancelOrder({ symbol: params.symbol, orderId: Number(params.orderId) });
  }

  async cancelOrders(params: { symbol: string; orderIdList: Array<number | string> }): Promise<void> {
    await this.ensureInitialized();
    await this.gateway.cancelOrders({ symbol: params.symbol, orderIdList: params.orderIdList });
  }

  async cancelAllOrders(params: { symbol: string }): Promise<void> {
    await this.ensureInitialized();
    await this.gateway.cancelAllOrders(params);
  }
}
