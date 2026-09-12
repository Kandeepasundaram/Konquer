/* ---------------- Video import (Phase 1: share target) ----------------
   Runs entirely on-device: OCR of sampled frames + speech-to-text of the
   audio track, both via lazily-loaded WASM libraries, then best-effort
   field extraction (on-device Chrome Prompt API if present, else regex).
   Everything here is best-effort — the user always reviews/edits the
   resulting draft before it's saved. */

/* ---------------- URL import (via local video-fetcher service) ---------------- */
function openUrlImportOverlay() {
  document.getElementById("url-import-input").value = "";
  document.getElementById("url-import-status").textContent = "";
  document.getElementById("overlay-url-import").classList.remove("hidden");
}

function closeUrlImportOverlay() {
  document.getElementById("overlay-url-import").classList.add("hidden");
}

async function submitUrlImport() {
  const input = document.getElementById("url-import-input");
  const status = document.getElementById("url-import-status");
  const url = input.value.trim();
  if (!url) { status.textContent = "Paste a link first."; return; }
  const endpoint = (settings.videoFetcherUrl || "").trim();
  if (!endpoint) { status.textContent = "Set the fetcher service URL in Settings first."; return; }

  status.textContent = "Fetching video from " + new URL(endpoint).host + "…";
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url })
    });
    if (!res.ok) {
      let detail = "Server returned " + res.status;
      try { const body = await res.json(); if (body && body.detail) detail = body.detail; } catch (e) {}
      throw new Error(detail);
    }
    const blob = await res.blob();
    closeUrlImportOverlay();
    startVideoImport(blob);
  } catch (e) {
    status.textContent = "Couldn't fetch that video — " + e.message + ". Is the fetcher service running and reachable?";
  }
}

function startVideoImport(blob) {
  openPropertyOverlay(null);
  const draft = state.propertyDraft;
  if (!draft.tags.includes("Imported")) draft.tags.push("Imported");

  state.importActive = true;
  state.importPreviewUrl = URL.createObjectURL(blob);
  state.importStatus = "Analyzing video on-device… first run downloads small on-device models, can take a minute.";
  renderPropertyTabs();
  renderPropertyBody();

  runVideoExtraction(blob, draft);
}

async function runVideoExtraction(blob, draftRef) {
  const [transcript, ocrText] = await Promise.all([
    transcribeAudio(blob).catch(() => ""),
    extractFramesForOcr(blob).catch(() => "")
  ]);
  const combined = [transcript, ocrText].filter(Boolean).join("\n").trim();

  let fields = {};
  try {
    fields = await extractFieldsFromText(combined);
  } catch (e) {
    fields = {};
  }

  // The user may have closed the overlay or opened something else while we worked.
  if (state.propertyDraft !== draftRef) return;

  mergeExtractedFields(draftRef, fields);
  state.importStatus = combined
    ? "Extraction done — please check every field below before saving."
    : "Couldn't read anything from the video — fill in details manually.";
  renderPropertyTabs();
  renderPropertyBody();
}

/* ---------------- OCR (on-screen text) ---------------- */
let tesseractLoadPromise = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (tesseractLoadPromise) return tesseractLoadPromise;
  tesseractLoadPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => reject(new Error("Failed to load OCR library"));
    document.head.appendChild(s);
  });
  return tesseractLoadPromise;
}

function waitForEvent(target, event, timeoutMs, timeoutMessage) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    target["on" + event] = (e) => { clearTimeout(timer); resolve(e); };
    target.onerror = () => { clearTimeout(timer); reject(new Error("Could not read video")); };
  });
}

