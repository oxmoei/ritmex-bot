import type { PositionSnapshot } from "./strategy";

export function shouldStopLoss(
  position: PositionSnapshot,
  bestBid: number,
  bestAsk: number,
  lossLimit: number
): boolean {
  const absPosition = Math.abs(position.positionAmt);
  if (absPosition < 1e-5) return false;

  const pnl = position.positionAmt > 0
    ? (bestBid - position.entryPrice) * absPosition
    : (position.entryPrice - bestAsk) * absPosition;

  const unrealized = Number.isFinite(position.unrealizedProfit)
    ? (position.unrealizedProfit as number)
    : null;

  const derivedLoss = pnl < -lossLimit;
  const snapshotLoss = Boolean(unrealized != null && unrealized < -lossLimit && pnl <= 0);

  return derivedLoss || snapshotLoss;
}


