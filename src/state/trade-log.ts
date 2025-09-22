export interface TradeLogEntry {
  time: string;
  type: string;
  detail: string;
}

export function createTradeLog(maxEntries: number) {
  const entries: TradeLogEntry[] = [];
  function push(type: string, detail: string) {
    entries.push({ time: new Date().toLocaleString(), type, detail });
    if (entries.length > maxEntries) {
      entries.shift();
    }
  }
  function all() {
    return entries;
  }
  return { push, all };
}
