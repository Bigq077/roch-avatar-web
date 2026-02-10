import StreamingAvatar, { AvatarQuality, StreamingEvents } from "@heygen/streaming-avatar";

const API_BASE = "http://localhost:8000";

const videoEl = document.getElementById("avatarVideo");
const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");
const inputEl = document.getElementById("msg");
const sendBtn = document.getElementById("send");

let avatar = null;
let sessionData = null;

let speakQueue = [];
let isSpeaking = false;

// --- 1) Connect avatar session ASAP (page load) ---
async function initAvatar() {
  statusEl.textContent = "Connecting avatar…";

  // Create session server-side (keeps HEYGEN_API_KEY private)
  const res = await fetch(`${API_BASE}/api/heygen/session`, { method: "POST" });
  sessionData = await res.json();

  // Initialize SDK with returned session data
  avatar = new StreamingAvatar({ token: sessionData.data?.token || sessionData.token }); 
  // ^ token field depends on HeyGen response; map it once you see your payload.

  // Listen for speaking events so we can feed chunks without overlap
  avatar.on(StreamingEvents.AVATAR_START_TALKING, () => { isSpeaking = true; });
  avatar.on(StreamingEvents.AVATAR_STOP_TALKING, () => {
    isSpeaking = false;
    pumpQueue();
  });

  // Start stream (quality low = faster)
  const stream = await avatar.createStartAvatar({
    quality: AvatarQuality.Low,
    // avatarId: "...", voiceId: "...", etc per your HeyGen config
  });

  // Attach WebRTC video stream to <video>
  videoEl.srcObject = stream;

  statusEl.textContent = "Ready";
}

function enqueueSpeak(text) {
  const cleaned = text.trim();
  if (!cleaned) return;
  speakQueue.push(cleaned);
  pumpQueue();
}

async function pumpQueue() {
  if (!avatar) return;
  if (isSpeaking) return;
  const next = speakQueue.shift();
  if (!next) return;

  statusEl.textContent = "Speaking…";
  try {
    // Speak text through HeyGen
    await avatar.speak({ text: next });
  } catch (e) {
    statusEl.textContent = "Text-only fallback (avatar error)";
    logEl.textContent += `\n[Avatar error] ${String(e)}`;
  }
}

// --- 2) Stream LLM output (SSE) and chunk it into speakable pieces ---
async function sendMessage(message) {
  logEl.textContent += `\n\nYou: ${message}\nAvatar: `;

  const url = new URL(`${API_BASE}/api/avatar/stream`);
  url.searchParams.set("mode", "clinic");
  url.searchParams.set("message", message);

  const evtSource = new EventSource(url.toString());

  let buffer = "";
  let spokenSoFar = "";

  // chunk rules (latency target):
  // - speak when we have a full sentence OR ~16 words
  const shouldFlush = (txt) => {
    const words = txt.trim().split(/\s+/).filter(Boolean);
    const hasSentenceEnd = /[.?!:]\s$/.test(txt);
    return hasSentenceEnd || words.length >= 16;
  };

  evtSource.onmessage = (ev) => {
    if (ev.data === "[DONE]") {
      evtSource.close();
      // flush remainder
      if (buffer.trim()) enqueueSpeak(buffer);
      statusEl.textContent = "Ready";
      return;
    }

    buffer += ev.data;           // token
    buffer += " ";

    // update on-screen transcript immediately
    logEl.textContent += ev.data + " ";

    // speak early: first sentence ASAP, then continue in chunks
    if (shouldFlush(buffer)) {
      enqueueSpeak(buffer);
      spokenSoFar += buffer;
      buffer = "";
    }
  };

  evtSource.onerror = () => {
    evtSource.close();
    statusEl.textContent = "Text-only fallback (stream error)";
  };
}

sendBtn.onclick = () => {
  const msg = inputEl.value.trim();
  if (!msg) return;
  inputEl.value = "";
  sendMessage(msg);
};

// Start the avatar immediately to avoid first-message WebRTC delay
initAvatar();

