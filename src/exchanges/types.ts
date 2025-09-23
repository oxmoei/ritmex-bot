export type StringBoolean = "true" | "false";

export type OrderSide = "BUY" | "SELL";
export type OrderType =
  | "LIMIT"
  | "MARKET"
  | "STOP_MARKET"
  | "TRAILING_STOP_MARKET";
export type PositionSide = "BOTH" | "LONG" | "SHORT";
export type TimeInForce = "GTC" | "IOC" | "FOK" | "GTX";

export interface CreateOrderParams {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  quantity?: number;
  price?: number;
  stopPrice?: number;
  activationPrice?: number;
  callbackRate?: number;
  timeInForce?: TimeInForce;
  reduceOnly?: StringBoolean;
  closePosition?: StringBoolean;
}

export interface AsterAccountPosition {
  symbol: string;
  positionAmt: string;
  entryPrice: string;
  unrealizedProfit: string;
  positionSide: PositionSide;
  updateTime: number;
  initialMargin?: string;
  maintMargin?: string;
  positionInitialMargin?: string;
  openOrderInitialMargin?: string;
  leverage?: string;
  isolated?: boolean;
  maxNotional?: string;
  marginType?: string;
  isolatedMargin?: string;
  isAutoAddMargin?: string;
  liquidationPrice?: string;
  markPrice?: string;
}

export interface AsterAccountAsset {
  asset: string;
  walletBalance: string;
  availableBalance: string;
  updateTime: number;
  unrealizedProfit?: string;
  marginBalance?: string;
  maintMargin?: string;
  initialMargin?: string;
  positionInitialMargin?: string;
  openOrderInitialMargin?: string;
  crossWalletBalance?: string;
  crossUnPnl?: string;
  maxWithdrawAmount?: string;
  marginAvailable?: boolean;
}

export interface AsterAccountSnapshot {
  canTrade: boolean;
  canDeposit: boolean;
  canWithdraw: boolean;
  updateTime: number;
  totalWalletBalance: string;
  totalUnrealizedProfit: string;
  totalMarginBalance?: string;
  totalInitialMargin?: string;
  totalMaintMargin?: string;
  totalPositionInitialMargin?: string;
  totalOpenOrderInitialMargin?: string;
  totalCrossWalletBalance?: string;
  totalCrossUnPnl?: string;
  availableBalance?: string;
  maxWithdrawAmount?: string;
  positions: AsterAccountPosition[];
  assets: AsterAccountAsset[];
}

export interface AsterDepthLevel extends Array<string> {
  0: string; // price
  1: string; // quantity
}

export interface AsterDepth {
  lastUpdateId: number;
  bids: AsterDepthLevel[];
  asks: AsterDepthLevel[];
  eventTime?: number;
  eventType?: string;
  tradeTime?: number;
  symbol?: string;
}

export interface AsterTicker {
  symbol: string;
  lastPrice: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  eventTime?: number;
  eventType?: string;
  priceChange?: string;
  priceChangePercent?: string;
  weightedAvgPrice?: string;
  lastQty?: string;
  openTime?: number;
  closeTime?: number;
  firstId?: number;
  lastId?: number;
  count?: number;
}

export interface AsterKline {
  eventType?: string;
  eventTime?: number;
  symbol?: string;
  interval?: string;
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  closeTime: number;
  firstTradeId?: number;
  lastTradeId?: number;
  quoteAssetVolume?: string;
  numberOfTrades: number;
  takerBuyBaseAssetVolume?: string;
  takerBuyQuoteAssetVolume?: string;
  isClosed?: boolean;
}

export interface AsterOrder {
  orderId: number;
  clientOrderId: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  status: string;
  price: string;
  origQty: string;
  executedQty: string;
  stopPrice: string;
  time: number;
  updateTime: number;
  reduceOnly: boolean;
  closePosition: boolean;
  workingType?: string;
  avgPrice?: string;
  cumQuote?: string;
  origType?: string;
  positionSide?: PositionSide;
  timeInForce?: TimeInForce;
  activatePrice?: string;
  priceRate?: string;
  priceProtect?: boolean;
}
