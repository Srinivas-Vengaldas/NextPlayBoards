export type ApiDebugReport = {
  apiBaseUrl: string;
  debugEndpoint: string;
  boardsEndpoint: string;
  debugStatus: number | null;
  boardsStatus: number | null;
  debugContentType: string | null;
  boardsContentType: string | null;
  debugBodyPreview: string | null;
  boardsBodyPreview: string | null;
};

function bodyPreview(body: string): string {
  const trimmed = body.trim();
  return trimmed.length > 280 ? `${trimmed.slice(0, 280)}...` : trimmed;
}

/**
 * Run lightweight API diagnostics in browser console.
 * Usage:
 *   import("./lib/debugApi").then((m) => m.runApiDiagnostics().then(console.log))
 */
export async function runApiDiagnostics(): Promise<ApiDebugReport> {
  const apiBaseUrl = (import.meta.env.VITE_API_URL?.replace(/\/$/, "") || "/api");
  const debugEndpoint = `${apiBaseUrl}/__debug`;
  const boardsEndpoint = `${apiBaseUrl}/boards`;

  let debugStatus: number | null = null;
  let boardsStatus: number | null = null;
  let debugContentType: string | null = null;
  let boardsContentType: string | null = null;
  let debugBodyPreview: string | null = null;
  let boardsBodyPreview: string | null = null;

  try {
    const debugRes = await fetch(debugEndpoint, { cache: "no-store" });
    debugStatus = debugRes.status;
    debugContentType = debugRes.headers.get("content-type");
    debugBodyPreview = bodyPreview(await debugRes.text());
  } catch (err) {
    debugBodyPreview = `request failed: ${String(err)}`;
  }

  try {
    const boardsRes = await fetch(boardsEndpoint, { cache: "no-store" });
    boardsStatus = boardsRes.status;
    boardsContentType = boardsRes.headers.get("content-type");
    boardsBodyPreview = bodyPreview(await boardsRes.text());
  } catch (err) {
    boardsBodyPreview = `request failed: ${String(err)}`;
  }

  return {
    apiBaseUrl,
    debugEndpoint,
    boardsEndpoint,
    debugStatus,
    boardsStatus,
    debugContentType,
    boardsContentType,
    debugBodyPreview,
    boardsBodyPreview,
  };
}
