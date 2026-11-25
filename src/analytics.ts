// Anonymous usage counts via GoatCounter (https://www.goatcounter.com): no cookies,
// no personal data. We call GoatCounter's counting endpoint directly instead of loading
// its script. Set GOATCOUNTER_CODE to "" to turn counting off (e.g. in a fork).

export const GOATCOUNTER_CODE = "";

const enabled = () =>
  GOATCOUNTER_CODE !== "" && typeof location !== "undefined" && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

const base = () => `https://${GOATCOUNTER_CODE}.goatcounter.com`;

function send(params: Record<string, string>) {
  if (!enabled()) return;
  const q = new URLSearchParams({ ...params, rnd: Math.random().toString(36).slice(2) });
  // A pixel request: works cross-origin without CORS and can't fail loudly.
  new Image().src = `${base()}/count?${q}`;
}

export function countPageView() {
  send({
    p: location.pathname,
    t: document.title,
    r: document.referrer,
    s: `${screen.width},${screen.height},${devicePixelRatio || 1}`,
  });
}

export function countEvent(name: "game-start" | "game-finish", label: string) {
  send({ p: name, t: label, e: "true" });
}

/**
 * Public totals, if "Allow adding visitor counts on your website" is enabled in
 * GoatCounter's settings. Returns null when counting is off or the counts aren't public.
 */
export async function fetchPublicCount(path: "TOTAL" | "game-start"): Promise<string | null> {
  if (!enabled()) return null;
  try {
    const res = await fetch(`${base()}/counter/${encodeURIComponent(path)}.json`);
    if (!res.ok) return null;
    const json = (await res.json()) as { count?: string };
    return json.count?.trim() || null;
  } catch {
    return null;
  }
}
