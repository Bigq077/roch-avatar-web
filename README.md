# Theorem Health & Wellness - Interactive Avatar

Production-ready conversational avatars for clinic and rehabilitation support.

## 🎯 Features

- **Clinic Avatar** — Mark's digital presence for explaining services, answering questions, encouraging bookings
- **Rehab Avatar** — Exercise guide for supporting patients between sessions
- **Low Latency** — Cached responses + sentence chunking for 1-2s perceived latency
- **Safety First** — Emergency detection, medical boundaries, clear escalation
- **Production Ready** — Error handling, fallbacks, monitoring

## 📁 Structure

```
avatar/
├── backend/          # FastAPI backend
│   ├── app/
│   │   ├── main.py              # FastAPI app
│   │   ├── prompts/             # System prompts
│   │   │   ├── clinic_avatar.txt
│   │   │   └── rehab_avatar.txt
│   │   ├── knowledge/           # Clinic data
│   │   │   └── clinic_config.json
│   │   └── routes/              # API routes
│   │       ├── heygen.py        # HeyGen integration
│   │       └── stream.py        # Streaming (future)
│   ├── requirements.txt
│   └── .env.example
│
└── frontend/         # Vite + Vanilla JS
    ├── index.html
    ├── src/
    │   ├── main.js              # Entry point
    │   ├── avatar.js            # HeyGen SDK wrapper
    │   ├── ui.js                # UI updates
    │   └── queue.js             # Message queue
    ├── package.json
    └── vite.config.js
```

## 🚀 Quick Start

### 1. Backend Setup

```bash
cd avatar/backend

# Install dependencies
pip install -r requirements.txt

# Create .env file
cp .env.example .env

# Edit .env with your values:
# - BRAIN_API_URL=https://your-brain.onrender.com
# - HEYGEN_API_KEY=xxx
# - ELEVENLABS_VOICE_ID_CLINIC=xxx
# - ELEVENLABS_VOICE_ID_REHAB=xxx

# Run server
uvicorn app.main:app --reload --port 8000
```

### 2. Frontend Setup

```bash
cd avatar/frontend

# Install dependencies
npm install

# Create .env file
cp .env.example .env

# Edit .env:
# - VITE_API_URL=http://localhost:8000
# - VITE_HEYGEN_AVATAR_ID_CLINIC=xxx
# - VITE_HEYGEN_AVATAR_ID_REHAB=xxx

# Run dev server
npm run dev
```

Visit http://localhost:5173

## 🔧 Configuration

### Backend Environment Variables

```env
# Brain API (your existing receptionist brain)
BRAIN_API_URL=https://your-brain.onrender.com

# HeyGen
HEYGEN_API_KEY=your_api_key
HEYGEN_AVATAR_ID_CLINIC=clinic_avatar_id
HEYGEN_AVATAR_ID_REHAB=rehab_avatar_id

# ElevenLabs (voice cloning)
ELEVENLABS_VOICE_ID_CLINIC=mark_voice_id
ELEVENLABS_VOICE_ID_REHAB=neutral_voice_id

# OpenAI (fallback for development)
OPENAI_API_KEY=your_openai_key
OPENAI_MODEL=gpt-4o-mini  # Fast model
USE_OPENAI_FALLBACK=false

# Streaming (future)
ENABLE_STREAMING=false

# Frontend
FRONTEND_URL=http://localhost:5173
```

### Frontend Environment Variables

```env
VITE_API_URL=http://localhost:8000
VITE_HEYGEN_AVATAR_ID_CLINIC=your_clinic_avatar_id
VITE_HEYGEN_AVATAR_ID_REHAB=your_rehab_avatar_id
```

## 🧪 Testing

### Test Backend Health

```bash
curl http://localhost:8000/health
```

Expected response:
```json
{
  "status": "healthy",
  "brain_url": "https://...",
  "heygen_configured": true
}
```

### Test Chat Endpoint

```bash
curl -X POST http://localhost:8000/api/heygen/chat \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "clinic",
    "message": "How much does a physio session cost?"
  }'
```

