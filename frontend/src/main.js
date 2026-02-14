import StreamingAvatar, { AvatarQuality, StreamingEvents } from "@heygen/streaming-avatar";

/**
 * UPDATED FIXES:
 * - Uses your REAL backend endpoints:
 *   ✅ POST /api/heygen/session/start  (requires { avatar_id, mode })
 *   ✅ POST /api/heygen/chat
 * - Supports token returned either as:
 *   { token: "..." }  OR  { data: { token: "..." } }  OR  { data: { token: { token: "..." } } }
 * - If backend does NOT return a token, it falls back to text-only and logs the payload,
 *   so you can see exactly what your backend returned.
 * - Waits for DOMContentLoaded before wiring UI.
 */

const API_BASE =
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_URL) ||
  "http://localhost:8000";

const MODE_DEFAULT =
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_AVATAR_MODE) ||
  "clinic";

const AVATAR_ID_CLINIC =
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_HEYGEN_AVATAR_ID_CLINIC) || "";

const AVATAR_ID_REHAB =
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_HEYGEN_AVATAR_ID_REHAB) || "";

let avatar = null;
let sessionData = null;

let speakQueue = [];
let isSpeaking = false;
let avatarReady = false;
let textOnly = false;

function byId(id) {
  return document.getElementById(id);
}

function setStatus(el, txt) {
  if (el) el.textContent = txt;
}

function appendLog(el, txt) {
  if (!el) return;
  el.textContent += txt;
  el.scrollTop = el.scrollHeight;
}

function getAvatarIdForMode(mode) {
  return mode === "rehab" ? AVATAR_ID_REHAB : AVATAR_ID_CLINIC;
}

/**
 * Try to extract a HeyGen token from various possible payload shapes.
 * You can extend this if your backend returns a different structure.
 */
function extractToken(payload) {
  // most common shapes
  if (payload?.token && typeof payload.token === "string") return payload.token;
  if (payload?.data?.token && typeof payload.data.token === "string") return payload.data.token;

  // sometimes nested token objects
  if (payload?.data?.token?.token && typeof payload.data.token.token === "string") return payload.data.token.token;
  if (payload?.data?.data?.token && typeof payload.data.data.token === "string") return payload.data.data.token;

  // fallback: nothing found
  return null;
}

/**
 * Speak queue utilities
 */
function enqueueSpeak(text) {
  const cleaned = (text || "").trim();
  if (!cleaned) return;
  speakQueue.push(cleaned);
  pumpQueue();
}

async function pumpQueue() {
  if (textOnly) return;
  if (!avatar) return;
  if (isSpeaking) return;
  const next = speakQueue.shift();
  if (!next) return;

  try {
    await avatar.speak({ text: next });
  } catch (e) {
    textOnly = true;
  }
}

/**
 * Create HeyGen session + start WebRTC stream.
 * Uses your backend:
 *   POST /api/heygen/session/start  { avatar_id, mode }
 *
 * IMPORTANT:
 * The @heygen/streaming-avatar SDK expects a TOKEN.
 * Your backend MUST return a token somewhere in the JSON.
 * If it doesn't, we log the payload and fall back to text-only.
 */