async function extractFramesForOcr(videoBlob, frameCount = 4) {
  const url = URL.createObjectURL(videoBlob);
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  try {
    await waitForEvent(video, "loadedmetadata", 10000, "Timed out reading video metadata");
    const duration = video.duration || 1;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 480;
    canvas.height = video.videoHeight || 854;
    const ctx = canvas.getContext("2d");

    const Tesseract = await loadTesseract();
    const worker = await Tesseract.createWorker("eng");
    let text = "";
    try {
      for (let i = 0; i < frameCount; i++) {
        const t = (duration * (i + 0.5)) / frameCount;
        video.currentTime = t;
        await waitForEvent(video, "seeked", 8000, "Timed out seeking video frame");
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const { data } = await worker.recognize(canvas);
        if (data && data.text) text += " " + data.text;
      }
    } finally {
      await worker.terminate();
    }
    return text.trim();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ---------------- Speech-to-text (spoken audio) ---------------- */
let asrPipelinePromise = null;
function loadAsrPipeline() {
  if (asrPipelinePromise) return asrPipelinePromise;
  asrPipelinePromise = (async () => {
    const { pipeline } = await import("https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2");
    return pipeline("automatic-speech-recognition", "Xenova/whisper-tiny.en");
  })();
  return asrPipelinePromise;
}

async function transcribeAudio(videoBlob) {
  const url = URL.createObjectURL(videoBlob);
  try {
    const transcriber = await loadAsrPipeline();
    const result = await transcriber(url, { chunk_length_s: 30, stride_length_s: 5 });
    return result && result.text ? result.text.trim() : "";
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ---------------- Field extraction ---------------- */
async function extractFieldsFromText(text) {
  text = (text || "").trim();
  if (!text) return {};
  const viaModel = await tryExtractWithLocalModel(text);
  if (viaModel) return viaModel;
  return extractFieldsWithRegex(text);
}

async function tryExtractWithLocalModel(text) {
  try {
    const LM = window.LanguageModel || (window.ai && window.ai.languageModel);
    if (!LM || !LM.create) return null;
    if (LM.availability) {
      const availability = await LM.availability();
      if (availability === "unavailable") return null;
    }
    const session = await LM.create();
    const prompt = `Extract real-estate listing details from this transcript / on-screen text of a short video. ` +
      `Reply with ONLY compact JSON, no prose, using exactly these keys (use "" / 0 / [] if unknown): ` +
      `{"title":"","location":"","type":"Apartment|Villa|Land|Commercial|Other","price":"","areaSqft":0,"bhk":"","facing":"","amenities":[],"notes":""}.\n\nText:\n${text.slice(0, 4000)}`;
    const raw = await session.prompt(prompt);
    if (session.destroy) session.destroy();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch (e) {
    return null;
  }
}

function extractFieldsWithRegex(text) {
  const out = {};
  const priceMatch = text.match(/₹?\s?[\d.,]+\s?(?:lakhs?|crores?|cr|l|k|thousand)\b/i) || text.match(/₹\s?[\d,]{5,}/);
  if (priceMatch) out.price = parsePrice(priceMatch[0]);

  const bhkMatch = text.match(/(\d)\s?[- ]?\s?bhk/i);
  if (bhkMatch) out.bhk = bhkMatch[1];

  const sqftMatch = text.match(/([\d,]{3,})\s?(?:sq\.?\s?ft\.?|sqft|square feet)/i);
  if (sqftMatch) out.areaSqft = num(sqftMatch[1].replace(/,/g, ""));

  const locMatch = text.match(/(?:in|at|near)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2})/);
  if (locMatch) out.location = locMatch[1];

  for (const t of TYPE_LIST) {
    if (t !== "Other" && new RegExp("\\b" + t + "\\b", "i").test(text)) { out.type = t; break; }
  }

  out.notes = text.slice(0, 500);
  return out;
}

function mergeExtractedFields(draft, fields) {
  if (!fields) return;
  if (fields.title) draft.title = String(fields.title).slice(0, 120);
  if (fields.location) draft.location = String(fields.location).slice(0, 120);
  if (fields.type && TYPE_LIST.includes(fields.type)) draft.type = fields.type;
  if (fields.price) draft.price = parsePrice(fields.price, draft.price);
  if (fields.areaSqft) draft.areaSqft = num(fields.areaSqft, draft.areaSqft);
  if (fields.bhk) draft.detail.bhk = String(fields.bhk);
  if (fields.facing) draft.detail.facing = String(fields.facing);
  if (Array.isArray(fields.amenities)) {
    fields.amenities.forEach((a) => {
      const match = AMENITY_LIST.find((x) => x.toLowerCase() === String(a).toLowerCase());
      if (match && !draft.amenities.includes(match)) draft.amenities.push(match);
    });
  }
  if (fields.notes) draft.notes = (draft.notes ? draft.notes + "\n\n" : "") + String(fields.notes).slice(0, 1000);
}
