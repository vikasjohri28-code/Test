# DesignForge AI

An AI graphic design generator website. A user describes what they need (poster, Instagram post, logo, banner, flyer, thumbnail, business card), picks a style and colours, and gets a finished design in seconds.

- **Free:** an 800px PNG with a small watermark.
- **$0.99:** a 4096px PNG plus the vector SVG, no watermark, paid through Stripe Checkout.

## How it works

1. The browser sends the brief to `POST /api/generate`.
2. The server asks Claude to produce the design as a self-contained **SVG**. Because the design is vector, it can be rendered at any resolution.
3. The SVG is sanitized (no scripts, external links or embedded HTML) and stored on the server. **The original never goes to the browser before payment.**
4. The free preview is rasterized on the server with [resvg](https://github.com/yisibl/resvg-js) at 800px with a watermark.
5. "Get HD" opens a Stripe Checkout session for $0.99. On return, the server checks the session with Stripe (`payment_status === "paid"` and the matching design ID) and unlocks the 4096px PNG and the SVG. An optional webhook unlocks the design even if the buyer closes the tab before the redirect.

## Quick start

```bash
npm install
cp .env.example .env   # then fill in the keys you have
npm start              # http://localhost:3000
```

It works with **no keys at all**, for trying it out:

| Not set | What happens |
|---|---|
| `ANTHROPIC_API_KEY` | Designs come from built-in demo templates instead of AI |
| `STRIPE_SECRET_KEY` | "Get HD" unlocks right away with no charge (demo payment) |

To go live, set both. Set `PUBLIC_URL` to your real domain so Stripe redirects back correctly.

### Stripe webhook (recommended in production)

In the Stripe dashboard, add an endpoint `https://YOUR_DOMAIN/api/stripe/webhook` for the `checkout.session.completed` event and put its signing secret in `STRIPE_WEBHOOK_SECRET`.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `PUBLIC_URL` | `http://localhost:PORT` | Base URL for Stripe success/cancel redirects |
| `ANTHROPIC_API_KEY` | none | Turns on AI designs |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | Model used for designs |
| `STRIPE_SECRET_KEY` | none | Turns on real payments |
| `STRIPE_WEBHOOK_SECRET` | none | Verifies Stripe webhooks |
| `GENERATIONS_PER_HOUR` | `20` | Per-IP limit on generations |
| `DATA_DIR` | `./data` | Where designs are stored (one JSON file each) |

Price, free size and HD size are constants at the top of `server.js`.

## Project layout

```
server.js          Express app: API routes, Stripe checkout, downloads
lib/generator.js   Claude prompt + demo template generator
lib/render.js      SVG sanitizing, watermark, PNG rendering (resvg)
lib/store.js       Design formats and file-based storage
public/            Frontend (index.html, styles.css, app.js)
fonts/             Bundled open-licence fonts (Inter, DejaVu Serif) for consistent rendering
```

## Before you go to production

- Swap the file storage in `lib/store.js` for a database or object storage if you run more than one server instance.
- The rate limiter is in memory. Use a shared store such as Redis behind a load balancer.
- Use a Stripe test key (`sk_test_...`) first; card `4242 4242 4242 4242` completes a test payment.
