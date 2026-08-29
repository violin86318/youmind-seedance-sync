// Node's global fetch (undici) ignores the standard proxy environment
// variables, so outbound requests to proxies-required hosts (youmind.com from
// this network) time out. Callers that may need the proxy enable it explicitly.
let enabled = false;

export async function enableEnvProxy() {
  if (enabled) {
    return;
  }

  const proxyUrl =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    "";

  if (!proxyUrl) {
    return;
  }

  const { ProxyAgent, setGlobalDispatcher } = await import("undici");
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
  enabled = true;
}
