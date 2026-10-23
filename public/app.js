const $ = (sel) => document.querySelector(sel);

const state = {
  config: null,
  format: "instagram-post",
  style: "modern",
  palette: "auto",
  designId: null,
  sessionId: null,
  lastRequest: null,
};

const RECENT_KEY = "designforge.recent";

function loadRecent() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY)) || [];
  } catch {
    return [];
  }
}

function saveRecent(id) {
  try {
    const list = [id, ...loadRecent().filter((x) => x !== id)].slice(0, 12);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable: recent list is a convenience only */
  }
}

function renderRecent() {
  const list = loadRecent();
  $("#recent-wrap").hidden = list.length === 0;
  const grid = $("#recent");
  grid.innerHTML = "";
  for (const id of list) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = "Open design";
    const img = document.createElement("img");
    img.src = `/api/designs/${id}/preview.png`;
    img.alt = "Recent design";
    img.loading = "lazy";
    img.onerror = () => btn.remove();
    btn.append(img);
    btn.onclick = () => {
      showDesign(id);
      window.scrollTo({ top: $(".workspace").offsetTop - 20, behavior: "smooth" });
    };
    grid.append(btn);
  }
}

function makeChips(container, items, key, labelFor = (x) => x) {
  container.innerHTML = "";
  for (const item of items) {
    const value = typeof item === "string" ? item : item.id;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.textContent = labelFor(item);
    btn.setAttribute("aria-pressed", String(state[key] === value));
    btn.onclick = () => {
      state[key] = value;
      container.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", "false"));
      btn.setAttribute("aria-pressed", "true");
    };
    container.append(btn);
  }
}

function makeSwatches(container, palettes) {
  container.innerHTML = "";
  for (const [name, colors] of Object.entries(palettes)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "swatch";
    btn.setAttribute("aria-pressed", String(state.palette === name));
    const strip = document.createElement("div");
    strip.className = "swatch-colors" + (colors ? "" : " swatch-auto");
    for (const color of colors || []) {
      const s = document.createElement("span");
      s.style.background = color;
      strip.append(s);
    }
    btn.append(strip, document.createTextNode(name === "auto" ? "AI picks" : name));
    btn.onclick = () => {
      state.palette = name;
      container.querySelectorAll(".swatch").forEach((c) => c.setAttribute("aria-pressed", "false"));
      btn.setAttribute("aria-pressed", "true");
    };
    container.append(btn);
  }
}

function setStatus(text, isError = false) {
  const el = $("#status");
  el.textContent = text;
  el.classList.toggle("error", isError);
}

function setLoading(loading) {
  const btn = $("#generate");
  btn.disabled = loading;
  btn.querySelector(".spinner").hidden = !loading;
  btn.querySelector(".btn-text").textContent = loading ? "Designing…" : "✨ Generate design";
  $("#canvas").classList.toggle("loading", loading);
  $("#regenerate").disabled = loading;
}

function hdLink(format) {
  const params = new URLSearchParams();
  if (format) params.set("format", format);
  if (state.sessionId) params.set("session_id", state.sessionId);
  const qs = params.toString();
  return `/api/designs/${state.designId}/hd${qs ? `?${qs}` : ""}`;
}

function showUnlocked(unlocked) {
  $("#buy-hd").hidden = unlocked;
  $("#hd-downloads").hidden = !unlocked;
  if (unlocked) {
    $("#hd-png").href = hdLink("png");
    $("#hd-svg").href = hdLink("svg");
  }
}

async function showDesign(id, { sessionId } = {}) {
  state.designId = id;
  state.sessionId = sessionId || null;
  const canvas = $("#canvas");
  canvas.classList.remove("empty");
  canvas.innerHTML = "";
  const img = document.createElement("img");
  img.alt = "Generated design preview";
  img.src = `/api/designs/${id}/preview.png`;
  canvas.append(img);

  $("#free-download").href = `/api/designs/${id}/preview.png?download=1`;
  $("#actions").hidden = false;
  showUnlocked(false);

  try {
    const qs = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : "";
    const res = await fetch(`/api/designs/${id}/status${qs}`);
    if (!res.ok) throw new Error();
    const info = await res.json();
    showUnlocked(info.unlocked);
    if (info.unlocked && sessionId) setStatus("Payment received — thank you! Your HD files are ready.");
  } catch {
    setStatus("Could not load this design.", true);
  }
}

async function generate(body) {
  setLoading(true);
  setStatus(state.config?.aiEnabled ? "Our AI designer is working… this can take up to a minute." : "Generating…");
  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Something went wrong.");
    saveRecent(data.id);
    renderRecent();
    history.replaceState(null, "", `/?design=${data.id}`);
    await showDesign(data.id);
    setStatus("Done! Download it free or unlock the HD version.");
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    setLoading(false);
  }
}

$("#design-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const body = {
    prompt: $("#prompt").value,
    format: state.format,
    style: state.style,
    palette: state.palette,
    headline: $("#headline").value,
    subtext: $("#subtext").value,
  };
  state.lastRequest = body;
  generate(body);
});

$("#regenerate").addEventListener("click", () => {
  if (state.lastRequest) generate(state.lastRequest);
  else $("#design-form").requestSubmit();
});

$("#buy-hd").addEventListener("click", async () => {
  const btn = $("#buy-hd");
  btn.disabled = true;
  setStatus("Opening secure checkout…");
  try {
    const res = await fetch(`/api/designs/${state.designId}/checkout`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Checkout failed.");
    if (data.demo && !confirm("Demo mode: no real payment will be taken. Unlock HD for this design?")) {
      setStatus("");
      return;
    }
    window.location.href = data.url;
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    btn.disabled = false;
  }
});

async function init() {
  $("#year").textContent = new Date().getFullYear();
  const res = await fetch("/api/config");
  const config = await res.json();
  state.config = config;

  document.querySelectorAll("[data-price]").forEach((el) => (el.textContent = config.price));
  document.querySelectorAll("[data-free-px]").forEach((el) => (el.textContent = config.freeSize));
  document.querySelectorAll("[data-hd-px]").forEach((el) => (el.textContent = config.hdSize));
  $("[data-free-size]").textContent = `${config.freeSize}px · watermark`;
  $("[data-hd-size]").textContent = `${config.hdSize}px PNG + SVG`;

  makeChips($("#formats"), config.formats, "format", (f) => f.label);
  makeChips($("#styles"), config.styles, "style");
  makeSwatches($("#palettes"), config.palettes);

  const notes = [];
  if (!config.aiEnabled) notes.push("Demo mode: template designs (add an Anthropic API key for AI designs).");
  if (config.demoPayments) notes.push("Payments in demo mode.");
  $("#engine-note").textContent = notes.join(" ");

  renderRecent();

  const params = new URLSearchParams(location.search);
  const id = params.get("design");
  if (id) {
    const sessionId = params.get("session_id");
    await showDesign(id, { sessionId });
    if (params.get("unlocked")) setStatus("HD unlocked! Your files are ready.");
    if (sessionId) history.replaceState(null, "", `/?design=${id}`);
  }
}

init();
