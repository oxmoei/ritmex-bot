import type { AsterAccountSnapshot, AsterKline } from "../exchanges/types";

export interface PositionSnapshot {
  positionAmt: number;
  entryPrice: number;
  unrealizedProfit: number;
}

export function getPosition(snapshot: AsterAccountSnapshot | null, symbol: string): PositionSnapshot {
  if (!snapshot) {
    return { positionAmt: 0, entryPrice: 0, unrealizedProfit: 0 };
  }
  const positions = snapshot.positions?.filter((p) => p.symbol === symbol) ?? [];
  if (positions.length === 0) {
    return { positionAmt: 0, entryPrice: 0, unrealizedProfit: 0 };
  }
  const NON_ZERO_EPS = 1e-8;
  const withExposure = positions.filter((p) => Math.abs(Number(p.positionAmt)) > NON_ZERO_EPS);
  const selected =
    withExposure.find((p) => p.positionSide === "BOTH") ??
    withExposure.sort((a, b) => Math.abs(Number(b.positionAmt)) - Math.abs(Number(a.positionAmt)))[0] ??
    positions[0];
  return {
    positionAmt: Number(selected.positionAmt) || 0,
    entryPrice: Number(selected.entryPrice) || 0,
    unrealizedProfit: Number(selected.unrealizedProfit) || 0,
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
