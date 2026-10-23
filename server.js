require("dotenv").config();

const path = require("path");
const express = require("express");
const Anthropic = require("@anthropic-ai/sdk");
const { FORMATS, saveDesign, getDesign, updateDesign } = require("./lib/store");
const { generateDesign, aiEnabled, STYLES, PALETTES } = require("./lib/generator");
const { prepareSvg, addWatermark, renderPng } = require("./lib/render");

const PORT = Number(process.env.PORT) || 3000;
// Render sets RENDER_EXTERNAL_URL automatically, so PUBLIC_URL is optional there.
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const FREE_SIZE = 800; // longest side in px for the free download
const HD_SIZE = 4096; // longest side in px for the paid download
const PRICE_CENTS = 99;

const stripe = process.env.STRIPE_SECRET_KEY ? require("stripe")(process.env.STRIPE_SECRET_KEY) : null;
// Without Stripe, HD unlocks for free. Never allow that in production unless explicitly asked for.
const demoPayments = !stripe && (process.env.NODE_ENV !== "production" || process.env.ALLOW_DEMO_PAYMENTS === "true");

const app = express();
// Behind a hosting proxy (Render, Fly, etc.) so req.ip is the visitor, not the proxy.
app.set("trust proxy", Number(process.env.TRUST_PROXY ?? 1));
const jsonBody = express.json({ limit: "20kb" });
// The Stripe webhook needs the raw body for signature verification.
app.use((req, res, next) => (req.path === "/api/stripe/webhook" ? next() : jsonBody(req, res, next)));
app.use(express.static(path.join(__dirname, "public")));

// Very small in-memory rate limiter for the expensive generate endpoint.
const hits = new Map();
function rateLimit(req, res, next) {
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;
  const limit = Number(process.env.GENERATIONS_PER_HOUR) || 20;
  const key = req.ip;
  const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    return res.status(429).json({ error: "Hourly generation limit reached. Please try again later." });
  }
  recent.push(now);
  hits.set(key, recent);
  next();
}

function clean(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function slug(text) {
  return (text || "design").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "design";
}

app.get("/api/config", (req, res) => {
  res.json({
    formats: Object.entries(FORMATS).map(([id, f]) => ({ id, ...f })),
    styles: Object.keys(STYLES),
    palettes: Object.fromEntries(Object.entries(PALETTES).map(([k, v]) => [k, v])),
    aiEnabled: aiEnabled(),
    demoPayments,
    price: (PRICE_CENTS / 100).toFixed(2),
    freeSize: FREE_SIZE,
    hdSize: HD_SIZE,
  });
});

app.post("/api/generate", rateLimit, async (req, res) => {
  req.body = req.body || {};
  const prompt = clean(req.body.prompt, 600);
  const formatId = clean(req.body.format, 40);
  const format = FORMATS[formatId];
  if (prompt.length < 3) return res.status(400).json({ error: "Please describe the design you want." });
  if (!format) return res.status(400).json({ error: "Unknown design format." });

  const input = {
    prompt,
    format,
    style: STYLES[req.body.style] ? req.body.style : "modern",
    palette: req.body.palette in PALETTES ? req.body.palette : "auto",
    headline: clean(req.body.headline, 80),
    subtext: clean(req.body.subtext, 160),
  };

  try {
    const { svg, engine } = await generateDesign(input);
    const prepared = prepareSvg(svg, format.width, format.height);
    renderPng(prepared, 64, format.width, format.height); // fail fast on unrenderable SVG
    const design = saveDesign({
      svg: prepared,
      prompt,
      formatId,
      width: format.width,
      height: format.height,
      engine,
      paid: false,
      createdAt: new Date().toISOString(),
    });
    res.json({ id: design.id, width: design.width, height: design.height, engine });
  } catch (err) {
    console.error("generate failed:", err);
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(503).json({ error: "The AI is busy right now. Please try again in a minute." });
    }
    if (err instanceof Anthropic.APIError) {
      return res.status(502).json({ error: "The AI service returned an error. Please try again." });
    }
    res.status(err.status || 500).json({ error: err.status ? err.message : "Could not create the design." });
  }
});

