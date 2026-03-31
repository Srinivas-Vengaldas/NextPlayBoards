import type { VercelResponse } from "@vercel/node";

export function sendJson(res: VercelResponse, status: number, payload: unknown) {
  res.status(status).setHeader("Content-Type", "application/json").send(JSON.stringify(payload));
}

export function sendError(res: VercelResponse, status: number, message: string) {
  sendJson(res, status, { error: message });
}

export async function readBody<T>(reqBody: unknown): Promise<T> {
  if (reqBody && typeof reqBody === "object") {
    return reqBody as T;
  }
  return {} as T;
}

export function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
