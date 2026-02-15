import * as HeyGen from "@heygen/streaming-avatar";

/**
 * Works with @heygen/streaming-avatar@1.0.16 by importing the module namespace
 * and resolving the constructor + enums from whatever keys exist.
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

// Resolve exports safely for v1.0.16
const StreamingAvatarCtor =
  HeyGen.StreamingAvatar ||
  HeyGen.default ||
  HeyGen.StreamingAvatarClient ||
  HeyGen.StreamingAvatarSDK;

const AvatarQuality = HeyGen.AvatarQuality || HeyGen.Quality || {};
const StreamingEvents = HeyGen.StreamingEvents || HeyGen.Events || {};

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

function extractToken(payload) {
  if (payload?.token && typeof payload.token === "string") return payload.token;
  if (payload?.data?.token && typeof payload.data.token === "string") return payload.data.token;
  if (payload?.data?.token?.token && typeof payload.data.token.token === "string") return payload.data.token.token;
  if (payload?.data?.data?.token && typeof payload.data.data.token === "string") return payload.data.data.token;
  return null;
}

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
  } catch {
    textOnly = true;
  }
}

async function initAvatar({ videoEl, statusEl, logEl, mode }) {
  const avatarId = getAvatarIdForMode(mode);

  if (!avatarId) {
    textOnly = true;
    setStatus(statusEl, "Text-only mode (missing HeyGen avatar id in frontend .env)");
    return;
  }

  if (typeof StreamingAvatarCtor !== "function") {
    textOnly = true;
    setStatus(statusEl, "Text-only fallback (HeyGen SDK export mismatch)");
    appendLog(
      logEl,
      `\n[Avatar init error] Could not resolve StreamingAvatar constructor.\n` +
        `Available exports:\n${Object.keys(HeyGen).join(", ")}\n`
    );
    return;
  }

  try {
    setStatus(statusEl, "Connecting avatar…");

    const res = await fetch(`${API_BASE}/api/heygen/session/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ avatar_id: avatarId, mode }),
    });

    if (!res.ok) {
      const errTxt = await res.text().catch(() => "");
      throw new Error(`Session failed (${res.status}): ${errTxt}`);
    }

    sessionData = await res.json();
    const token = extractToken(sessionData);

    if (!token) {
      textOnly = true;
      avatarReady = false;
      setStatus(statusEl, "Text-only fallback (no HeyGen token returned)");
      appendLog(logEl, `\n[Avatar init error] No token returned.\n${JSON.stringify(sessionData, null, 2)}\n`);
      return;
    }

    // Construct SDK client
    avatar = new StreamingAvatarCtor({ token });

    // Hook events if available
    const startEvt =
      StreamingEvents.AVATAR_START_TALKING || StreamingEvents.StartTalking || StreamingEvents.START_TALKING;
    const stopEvt =
      StreamingEvents.AVATAR_STOP_TALKING || StreamingEvents.StopTalking || StreamingEvents.STOP_TALKING;

    if (startEvt) {
      avatar.on(startEvt, () => {
        isSpeaking = true;
        setStatus(statusEl, "Speaking…");
      });
    }
    if (stopEvt) {
      avatar.on(stopEvt, () => {
        isSpeaking = false;
        setStatus(statusEl, "Ready");
        pumpQueue();
      });
    }

    // Pick quality key
    const lowQuality = AvatarQuality.Low || AvatarQuality.low || "low";

    // Start avatar stream (support both param names)
    const stream = await avatar.createStartAvatar({
      quality: lowQuality,
      avatarId,
      avatarName: avatarId,
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

async function sendMessage({ message, mode, logEl, statusEl }) {
  appendLog(logEl, `\n\nYou: ${message}\nAvatar: `);
  setStatus(statusEl, "Thinking…");

  try {
    const res = await fetch(`${API_BASE}/api/heygen/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, message, history: [] }),
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

window.addEventListener("DOMContentLoaded", async () => {
  const videoEl = byId("avatarVideo");
  const statusEl = byId("status");
  const logEl = byId("log");
  const inputEl = byId("msg");
  const sendBtn = byId("send");

  const startBtn = byId("startAvatar"); // optional
  const modeSelect = byId("mode"); // optional

  if (!statusEl || !logEl || !inputEl || !sendBtn) {
    throw new Error("Missing required UI elements: status, log, msg, send.");
  }

  let mode = modeSelect?.value || MODE_DEFAULT;

  if (modeSelect) {
    modeSelect.addEventListener("change", () => {
      mode = modeSelect.value;
      setStatus(statusEl, "Mode changed. Ready.");
    });
  }

  // auto-init
  await initAvatar({ videoEl, statusEl, logEl, mode });

  if (startBtn) {
    startBtn.onclick = async () => {
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