Expected: Response with `response`, `chunks`, `safety` fields

### Test Cached Responses (instant)

Common questions return cached responses for 0ms latency:
- "How much does it cost?"
- "What are your hours?"
- "Where are you located?"
- "What's your cancellation policy?"
- "Do you take insurance?"

## 📦 Deployment

### Backend (Render/Railway)

1. Connect your repo
2. Set environment variables in dashboard
3. Deploy

### Frontend (Vercel/Netlify)

1. Connect your repo
2. Set `VITE_API_URL` to your backend URL
3. Set avatar IDs
4. Deploy

## ⚡ Latency Optimization

Current setup achieves **1-2s perceived latency**:

1. **Cached responses** — Common questions return instantly (0ms)
2. **Fast model** — Using `gpt-4o-mini` instead of `gpt-4o` (saves 0.5-1s)
3. **Sentence chunking** — Avatar starts speaking after first sentence
4. **Reduced tokens** — `max_tokens=300` instead of 500

### Future: Streaming (0.5-0.8s latency)

Enable streaming by:
1. Adding streaming endpoint to brain API
2. Set `ENABLE_STREAMING=true`
3. Avatar starts speaking after first tokens

## 🛡️ Safety Features

### Emergency Detection
Automatically detects and escalates:
- Chest pain
- Severe shortness of breath
- Neurological symptoms
- Anything urgent

### Medical Boundaries
- No diagnosis
- No treatment changes
- Always emphasize assessment first
- Clear escalation to human contact

### Conversation Safeguards
- Emergency banner displays when triggered
- Response validation
- Error handling with graceful fallbacks

## 🎨 Customization

### Adjust Response Length

In `backend/app/routes/heygen.py`:
```python
max_tokens=300  # Change this
```

### Adjust Chunk Size

In `backend/app/routes/heygen.py`:
```python
if len(current_chunk) + len(sentence) < 120:  # Change this
```

### Add Cached Responses

In `backend/app/routes/heygen.py`, update `CACHED_RESPONSES`:
```python
CACHED_RESPONSES = {
    "your_key": "Your instant response here"
}
```

### Modify Avatar Quality

In `backend/app/routes/heygen.py`:
```python
"quality": "high"  # or "medium", "low"
```

## 📊 Architecture

```
User → Frontend (Vite)
         ↓
      HeyGen SDK
         ↓
   Avatar Backend (FastAPI)
         ↓
   Brain API (Render) → LLM
         ↓
   Response → Chunks → HeyGen → User
```

## 🐛 Troubleshooting

**"Brain API not responding"**
- Check `BRAIN_API_URL` is correct
- Verify brain endpoint exists at `/api/brain/query`
- Test with curl

**"HeyGen session failed"**
- Verify `HEYGEN_API_KEY`
- Check avatar IDs are correct
- Ensure HeyGen SDK loaded in HTML

**"Slow responses"**
- Check if cached responses working
- Verify using `gpt-4o-mini` not `gpt-4o`
- Consider enabling streaming

## 📝 Development Workflow

1. **Local development** — Use `USE_OPENAI_FALLBACK=true` to develop without brain API
2. **Integration testing** — Connect to brain API on Render
3. **Production** — Deploy both backend and frontend

## 🔐 Security Notes

- Never commit `.env` files
- Keep API keys secure
- Use environment variables for all secrets
- Enable CORS only for your frontend domain in production

## 📞 Support

For issues or questions:
1. Check the troubleshooting section
2. Review backend logs
3. Test endpoints with curl
4. Check browser console for frontend errors

## ✅ Pre-Launch Checklist

- [ ] Brain endpoint deployed and tested
- [ ] HeyGen avatars created (clinic + rehab)
- [ ] ElevenLabs voices cloned
- [ ] Backend deployed with all env vars
- [ ] Frontend deployed and connected
- [ ] Cached responses tested
- [ ] Emergency handling tested
- [ ] Tested on mobile devices
- [ ] Session timeout handling tested

## 🚀 You're Ready!

Start the backend, start the frontend, click "Start Avatar", and you're live!
