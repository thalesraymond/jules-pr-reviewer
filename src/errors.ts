export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (error !== null && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return String(error);
}