// Free, watermarked, low-resolution PNG. Used both for the preview and the free download.
app.get("/api/designs/:id/preview.png", (req, res) => {
  const design = getDesign(req.params.id);
  if (!design) return res.status(404).send("Not found");
  const png = renderPng(addWatermark(design.svg, design.width, design.height), FREE_SIZE, design.width, design.height);
  res.set("Content-Type", "image/png");
  res.set("Cache-Control", "public, max-age=86400");
  if (req.query.download) {
    res.set("Content-Disposition", `attachment; filename="${slug(design.prompt)}-free.png"`);
  }
  res.send(png);
});

app.post("/api/designs/:id/checkout", async (req, res) => {
  const design = getDesign(req.params.id);
  if (!design) return res.status(404).json({ error: "Design not found." });
  if (design.paid) return res.json({ url: `${PUBLIC_URL}/?design=${design.id}&unlocked=1` });

  if (demoPayments) {
    return res.json({ url: `${PUBLIC_URL}/api/designs/${design.id}/demo-pay`, demo: true });
  }
  if (!stripe) return res.status(503).json({ error: "HD purchases are not available yet. Please check back soon." });

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: PRICE_CENTS,
            product_data: {
              name: "HD design download",
              description: `${HD_SIZE}px PNG + vector SVG, no watermark`,
            },
          },
        },
      ],
      metadata: { designId: design.id },
      success_url: `${PUBLIC_URL}/?design=${design.id}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${PUBLIC_URL}/?design=${design.id}`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error("checkout failed:", err);
    res.status(502).json({ error: "Could not start checkout. Please try again." });
  }
});

// Only available when Stripe is not configured, so the full flow can be tried locally.
app.get("/api/designs/:id/demo-pay", (req, res) => {
  if (!demoPayments) return res.status(404).send("Not found");
  const design = updateDesign(req.params.id, { paid: true });
  if (!design) return res.status(404).send("Not found");
  res.redirect(`/?design=${design.id}&unlocked=1`);
});

async function isUnlocked(design, sessionId) {
  if (design.paid) return true;
  if (!stripe || !sessionId) return false;
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status === "paid" && session.metadata?.designId === design.id) {
      updateDesign(design.id, { paid: true, stripeSessionId: session.id });
      return true;
    }
  } catch (err) {
    console.error("session lookup failed:", err.message);
  }
  return false;
}

app.get("/api/designs/:id/status", async (req, res) => {
  const design = getDesign(req.params.id);
  if (!design) return res.status(404).json({ error: "Design not found." });
  res.json({
    id: design.id,
    prompt: design.prompt,
    width: design.width,
    height: design.height,
    unlocked: await isUnlocked(design, clean(req.query.session_id, 200)),
  });
});

// Paid HD download: high-resolution PNG or the vector SVG, no watermark.
app.get("/api/designs/:id/hd", async (req, res) => {
  const design = getDesign(req.params.id);
  if (!design) return res.status(404).send("Not found");
  if (!(await isUnlocked(design, clean(req.query.session_id, 200)))) {
    return res.status(402).send("Payment required");
  }
  const name = slug(design.prompt);
  if (req.query.format === "svg") {
    res.set("Content-Type", "image/svg+xml");
    res.set("Content-Disposition", `attachment; filename="${name}-hd.svg"`);
    res.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");
    return res.send(design.svg);
  }
  const png = renderPng(design.svg, HD_SIZE, design.width, design.height);
  res.set("Content-Type", "image/png");
  res.set("Content-Disposition", `attachment; filename="${name}-hd.png"`);
  res.send(png);
});

// Optional: Stripe webhook so a design unlocks even if the buyer closes the tab before the redirect.
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(404).end();
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook error: ${err.message}`);
  }
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    if (session.payment_status === "paid" && session.metadata?.designId) {
      updateDesign(session.metadata.designId, { paid: true, stripeSessionId: session.id });
    }
  }
  res.json({ received: true });
});

app.listen(PORT, () => {
  console.log(`DesignForge AI running at ${PUBLIC_URL}`);
  console.log(`  AI engine: ${aiEnabled() ? "Claude" : "demo templates (set ANTHROPIC_API_KEY for AI designs)"}`);
  console.log(`  Payments:  ${stripe ? "Stripe" : demoPayments ? "demo mode (set STRIPE_SECRET_KEY for real payments)" : "disabled (set STRIPE_SECRET_KEY)"}`);
});
