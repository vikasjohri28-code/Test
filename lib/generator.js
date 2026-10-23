const Anthropic = require("@anthropic-ai/sdk");
const { extractSvg } = require("./render");

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";

const STYLES = {
  modern: "clean modern layout, bold sans-serif type, generous whitespace",
  minimal: "minimalist, very few elements, refined typography, lots of negative space",
  bold: "loud and energetic, oversized type, high contrast, dynamic diagonal shapes",
  elegant: "elegant and premium, serif headline, thin rules, subtle gradients",
  playful: "playful and fun, rounded shapes, bright colours, friendly type",
  retro: "retro 70s/80s vibe, sunburst or stripes, warm vintage palette",
  corporate: "professional corporate look, structured grid, trustworthy blues",
  futuristic: "futuristic tech aesthetic, neon glows, dark background, geometric lines",
};

const PALETTES = {
  auto: null,
  sunset: ["#ff6b6b", "#feca57", "#ff9ff3", "#2d1b3d"],
  ocean: ["#0abde3", "#48dbfb", "#10ac84", "#0b2545"],
  forest: ["#2d6a4f", "#95d5b2", "#d8f3dc", "#081c15"],
  mono: ["#111111", "#555555", "#e5e5e5", "#ffffff"],
  candy: ["#ff4d8d", "#7b5cff", "#ffd23f", "#fff5fb"],
  earth: ["#bc6c25", "#dda15e", "#fefae0", "#283618"],
  neon: ["#00f5d4", "#f15bb5", "#fee440", "#0d0221"],
};

const SYSTEM_PROMPT = `You are a world-class graphic designer who produces finished designs as hand-written SVG.

Output rules:
- Reply with exactly one complete <svg> element and nothing else: no prose, no markdown fences.
- The root element must be <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}"> using the canvas size you are given.
- Self-contained vector art only: no <script>, no <image>, no <foreignObject>, no external URLs, no CSS @import.
- Use only these font families: "Inter" (weights 400, 500, 700, 800, 900) for sans-serif and "DejaVu Serif" (400, 700) for serif.
- All text must stay fully inside the canvas with comfortable margins. Break long text into multiple <text>/<tspan> lines yourself; SVG does not wrap.
- Fill the whole canvas with a background. Use gradients, shapes, patterns and layering to make it look professionally designed, not like clip art.
- Spell every piece of supplied copy exactly as given.`;

function buildUserPrompt({ prompt, format, style, palette, headline, subtext }) {
  const lines = [
    `Design brief: ${prompt}`,
    `Format: ${format.label}, canvas ${format.width}x${format.height} px.`,
    `Visual style: ${STYLES[style] || STYLES.modern}.`,
  ];
  if (PALETTES[palette]) lines.push(`Colour palette to use: ${PALETTES[palette].join(", ")}.`);
  if (headline) lines.push(`Headline text (must appear exactly): "${headline}"`);
  if (subtext) lines.push(`Supporting text (must appear exactly): "${subtext}"`);
  if (format.label === "Logo") {
    lines.push("Create a distinctive logo mark plus wordmark centred on a simple background.");
  }
  return lines.join("\n");
}

let client = null;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

async function generateWithClaude(input) {
  const stream = getClient().beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    output_config: { effort: "medium" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(input) }],
  });
  const message = await stream.finalMessage();

  if (message.stop_reason === "refusal") {
    const err = new Error("The AI declined this request. Please try a different brief.");
    err.status = 422;
    throw err;
  }
  const text = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  const svg = extractSvg(text);
  if (!svg) {
    const err = new Error("The AI did not return a valid design. Please try again.");
    err.status = 502;
    throw err;
  }
  return svg;
}

