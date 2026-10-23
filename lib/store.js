const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const FORMATS = {
  "instagram-post": { label: "Instagram Post", width: 1080, height: 1080 },
  "instagram-story": { label: "Instagram Story", width: 1080, height: 1920 },
  poster: { label: "Poster", width: 1200, height: 1600 },
  flyer: { label: "Flyer (A4)", width: 1240, height: 1754 },
  "youtube-thumbnail": { label: "YouTube Thumbnail", width: 1280, height: 720 },
  banner: { label: "Web / Twitter Banner", width: 1500, height: 500 },
  logo: { label: "Logo", width: 1000, height: 1000 },
  "business-card": { label: "Business Card", width: 1050, height: 600 },
};

const ID_PATTERN = /^[a-f0-9]{24}$/;

function fileFor(id) {
  if (!ID_PATTERN.test(id)) return null;
  return path.join(DATA_DIR, `${id}.json`);
}

function saveDesign(design) {
  const id = design.id || crypto.randomBytes(12).toString("hex");
  const record = { ...design, id };
  fs.writeFileSync(fileFor(id), JSON.stringify(record));
  return record;
}

function getDesign(id) {
  const file = fileFor(id);
  if (!file || !fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function updateDesign(id, patch) {
  const design = getDesign(id);
  if (!design) return null;
  return saveDesign({ ...design, ...patch, id });
}

module.exports = { FORMATS, saveDesign, getDesign, updateDesign };
