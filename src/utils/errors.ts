export function isUnknownOrderError(error: unknown): boolean {
  const message = extractMessage(error);
  if (!message) return false;
  return message.includes("Unknown order") || message.includes("code\":-2011");
}

export function extractMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