// ---------------------------------------------------------------------------
// Demo generator: used when no ANTHROPIC_API_KEY is configured so the site is
// fully usable locally. Produces a deterministic template design from the brief.
// ---------------------------------------------------------------------------

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededRandom(seed) {
  let s = seed || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapText(text, maxChars) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = (line + " " + word).trim();
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

function titleFromPrompt(prompt) {
  const words = prompt.replace(/[^\w\s'&-]/g, "").split(/\s+/).filter(Boolean);
  return words.slice(0, 5).join(" ").toUpperCase() || "YOUR DESIGN";
}

function generateDemo({ prompt, format, style, palette, headline, subtext }) {
  const { width: W, height: H } = format;
  const rand = seededRandom(hashString(`${prompt}|${style}|${palette}|${format.label}|${Date.now()}`));
  const colors =
    PALETTES[palette] ||
    Object.values(PALETTES).filter(Boolean)[Math.floor(rand() * 7)];
  const [c1, c2, c3, dark] = colors;
  const serif = style === "elegant" || style === "retro";
  const font = serif ? "DejaVu Serif" : "Inter";

  const shapes = [];
  const count = style === "minimal" ? 3 : 9;
  for (let i = 0; i < count; i++) {
    const r = (0.08 + rand() * 0.3) * Math.min(W, H);
    const cx = rand() * W;
    const cy = rand() * H;
    const fill = [c1, c2, c3][i % 3];
    const opacity = (0.25 + rand() * 0.5).toFixed(2);
    if (style === "futuristic" || style === "corporate") {
      const angle = Math.round(rand() * 90 - 45);
      shapes.push(
        `<rect x="${cx - r}" y="${cy - r / 3}" width="${r * 2}" height="${r / 1.5}" rx="${r / 10}" fill="${fill}" opacity="${opacity}" transform="rotate(${angle} ${cx} ${cy})"/>`
      );
    } else {
      shapes.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" opacity="${opacity}"/>`);
    }
  }

  const title = headline || titleFromPrompt(prompt);
  const landscape = W / H > 1.6;
  const maxChars = landscape ? 26 : W >= H ? 14 : 12;
  const titleLines = wrapText(title, maxChars);
  const longest = Math.max(...titleLines.map((l) => l.length));
  const charWidth = serif ? 0.78 : 0.68; // approx. glyph width / font size for bold caps
  const titleSize = Math.round(
    Math.min(landscape ? H * 0.16 : W * 0.11, (W * 0.8) / (longest * charWidth)) *
      (titleLines.length > 2 ? 0.85 : 1)
  );
  const lineGap = titleSize * 1.08;
  const blockHeight = titleLines.length * lineGap;
  const startY = H / 2 - blockHeight / 2 + titleSize * 0.8;

  const titleSvg = titleLines
    .map(
      (line, i) =>
        `<text x="${W / 2}" y="${startY + i * lineGap}" text-anchor="middle" font-family="${font}" font-weight="900" font-size="${titleSize}" fill="#ffffff">${escapeXml(line)}</text>`
    )
    .join("");

  const sub = subtext || (headline ? "" : prompt);
  const subLines = sub ? wrapText(sub, landscape ? 60 : 34) : [];
  const subSize = Math.round(titleSize * 0.28);
  const subSvg = subLines
    .slice(0, 2)
    .map(
      (line, i) =>
        `<text x="${W / 2}" y="${startY + blockHeight + subSize * 1.2 + i * subSize * 1.4}" text-anchor="middle" font-family="Inter" font-weight="500" font-size="${subSize}" fill="#ffffff" opacity="0.9">${escapeXml(line)}</text>`
    )
    .join("");

  const frame = Math.min(W, H) * 0.04;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="${dark}"/><stop offset="1" stop-color="${c1}"/>
</linearGradient>
<radialGradient id="glow" cx="0.5" cy="0.5" r="0.6">
<stop offset="0" stop-color="${c2}" stop-opacity="0.55"/><stop offset="1" stop-color="${c2}" stop-opacity="0"/>
</radialGradient>
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
${shapes.join("\n")}
<rect width="${W}" height="${H}" fill="url(#glow)"/>
<rect x="${frame}" y="${frame}" width="${W - frame * 2}" height="${H - frame * 2}" fill="none" stroke="#ffffff" stroke-opacity="0.5" stroke-width="${Math.max(2, frame / 8)}"/>
${titleSvg}
${subSvg}
</svg>`;
}

function aiEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

async function generateDesign(input) {
  if (aiEnabled()) return { svg: await generateWithClaude(input), engine: "claude" };
  return { svg: generateDemo(input), engine: "demo" };
}

module.exports = { generateDesign, aiEnabled, STYLES, PALETTES };
