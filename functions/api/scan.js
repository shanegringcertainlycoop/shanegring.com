/**
 * Site Readiness Scan — Cloudflare Pages Function (POST /api/scan)
 *
 * Fetches a target URL, extracts machine-legibility / SEO / build signals,
 * sends them to Claude with a scoring rubric, returns structured JSON the
 * /scan page renders. Posts the lead + full result to a Google Apps Script
 * web app (LEAD_SHEET_URL), which logs the row, emails Shane, and emails the
 * visitor their copy.
 *
 * Required bindings (Cloudflare Pages → Settings):
 *   ANTHROPIC_API_KEY   secret    Anthropic API key (server-side only)
 *   SCAN_KV             KV        rate limiting + monthly cap counter
 * Optional:
 *   LEAD_SHEET_URL      var       Apps Script web-app URL (logs row + sends emails)
 *   SCAN_MODEL          var       model id (default claude-sonnet-4-6)
 *   SCAN_MODEL_FALLBACK var       model tried when the primary fails twice (default claude-haiku-4-5)
 *   SCAN_MONTHLY_CAP    var       max scans/month (default 400)
 *   SCAN_IP_HOURLY      var       max scans/IP/hour (default 3)
 *
 * Health: GET /api/scan?health=1 → { ok, kv, anthropic_key_present,
 * last_success, failures_today }. Contingency activations log with the
 * "scan-health:" prefix for Cloudflare observability.
 */

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_FALLBACK_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_MONTHLY_CAP = 400;
const DEFAULT_IP_HOURLY = 3;
const FETCH_TIMEOUT_MS = 9000;
// First try, retry, fallback — sized so a scan where every contingency fires
// still finishes before the frontend gives up at 90s.
const MODEL_TIMEOUT_MS = 28000;
const MODEL_RETRY_TIMEOUT_MS = 18000;
const MODEL_FALLBACK_TIMEOUT_MS = 14000;
const MAX_HTML_BYTES = 600 * 1024;
const UA = "Mozilla/5.0 (compatible; ShaneGring-SiteReadinessScan/1.0; +https://shanegring.com/scan)";

// Guide catalog the model may cite in opportunities. Slugs must match live
// pages under /guides/; unknown slugs are dropped server-side. The hint tells
// the model when a guide fits.
const GUIDES = {
  "can-ai-read-my-website": {
    title: "Can AI read your website?",
    hint: "machine readability overall: client-side rendering hiding content, missing structure, whether AI engines can read the site at all",
  },
  "why-your-website-isnt-bringing-in-clients": {
    title: "Why your website isn't bringing in clients",
    hint: "the site looks fine but produces no inquiries; conversion and legibility leaks",
  },
  "everything-runs-through-you": {
    title: "Everything in your business still runs through you",
    hint: "founder dependency; the operating logic lives in one person, not the site or systems",
  },
  "redesign-wont-fix-it": {
    title: "Thinking about a website redesign? Read this first",
    hint: "replatform-vs-redesign decisions; the site is a static endpoint rather than a surface to build on",
  },
  "your-website-was-true-at-launch": {
    title: "Your website was true the day it launched",
    hint: "stale content; the site no longer matches the business; no update rhythm or owner",
  },
  "build-a-content-layer": {
    title: "Your site needs a content layer, not more blog posts",
    hint: "thin brochure content, low word count, no pages answering buyer questions, no organic search surface",
  },
  "one-page-per-service": {
    title: "One page per service",
    hint: "offers buried on a single services page; each service needs its own addressable landing page",
  },
  "schema-for-services": {
    title: "Schema markup for service businesses, in plain English",
    hint: "missing or thin JSON-LD; machines inferring the business instead of being told",
  },
  "should-i-block-ai-crawlers": {
    title: "Should you block AI crawlers?",
    hint: "robots.txt blocking or not addressing AI bots; missing llms.txt; crawl and AI access policy",
  },
  "seo-basics-that-cost-nothing": {
    title: "The search signals that cost nothing",
    hint: "missing or multiple H1s, heading order, weak link text, missing alt text, meta description, canonical, sitemap basics",
  },
};

