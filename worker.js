const UPSTREAM = "https://generativelanguage.googleapis.com";

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,x-goog-api-key",
    "access-control-max-age": "86400",
  };
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

function getApiKey(reqUrl, request) {
  const url = new URL(reqUrl);
  const qKey = url.searchParams.get("key");
  const hKey = request.headers.get("x-goog-api-key");
  return qKey || hKey || "";
}

function buildTargetUrl(reqUrl) {
  const inUrl = new URL(reqUrl);
  return new URL(`${UPSTREAM}${inUrl.pathname}${inUrl.search}`);
}

function cleanHeaders(headers) {
  const h = new Headers(headers);
  [
    "host",
    "connection",
    "content-length",
    "cf-connecting-ip",
    "x-forwarded-for",
    "x-real-ip",
    "accept-encoding",
  ].forEach((k) => h.delete(k));
  return h;
}

export default {
  async fetch(request) {
    const cors = corsHeaders();

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health") {
      return json(
        {
          ok: true,
          service: "gemini-open-proxy",
          usage: "Forward /v1/* and /v1beta/* to Gemini. Put key in query or x-goog-api-key.",
        },
        200,
        cors,
      );
    }

    if (!url.pathname.startsWith("/v1/") && !url.pathname.startsWith("/v1beta/")) {
      return json({ ok: false, error: "Not found" }, 404, cors);
    }

    const key = getApiKey(request.url, request);
    if (!key) {
      return json(
        {
          ok: false,
          error: "Missing key. Pass ?key=YOUR_GEMINI_KEY or header x-goog-api-key.",
        },
        400,
        cors,
      );
    }

    try {
      const target = buildTargetUrl(request.url);
      target.searchParams.set("key", key);

      const headers = cleanHeaders(request.headers);
      headers.delete("x-goog-api-key");

      const upstream = await fetch(target.toString(), {
        method: request.method,
        headers,
        body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
        redirect: "manual",
      });

      const outHeaders = new Headers(upstream.headers);
      Object.entries(cors).forEach(([k, v]) => outHeaders.set(k, v));
      outHeaders.set("x-proxy-by", "cf-gemini-open-proxy");

      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: outHeaders,
      });
    } catch (err) {
      return json(
        {
          ok: false,
          error: "Upstream request failed",
          details: String(err?.message || err),
        },
        502,
        cors,
      );
    }
  },
};
