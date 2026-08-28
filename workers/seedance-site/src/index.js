const DEFAULT_ORIGIN = "https://seedance-site.pages.dev";

function getOrigin(env) {
  return String(env.SITE_ORIGIN || DEFAULT_ORIGIN).replace(/\/+$/, "");
}

function getDataKey(env) {
  return String(env.DATA_KEY || "data/prompts.json");
}

function cloneRequestForOrigin(request, originUrl) {
  const headers = new Headers(request.headers);
  headers.delete("Host");

  return new Request(originUrl, {
    method: request.method,
    headers,
    body: request.body,
    redirect: request.redirect
  });
}

function withCorsHeaders(headers, request) {
  const origin = request.headers.get("Origin");
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
  } else {
    headers.set("Access-Control-Allow-Origin", "*");
  }
  headers.set("Vary", "Origin");
  return headers;
}

async function serveDataFromR2(env, request) {
  const key = getDataKey(env);
  const object = await env.DATA.get(key);

  if (!object) {
    return new Response(JSON.stringify({ error: "Data not found", key }), {
      status: 404,
      headers: { "Content-Type": "application/json" }
    });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "public, max-age=300");
  headers.set("ETag", object.etag);
  withCorsHeaders(headers, request);

  return new Response(object.body, {
    headers
  });
}

export default {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(`${request.method} is not allowed`, {
        status: 405,
        headers: {
          Allow: "GET, HEAD"
        }
      });
    }

    const requestUrl = new URL(request.url);

    // Serve prompt data from R2 to bypass Pages 25 MiB file limit
    if (requestUrl.pathname === "/data/prompts.json") {
      return serveDataFromR2(env, request);
    }

    const originUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, getOrigin(env));
    const response = await fetch(cloneRequestForOrigin(request, originUrl));
    const headers = new Headers(response.headers);

    headers.set("X-Seedance-Origin", originUrl.hostname);
    withCorsHeaders(headers, request);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
};
