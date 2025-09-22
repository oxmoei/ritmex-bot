export function toPrice1Decimal(price: number): number {
  return Math.floor(price * 10) / 10;
}

export function toQty3Decimal(qty: number): number {
  return Math.floor(qty * 1000) / 1000;
}

export function isNearlyZero(value: number, epsilon = 1e-5): boolean {
  return Math.abs(value) < epsilon;
}