function guideList() {
  return Object.keys(GUIDES)
    .map(function (slug) { return slug + " — " + GUIDES[slug].hint; })
    .join("\n");
}

// Resolve the model's guide slugs into {slug,title,url}; drop unknown slugs.
function resolveGuides(opportunities) {
  return (opportunities || []).map(function (o) {
    const out = { title: o.title, detail: o.detail };
    const g = o.guide && GUIDES[o.guide];
    if (g) {
      out.guide = {
        slug: o.guide,
        title: g.title,
        url: "https://shanegring.com/guides/" + o.guide,
      };
    }
    return out;
  });
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function fail(message, status) {
  return json({ error: message }, status || 400);
}

function isValidEmail(e) {
  return typeof e === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;
}

// Block localhost / private / link-local / metadata hosts (SSRF guard).
function isBlockedHost(host) {
  host = host.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host === "0.0.0.0" || host === "169.254.169.254" || host === "metadata.google.internal") return true;
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
}

function normalizeUrl(raw) {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  let u;
  try { u = new URL(s); } catch (e) { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!u.hostname || u.hostname.indexOf(".") === -1) return null;
  if (isBlockedHost(u.hostname)) return null;
  return u;
}

async function fetchText(url, opts) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), (opts && opts.timeout) || FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": UA, "Accept": (opts && opts.accept) || "text/html,*/*" },
      redirect: "follow",
      signal: ctrl.signal,
      cf: { cacheTtl: 0 },
    });
    const status = res.status;
    let text = "";
    if (res.body) {
      const reader = res.body.getReader();
      const dec = new TextDecoder("utf-8", { fatal: false });
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        text += dec.decode(value, { stream: true });
        if (received >= ((opts && opts.maxBytes) || MAX_HTML_BYTES)) { try { reader.cancel(); } catch (e) {} break; }
      }
      text += dec.decode();
    }
    return { status, text, finalUrl: res.url };
  } finally {
    clearTimeout(t);
  }
}

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

// Decide what to tell the visitor when their page couldn't be read.
// Returns null when the page is usable; otherwise { code, httpStatus, message }.
const BLOCKED_STATUSES = { 401: 1, 403: 1, 406: 1, 429: 1, 503: 1 };
function classifyFetchFailure(page) {
  if (!page) {
    return {
      code: "unreachable",
      httpStatus: 502,
      message: "Couldn't reach that site — it may be down, very slow, or the address may be wrong. Check the URL and try again. Failed scans don't count against your allowance.",
    };
  }
  if (BLOCKED_STATUSES[page.status]) {
    return {
      code: "bot_blocked",
      httpStatus: 502,
      message: "That site turns away automated readers (it answered " + page.status + "). That's a finding in itself — AI engines hit the same wall when they try to read it. The Read covers sites like this by hand.",
    };
  }
  if (page.status >= 400) {
    return {
      code: "http_error",
      httpStatus: 502,
      message: "That site returned an error (" + page.status + "). Check the URL and try again.",
    };
  }
  if (!page.text) {
    return {
      code: "empty",
      httpStatus: 502,
      message: "That site sent back an empty page. Check the URL and try again.",
    };
  }
  return null;
}

function countMatches(re, s) {
  const m = s.match(re);
  return m ? m.length : 0;
}

function parseLocs(xml) {
  const locs = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) locs.push(m[1]);
  return locs;
}

// Read the sitemap for what it actually says: how many URLs, where they live.
// Follows a sitemap index into up to 5 same-host child sitemaps. Marks the
// count partial whenever a fetch was truncated or a child was skipped, so the
// model can say "at least N" instead of guessing.
async function analyzeSitemap(host, xml) {
  const out = { present: false, is_index: false, url_count: 0, count_is_partial: false, top_paths: {} };
  if (!xml) return out;
  const isIndex = xml.indexOf("<sitemapindex") !== -1;
  const isUrlset = xml.indexOf("<urlset") !== -1;
  if (!isIndex && !isUrlset) return out;
  out.present = true;
  out.is_index = isIndex;

  let locs = parseLocs(xml);
  if (!/<\/(urlset|sitemapindex)>/i.test(xml)) out.count_is_partial = true;

  if (isIndex) {
    const children = locs.slice(0, 5);
    if (locs.length > 5) out.count_is_partial = true;
    locs = [];
    const fetched = await Promise.allSettled(children.map(function (c) {
      let cu;
      try { cu = new URL(c); } catch (e) { return Promise.reject(new Error("bad child url")); }
      if (cu.hostname !== host || isBlockedHost(cu.hostname)) return Promise.reject(new Error("cross-host child"));
      return fetchText(cu.href, { maxBytes: 256 * 1024, accept: "application/xml", timeout: 8000 });
    }));
    fetched.forEach(function (r) {
      if (r.status !== "fulfilled" || r.value.status !== 200) { out.count_is_partial = true; return; }
      if (!/<\/urlset>/i.test(r.value.text)) out.count_is_partial = true;
      locs = locs.concat(parseLocs(r.value.text));
    });
  }

  out.url_count = locs.length;
  const buckets = {};
  locs.forEach(function (l) {
    let p;
    try { p = new URL(l).pathname; } catch (e) { return; }
    const seg = p.split("/")[1] || "";
    buckets["/" + (seg ? seg + "/" : "")] = (buckets["/" + (seg ? seg + "/" : "")] || 0) + 1;
  });
  Object.keys(buckets).sort(function (a, b) { return buckets[b] - buckets[a]; }).slice(0, 8)
    .forEach(function (k) { out.top_paths[k] = buckets[k]; });
  return out;
}

function extractSignals(html, robots, llms, sitemapInfo, host) {
  const lower = html.toLowerCase();
  const head = (html.match(/<head[\s\S]*?<\/head>/i) || [""])[0];

  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ""])[1].trim().slice(0, 200);
  const metaDesc = (head.match(/<meta[^>]+name=["']description["'][^>]*>/i) || [""])[0]
    .match(/content=["']([^"']*)["']/i);
  const description = metaDesc ? metaDesc[1].trim().slice(0, 300) : "";

  const ogCount = countMatches(/<meta[^>]+property=["']og:[^"']+["']/gi, head);
  const twitterCount = countMatches(/<meta[^>]+name=["']twitter:[^"']+["']/gi, head);
  const hasCanonical = /<link[^>]+rel=["']canonical["']/i.test(head);
  const hasViewport = /<meta[^>]+name=["']viewport["']/i.test(head);

  const headings = {};
  for (let i = 1; i <= 6; i++) headings["h" + i] = countMatches(new RegExp("<h" + i + "[\\s>]", "gi"), html);

  const landmarks = {};
  ["header", "nav", "main", "footer", "article", "section", "aside"].forEach(function (tag) {
    landmarks[tag] = countMatches(new RegExp("<" + tag + "[\\s>]", "gi"), html);
  });

  const divCount = countMatches(/<div[\s>]/gi, html);
  const semanticCount = Object.keys(landmarks).reduce(function (a, k) { return a + landmarks[k]; }, 0);

  const imgTotal = countMatches(/<img[\s>]/gi, html);
  const imgWithAlt = countMatches(/<img[^>]+alt=["'][^"']*["']/gi, html);

  // JSON-LD blocks + @type values
  const ldBlocks = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [];
  const ldTypes = [];
  ldBlocks.forEach(function (b) {
    const inner = b.replace(/<[^>]+>/g, "");
    const types = inner.match(/"@type"\s*:\s*"([^"]+)"/g) || [];
    types.forEach(function (t) { ldTypes.push(t.replace(/.*"([^"]+)"$/, "$1")); });
  });

  // Generic / weak link text
  const linkTexts = html.match(/<a[^>]*>([\s\S]*?)<\/a>/gi) || [];
  let weakLinks = 0;
  linkTexts.forEach(function (a) {
    const t = a.replace(/<[^>]+>/g, "").trim().toLowerCase();
    if (t === "click here" || t === "read more" || t === "here" || t === "learn more" || t === "more") weakLinks++;
  });

  // Internal links: how much of the site this one page actually surfaces.
  const hrefTags = html.match(/<a[^>]+href=["'][^"'#]+["']/gi) || [];
  const internalPaths = {};
  let internalLinks = 0;
  hrefTags.forEach(function (a) {
    const hm = a.match(/href=["']([^"'#]+)["']/i);
    if (!hm) return;
    const href = hm[1].trim();
    let path = null;
    if (/^https?:\/\//i.test(href)) {
      try {
        const hu = new URL(href);
        if (hu.hostname === host || hu.hostname === "www." + host || "www." + hu.hostname === host) path = hu.pathname;
      } catch (e) {}
    } else if (href.charAt(0) === "/" && href.charAt(1) !== "/") {
      path = href.split("?")[0];
    }
    if (path !== null) {
      internalLinks++;
      internalPaths[path.replace(/\/$/, "") || "/"] = true;
    }
  });

  // Visible text volume (strip script/style/tags) — thin body hints at client-rendering
  const bodyOnly = (html.match(/<body[\s\S]*?<\/body>/i) || [html])[0]
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const wordCount = bodyOnly ? bodyOnly.split(" ").length : 0;
  const scriptCount = countMatches(/<script[\s>]/gi, html);

  // robots.txt AI-bot posture
  const robotsLower = (robots || "").toLowerCase();
  const aiBots = ["gptbot", "claudebot", "perplexitybot", "google-extended", "anthropic-ai"];
  let robotsMentionsAi = false, robotsDisallowsAll = false;
  aiBots.forEach(function (b) { if (robotsLower.indexOf(b) !== -1) robotsMentionsAi = true; });
  if (/user-agent:\s*\*[\s\S]*?disallow:\s*\/\s*(\n|$)/i.test(robotsLower)) robotsDisallowsAll = true;

  return {
    title: title,
    has_title: !!title,
    meta_description: description,
    has_meta_description: !!description,
    has_canonical: hasCanonical,
    has_viewport: hasViewport,
    open_graph_tags: ogCount,
    twitter_tags: twitterCount,
    headings: headings,
    multiple_h1: headings.h1 > 1,
    missing_h1: headings.h1 === 0,
    landmarks: landmarks,
    has_main: landmarks.main > 0,
    div_count: divCount,
    semantic_element_count: semanticCount,
    div_to_semantic_ratio: semanticCount ? +(divCount / semanticCount).toFixed(1) : divCount,
    images_total: imgTotal,
    images_with_alt: imgWithAlt,
    alt_coverage_pct: imgTotal ? Math.round((imgWithAlt / imgTotal) * 100) : 100,
    jsonld_blocks: ldBlocks.length,
    jsonld_types: Array.from(new Set(ldTypes)).slice(0, 12),
    weak_link_text_count: weakLinks,
    internal_link_count: internalLinks,
    internal_unique_paths: Object.keys(internalPaths).length,
    visible_word_count: wordCount,
    script_count: scriptCount,
    likely_client_rendered: wordCount < 250 && scriptCount > 3,
    robots_txt_present: !!(robots && robots.length),
    robots_mentions_ai_bots: robotsMentionsAi,
    robots_disallows_all: robotsDisallowsAll,
    llms_txt_present: !!(llms && llms.length),
    sitemap_xml_present: sitemapInfo.present,
    sitemap_is_index: sitemapInfo.is_index,
    sitemap_url_count: sitemapInfo.url_count,
    sitemap_url_count_is_partial: sitemapInfo.count_is_partial,
    sitemap_top_paths: sitemapInfo.top_paths,
  };
}

const SYSTEM_PROMPT =
"You are Shane Gring's read on a website. Shane rebuilds operations for growing businesses and treats AI as the current best tool for the work. " +
"You are looking at one site through four lenses, using extracted signals from its HTML and its robots.txt / llms.txt / sitemap. " +
"You see ONE fetched page plus those crawl files — not the whole site. The sitemap numbers are the ground truth for how much content exists; the fetched page shows how much of it gets surfaced. " +
"Never claim content, a blog, or a content layer does not exist when sitemap_url_count says otherwise. If the sitemap lists URLs this page never links to, the finding is that this page hides the content layer — not that there is none. " +
"Be specific to THIS site — point at what the signals actually show. Voice: plain, second-person, declarative. Short sentences. Mostly plain English, not jargon. " +
"No filler, no hedging. Do not use the words 'leverage', 'utilize', 'robust', 'seamless', or 'in today's landscape'. " +
"Score each lens 0-100 (be honest — a real brochure site scores low on lenses 2 and 3). " +
"For each lens write a 2-4 sentence read: what's true, and what it costs them. " +
"Then give one or two named, high-leverage moves for THIS specific site. Name the move and why it matters; do not write the step-by-step — the detailed how is a follow-up, not this scan.\n\n" +
"Lens 1 — Can AI read it? Semantic structure and heading order, schema/JSON-LD, meta + Open Graph + a real title, llms.txt and robots crawlability for AI agents, alt and link text, and whether the real content is in the HTML or rendered client-side where agents may miss it.\n" +
"Lens 2 — Can it drive its own SEO and content? Judge the SITE's content layer from sitemap_url_count and sitemap_top_paths (when sitemap_url_count_is_partial is true, treat the count as 'at least'), and THIS page from visible_word_count and internal_link_count / internal_unique_paths. A big sitemap behind a page that surfaces little of it is a surfacing problem, not a missing-content problem — score and write it that way. Also weigh whether content looks templated/extendable and indexability basics.\n" +
"Lens 3 — Could it be a surface you build on? How componentized/templated the build looks, whether you could spin up landing pages and variations fast, static endpoint vs a platform you extend.\n" +
"Lens 4 — The opportunity. The operator's read: the highest-leverage moves for this site, in plain language. Open the loop — name what's worth doing without fully prescribing how.\n\n" +
"Return exactly four lenses in order (titles: 'Can AI read it?', 'Can it drive its own SEO and content?', 'Could it be a surface you build on?', 'The opportunity') and one or two opportunities. " +
"The 'overall' score is your weighted judgement of the whole, not a simple average.\n\n" +
"For each opportunity, set 'guide' to the slug of the ONE guide below that most directly helps with that specific move, or null when none genuinely fits. " +
"Never stretch a guide to fit — a null is better than a loose match.\n" +
"Available guides:\n" +
guideList();

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    overall: { type: "integer" },
    lenses: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          score: { type: "integer" },
          read: { type: "string" },
        },
        required: ["title", "score", "read"],
        additionalProperties: false,
      },
    },
    opportunities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          detail: { type: "string" },
          guide: { type: ["string", "null"] },
        },
        required: ["title", "detail", "guide"],
        additionalProperties: false,
      },
    },
  },
  required: ["overall", "lenses", "opportunities"],
  additionalProperties: false,
};

// One attempt against one model. Throws Error with .retryable set: 429/5xx,
// network errors, timeouts, and malformed responses are retryable; 4xx like a
// bad key is not (retrying can't fix it).
async function callModelOnce(env, model, userContent, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(function () { ctrl.abort(); }, timeoutMs);
  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
        messages: [{ role: "user", content: userContent }],
      }),
      signal: ctrl.signal,
    });
  } catch (e) {
    const err = new Error("anthropic network/timeout: " + e);
    err.retryable = true;
    throw err;
  } finally {
    clearTimeout(t);
  }

  if (!res.ok) {
    const body = await res.text().catch(function () { return ""; });
    const err = new Error("anthropic " + res.status + ": " + body.slice(0, 300));
    err.retryable = res.status === 429 || res.status >= 500;
    throw err;
  }
  try {
    const data = await res.json();
    const textBlock = (data.content || []).find(function (b) { return b.type === "text"; });
    return JSON.parse(textBlock.text);
  } catch (e) {
    const err = new Error("anthropic malformed response: " + e);
    err.retryable = true;
    throw err;
  }
}

// The read, with contingencies: one retry on the primary model, then one try
// on a cheaper fallback model. A degraded read beats no read.
async function runModel(env, site, signals) {
  const model = env.SCAN_MODEL || DEFAULT_MODEL;
  const userContent =
    "Site: " + site + "\n\nExtracted signals (JSON):\n" + JSON.stringify(signals, null, 1);

  try {
    return await callModelOnce(env, model, userContent, MODEL_TIMEOUT_MS);
  } catch (e) {
    if (!e.retryable) throw e;
    console.log("scan-health: model call failed, retrying: " + e.message);
    await sleep(1000);
    try {
      return await callModelOnce(env, model, userContent, MODEL_RETRY_TIMEOUT_MS);
    } catch (e2) {
      const fallback = env.SCAN_MODEL_FALLBACK || DEFAULT_FALLBACK_MODEL;
      if (!e2.retryable || !fallback || fallback === model) throw e2;
      console.log("scan-health: model retry failed, using fallback " + fallback + ": " + e2.message);
      return await callModelOnce(env, fallback, userContent, MODEL_FALLBACK_TIMEOUT_MS);
    }
  }
}

// Lead capture + notification. The Apps Script behind LEAD_SHEET_URL receives
// the full scan payload and is responsible for: appending the lead row,
// emailing Shane the result, and emailing the visitor their copy. Best-effort;
// runs in the background and never blocks the user's result.
async function captureLead(env, ctx, payload) {
  if (!env.LEAD_SHEET_URL) {
    console.log("scan: LEAD_SHEET_URL not configured; lead not captured");
    return;
  }

  const task = fetch(env.LEAD_SHEET_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then(async function (r) {
    if (!r.ok) {
      const b = await r.text().catch(function () { return ""; });
      console.log("scan lead capture failed: " + r.status + " " + b.slice(0, 200));
    }
  }).catch(function (e) { console.log("scan lead capture error: " + e); });

  if (ctx && ctx.waitUntil) ctx.waitUntil(task); else await task;
}

// Rate check only — counting moved to recordScan so failed scans don't spend
// quota. A KV failure fails OPEN: a broken counter must never stop the scan.
async function checkAndCount(env, ip) {
  if (!env.SCAN_KV) return { ok: true };
  try {
    const now = new Date();
    const month = now.getUTCFullYear() + "-" + String(now.getUTCMonth() + 1).padStart(2, "0");
    const hourBucket = month + "-" + String(now.getUTCDate()).padStart(2, "0") + "-" + String(now.getUTCHours()).padStart(2, "0");
    const ipKey = "ip:" + ip + ":" + hourBucket;
    const monthKey = "month:" + month;
    const ipHourly = parseInt(env.SCAN_IP_HOURLY, 10) || DEFAULT_IP_HOURLY;
    const monthlyCap = parseInt(env.SCAN_MONTHLY_CAP, 10) || DEFAULT_MONTHLY_CAP;

    const [ipVal, monthVal] = await Promise.all([env.SCAN_KV.get(ipKey), env.SCAN_KV.get(monthKey)]);
    const ipN = parseInt(ipVal, 10) || 0;
    const monthN = parseInt(monthVal, 10) || 0;
    const debug = { ipKey: ipKey, ipVal: ipVal, ipN: ipN, ipHourly: ipHourly, monthVal: monthVal, monthN: monthN, monthlyCap: monthlyCap };

    if (monthN >= monthlyCap) return { ok: false, capped: true, debug: debug };
    if (ipN >= ipHourly) return { ok: false, rateLimited: true, debug: debug };

    return { ok: true, ipKey: ipKey, monthKey: monthKey, ipN: ipN, monthN: monthN };
  } catch (e) {
    console.log("scan-health: KV check failed, failing open: " + e);
    return { ok: true };
  }
}

// Count a scan only after it succeeds — a failed scan must not spend the
// visitor's quota. Small read-then-write race is fine at this volume.
// Also stamps last_success for the health check. Fails open.
async function recordScan(env, gate) {
  if (!env.SCAN_KV || !gate.ipKey) return;
  try {
    await Promise.all([
      env.SCAN_KV.put(gate.ipKey, String(gate.ipN + 1), { expirationTtl: 7200 }),
      env.SCAN_KV.put(gate.monthKey, String(gate.monthN + 1), { expirationTtl: 40 * 24 * 3600 }),
      env.SCAN_KV.put("last_success", new Date().toISOString(), { expirationTtl: 40 * 24 * 3600 }),
    ]);
  } catch (e) {
    console.log("scan-health: KV recordScan failed, failing open: " + e);
  }
}

// Best-effort daily failure counter for the health check. Never throws.
async function noteFailure(env, ctx, code) {
  try {
    if (!env.SCAN_KV) return;
    const key = "failures:" + new Date().toISOString().slice(0, 10);
    const task = env.SCAN_KV.get(key).then(function (v) {
      return env.SCAN_KV.put(key, String((parseInt(v, 10) || 0) + 1), { expirationTtl: 2 * 24 * 3600 });
    }).catch(function (e) { console.log("scan-health: failure counter error: " + e); });
    if (ctx && ctx.waitUntil) ctx.waitUntil(task); else await task;
  } catch (e) {
    console.log("scan-health: noteFailure error: " + e);
  }
}

// GET /api/scan?health=1 — no secrets, never throws.
async function healthCheck(env) {
  const out = { ok: true, kv: false, anthropic_key_present: !!env.ANTHROPIC_API_KEY, last_success: null, failures_today: 0 };
  try {
    if (env.SCAN_KV) {
      const day = new Date().toISOString().slice(0, 10);
      const vals = await Promise.all([env.SCAN_KV.get("last_success"), env.SCAN_KV.get("failures:" + day)]);
      out.kv = true;
      out.last_success = vals[0] || null;
      out.failures_today = parseInt(vals[1], 10) || 0;
    }
  } catch (e) {
    out.kv = false;
    out.ok = false;
  }
  if (!out.anthropic_key_present) out.ok = false;
  return json(out);
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.ANTHROPIC_API_KEY) return fail("Scanner isn't configured yet.", 503);

  let payload;
  try { payload = await request.json(); } catch (e) { return fail("Send a URL and an email."); }

  const email = (payload && payload.email || "").trim();
  if (!isValidEmail(email)) return fail("That email doesn't look right.");

  const u = normalizeUrl(payload && payload.url);
  if (!u) return fail("That doesn't look like a public website URL.");

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const gate = await checkAndCount(env, ip);
  if (gate.capped) {
    return fail("The scan is at capacity for the month — leave your email on the contact page and I'll run yours by hand.", 429);
  }
  if (gate.rateLimited) {
    if (request.headers.get("x-scan-debug") === "1") return json({ error: "rate limited", debug: gate.debug }, 429);
    return fail("You've run a few scans already — give it an hour and try another.", 429);
  }

  // Crawl files fetch in parallel with the page; they stay best-effort.
  const origin = u.protocol + "//" + u.host;
  const crawlFetches = Promise.allSettled([
    fetchText(origin + "/robots.txt", { maxBytes: 32 * 1024, accept: "text/plain" }),
    fetchText(origin + "/llms.txt", { maxBytes: 64 * 1024, accept: "text/plain" }),
    fetchText(origin + "/sitemap.xml", { maxBytes: 256 * 1024, accept: "application/xml" }),
  ]);

  // The page fetch gets one retry — one flaky connection shouldn't fail the scan.
  let page = null;
  try {
    page = await fetchText(u.href);
  } catch (e) {
    console.log("scan-health: page fetch failed, retrying: " + e);
    await sleep(600);
    try { page = await fetchText(u.href, { timeout: 6000 }); } catch (e2) { page = null; }
  }

  let robots = "", llms = "", sitemap = "";
  const crawl = await crawlFetches;
  if (crawl[0].status === "fulfilled" && crawl[0].value.status === 200) robots = crawl[0].value.text;
  if (crawl[1].status === "fulfilled" && crawl[1].value.status === 200) llms = crawl[1].value.text;
  if (crawl[2].status === "fulfilled" && crawl[2].value.status === 200) sitemap = crawl[2].value.text;

  const fetchFailure = classifyFetchFailure(page);
  if (fetchFailure) {
    console.log("scan-health: scan failed (" + fetchFailure.code + ") for " + u.host);
    await noteFailure(env, context, fetchFailure.code);
    return fail(fetchFailure.message, fetchFailure.httpStatus);
  }

  const sitemapInfo = await analyzeSitemap(u.hostname, sitemap);
  const signals = extractSignals(page.text, robots, llms, sitemapInfo, u.hostname);
  const site = u.host;

  let result;
  try {
    result = await runModel(env, site, signals);
  } catch (e) {
    console.log("scan-health: scan failed (model) for " + site + ": " + e.message);
    await noteFailure(env, context, "model");
    return fail("The read failed to come back. Give it a minute and try again — failed scans don't count against your allowance.", 502);
  }

  if (!result || !Array.isArray(result.lenses) || !result.lenses.length) {
    console.log("scan-health: scan failed (malformed) for " + site);
    await noteFailure(env, context, "malformed");
    return fail("The read came back malformed. Try once more — failed scans don't count against your allowance.", 502);
  }

  if (context.waitUntil) context.waitUntil(recordScan(env, gate)); else await recordScan(env, gate);

  const out = {
    site: site,
    url: u.href,
    overall: result.overall,
    lenses: result.lenses,
    opportunities: resolveGuides(result.opportunities),
  };

  await captureLead(env, context, {
    email: email,
    site: site,
    url: u.href,
    overall: out.overall,
    lenses: out.lenses,
    opportunities: out.opportunities,
    at: new Date().toISOString(),
  });

  return json(out);
}

// Method-specific handlers take precedence; this catches everything else.
// GET ?health=1 is the ops surface; anything else gets the 405.
export async function onRequest(context) {
  try {
    if (context.request.method === "GET") {
      const url = new URL(context.request.url);
      if (url.searchParams.get("health") === "1") return await healthCheck(context.env);
    }
  } catch (e) {
    console.log("scan-health: health check error: " + e);
  }
  return fail("POST a JSON body with url and email.", 405);
}

// For tests only — Pages routes ignore extra exports.
export const _internals = {
  normalizeUrl: normalizeUrl,
  isBlockedHost: isBlockedHost,
  classifyFetchFailure: classifyFetchFailure,
  analyzeSitemap: analyzeSitemap,
  checkAndCount: checkAndCount,
  recordScan: recordScan,
  noteFailure: noteFailure,
  healthCheck: healthCheck,
};
