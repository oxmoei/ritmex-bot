import { AsterAccountSnapshot, AsterKline } from "../exchanges/types";

export interface PositionSnapshot {
  positionAmt: number;
  entryPrice: number;
  unrealizedProfit: number;
}

export function getPosition(snapshot: AsterAccountSnapshot | null, symbol: string): PositionSnapshot {
  if (!snapshot) {
    return { positionAmt: 0, entryPrice: 0, unrealizedProfit: 0 };
  }
  const pos = snapshot.positions?.find((p) => p.symbol === symbol);
  if (!pos) {
    return { positionAmt: 0, entryPrice: 0, unrealizedProfit: 0 };
  }
  return {
    positionAmt: Number(pos.positionAmt),
    entryPrice: Number(pos.entryPrice),
    unrealizedProfit: Number(pos.unrealizedProfit),
  };
}

export function getSMA(values: AsterKline[], length: number): number | null {
  if (!values || values.length < length) return null;
  const closes = values.slice(-length).map((k) => Number(k.close));
  const sum = closes.reduce((acc, current) => acc + current, 0);
  return sum / closes.length;
}

export function calcStopLossPrice(entryPrice: number, qty: number, side: "long" | "short", loss: number): number {
  if (side === "long") {
    return entryPrice - loss / qty;
  }
  return entryPrice + loss / Math.abs(qty);
}

export function calcTrailingActivationPrice(entryPrice: number, qty: number, side: "long" | "short", profit: number): number {
  if (side === "long") {
    return entryPrice + profit / qty;
  }
  return entryPrice - profit / Math.abs(qty);
}
