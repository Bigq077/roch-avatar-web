import StreamingAvatar, { AvatarQuality, StreamingEvents } from "@heygen/streaming-avatar";

/**
 * FIXES INCLUDED:
 * - Wait for DOMContentLoaded before querying elements (prevents null.onclick crash)
 * - Use VITE_API_URL if available, fallback to localhost
 * - Use backend endpoints that actually exist in your repo (/api/heygen/session + /api/heygen/chat)
 * - Replace broken SSE endpoint (/api/avatar/stream) with /api/heygen/chat (returns chunks)
 * - Add hard "text-only fallback" mode if avatar init fails
 * - Add optional Start Avatar button support (if present) without requiring it
 * - Require HeyGen avatar id via Vite env (VITE_HEYGEN_AVATAR_ID_CLINIC / _REHAB) or it will run text-only
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
    // no logEl here; caller will show text anyway
    // keep queue but stop speaking attempts
  }
}

/**
 * Create HeyGen session + start WebRTC stream.
 * Requires:
 * - backend running
 * - /api/heygen/session returns token
 * - VITE_HEYGEN_AVATAR_ID_* set (otherwise we run text-only)
 */
async function initAvatar({ videoEl, statusEl, mode }) {
  const avatarId = getAvatarIdForMode(mode);

  if (!avatarId) {
    textOnly = true;
    setStatus(statusEl, "Text-only mode (missing HeyGen avatar id in frontend .env)");
    return;
  }

  try {
    setStatus(statusEl, "Connecting avatar…");

    // Create session server-side (keeps HEYGEN_API_KEY private)
    const res = await fetch(`${API_BASE}/api/heygen/session`, { method: "POST" });
    if (!res.ok) {
      const errTxt = await res.text().catch(() => "");
      throw new Error(`Session failed (${res.status}): ${errTxt}`);
    }
    sessionData = await res.json();

    // Token mapping: support a couple shapes
    const token =
      sessionData?.data?.token ||
      sessionData?.token ||
      sessionData?.data?.session?.token ||
      sessionData?.data?.data?.token;

    if (!token) {
      throw new Error(`No token found in /api/heygen/session response`);
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

    // Start stream (low quality = faster). Provide avatarId.
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
    setStatus(statusEl, `Text-only fallback (avatar init error)`);
    // caller logs details
    throw e;
  }
}

/**
 * Send a message to backend and speak chunks (non-streaming but low perceived latency).
 * Uses POST /api/heygen/chat which should return:
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

    // Update transcript immediately
    appendLog(logEl, full ? `${full}\n` : `[No response]\n`);

    // Speak in chunks (if avatar is available)
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

  // Optional start button + mode selector if you have them in HTML
  const startBtn = byId("startAvatar"); // optional
  const modeSelect = byId("mode"); // optional <select id="mode"><option value="clinic">...</option>...</select>

  if (!statusEl || !logEl || !inputEl || !sendBtn) {
    throw new Error(
      "Missing required UI elements. Ensure index.html includes ids: status, log, msg, send (and avatarVideo optional)."
    );
  }

  let mode = modeSelect?.value || MODE_DEFAULT;

  // If you have a mode select, update mode
  if (modeSelect) {
    modeSelect.addEventListener("change", () => {
      mode = modeSelect.value;
      setStatus(statusEl, "Mode changed. Ready.");
    });
  }

  // If you want to auto-init avatar on load (reduces first-message WebRTC delay)
  // But if avatar IDs aren't configured, it will fall back to text-only.
  try {
    await initAvatar({ videoEl, statusEl, mode });
  } catch (e) {
    appendLog(logEl, `\n[Avatar init error] ${String(e)}\n`);
  }

  // Optional "Start Avatar" button behavior (if present in HTML)
  if (startBtn) {
    startBtn.onclick = async () => {
      try {
        textOnly = false;
        await initAvatar({ videoEl, statusEl, mode });
      } catch (e) {
        appendLog(logEl, `\n[Avatar init error] ${String(e)}\n`);
      }
    };
  }

  // Send message click
  sendBtn.onclick = () => {
    const msg = inputEl.value.trim();
    if (!msg) return;
    inputEl.value = "";
    sendMessage({ message: msg, mode, logEl, statusEl });
  };

  // Enter-to-send
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendBtn.click();
    }
  });
});
