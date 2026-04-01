export async function callJsonApi(path, body = undefined, options = {}) {
  const method = String(options.method || "POST").toUpperCase();
  const headers = new Headers(options.headers || {});

  if (!headers.has("Content-Type") && body !== undefined && method !== "GET" && method !== "HEAD") {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    method,
    headers,
    body:
      body === undefined || method === "GET" || method === "HEAD"
        ? undefined
        : headers.get("Content-Type")?.includes("application/json")
          ? JSON.stringify(body)
          : body,
    signal: options.signal
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}