async function initAvatar({ videoEl, statusEl, logEl, mode }) {
  const avatarId = getAvatarIdForMode(mode);

  if (!avatarId) {
    textOnly = true;
    setStatus(statusEl, "Text-only mode (missing HeyGen avatar id in frontend .env)");
    return;
  }

  try {
    setStatus(statusEl, "Connecting avatar…");

    const res = await fetch(`${API_BASE}/api/heygen/session/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        avatar_id: avatarId,
        mode, // "clinic" or "rehab"
      }),
    });

    if (!res.ok) {
      const errTxt = await res.text().catch(() => "");
      throw new Error(`Session failed (${res.status}): ${errTxt}`);
    }

    sessionData = await res.json();

    const token = extractToken(sessionData);

    if (!token) {
      // This means your backend is not returning a token the JS SDK can use.
      // We'll fall back to text-only and print the payload for debugging.
      textOnly = true;
      avatarReady = false;
      setStatus(statusEl, "Text-only fallback (no HeyGen token returned)");
      appendLog(
        logEl,
        `\n[Avatar init error] No token returned from /api/heygen/session/start.\nPayload:\n${JSON.stringify(
          sessionData,
          null,
          2
        )}\n`
      );
      return;
    }

    avatar = new StreamingAvatar({ token });

    avatar.on(StreamingEvents.AVATAR_START_TALKING, () => {
      isSpeaking = true;
      setStatus(statusEl, "Speaking…");
    });

    avatar.on(StreamingEvents.AVATAR_STOP_TALKING, () => {
      isSpeaking = false;
      setStatus(statusEl, "Ready");
      pumpQueue();
    });

    const stream = await avatar.createStartAvatar({
      quality: AvatarQuality.Low,
      avatarId,
    });

    if (videoEl) {
      videoEl.autoplay = true;
      videoEl.playsInline = true;
      videoEl.srcObject = stream;
      await videoEl.play().catch(() => {});
    }

    avatarReady = true;
    textOnly = false;
    setStatus(statusEl, "Ready");
  } catch (e) {
    textOnly = true;
    avatarReady = false;
    setStatus(statusEl, "Text-only fallback (avatar init error)");
    appendLog(logEl, `\n[Avatar init error] ${String(e)}\n`);
  }
}

/**
 * Chat endpoint (works even in text-only mode).
 * Uses POST /api/heygen/chat which returns:
 * { response, chunks: [..], safety, meta }
 */
async function sendMessage({ message, mode, logEl, statusEl }) {
  appendLog(logEl, `\n\nYou: ${message}\nAvatar: `);
  setStatus(statusEl, "Thinking…");

  try {
    const res = await fetch(`${API_BASE}/api/heygen/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode,
        message,
        history: [],
      }),
    });

    if (!res.ok) {
      const errTxt = await res.text().catch(() => "");
      throw new Error(`Chat failed (${res.status}): ${errTxt}`);
    }

    const data = await res.json();

    const full = (data?.response || "").trim();
    const chunks = Array.isArray(data?.chunks) ? data.chunks : [];

    appendLog(logEl, full ? `${full}\n` : `[No response]\n`);

    if (!textOnly && avatarReady && chunks.length) {
      chunks.forEach((c) => enqueueSpeak(c));
      setStatus(statusEl, "Speaking…");
    } else {
      setStatus(statusEl, "Ready");
    }
  } catch (e) {
    setStatus(statusEl, "Text-only fallback (chat error)");
    appendLog(logEl, `\n[Chat error] ${String(e)}\n`);
  }
}

/**
 * Bootstraps after DOM is ready so IDs exist.
 */
window.addEventListener("DOMContentLoaded", async () => {
  const videoEl = byId("avatarVideo");
  const statusEl = byId("status");
  const logEl = byId("log");
  const inputEl = byId("msg");
  const sendBtn = byId("send");

  const startBtn = byId("startAvatar"); // optional
  const modeSelect = byId("mode"); // optional

  if (!statusEl || !logEl || !inputEl || !sendBtn) {
    throw new Error(
      "Missing required UI elements. Ensure index.html includes ids: status, log, msg, send (and avatarVideo optional)."
    );
  }

  let mode = modeSelect?.value || MODE_DEFAULT;

  if (modeSelect) {
    modeSelect.addEventListener("change", () => {
      mode = modeSelect.value;
      setStatus(statusEl, "Mode changed. Ready.");
    });
  }

  // Auto-init on load (optional) – if it fails, it will fall back to text-only
  await initAvatar({ videoEl, statusEl, logEl, mode });

  if (startBtn) {
    startBtn.onclick = async () => {
      // reset state and try again
      textOnly = false;
      avatarReady = false;
      await initAvatar({ videoEl, statusEl, logEl, mode });
    };
  }

  sendBtn.onclick = () => {
    const msg = inputEl.value.trim();
    if (!msg) return;
    inputEl.value = "";
    sendMessage({ message: msg, mode, logEl, statusEl });
  };

  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendBtn.click();
    }
  });
});
