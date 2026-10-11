# 🌲 TrailWhisper — Offline AI Trail Companion

> **Listen closer. Discover more.**  
> An audio-first, 100% offline nature companion that identifies bird calls and teaches you about wildlife on the trail without screen staring or cloud dependency.

Built for **Hacktoberfest**. Designed for real nature walks where cellular signal drops to zero.

---

## 🌟 Features & Highlights

- **Audio-First Experience**: Tap **Record Audio**, capture 5 seconds of nature sound, and let TrailWhisper do the rest.
- **Hands-Free Nature Audio Feedback**: Speaks bird call insights out loud using the browser's native **SpeechSynthesis API** so you can keep your eyes on the trail.
- **100% Offline Architecture**: Zero external CDNs, zero cloud APIs (Zero OpenAI/Anthropic), zero tracking. All assets, stylesheets, icons, and AI components run locally on your device.
- **Dual-Engine Bird Identification**:
  - **Local BirdNET Adapter**: Employs local acoustic neural networks when model weights and dependencies are available.
  - **Deterministic Demo Classifier**: If TensorFlow or C++ wheels are absent on Windows, gracefully falls back to a deterministic, labeled Demo Mode covering 5 hallmark North American songbirds:
    - *American Robin* (`Turdus migratorius`)
    - *Black-capped Chickadee* (`Poecile atricapillus`)
    - *Blue Jay* (`Cyanocitta cristata`)
    - *Northern Cardinal* (`Cardinalis cardinalis`)
    - *Mourning Dove* (`Zenaida macroura`)
- **Strictly Local LLM Integration**: Connects directly to local [Ollama](https://ollama.com) (`http://localhost:11434`) running `llama3.2:1b` (or `llama3.2:3b`) to synthesize strictly two concise, conversational sentences explaining the call.
- **Zero-Failure Offline Explainer**: If Ollama is offline or times out, seamlessly provides pre-curated, species-specific field insights labeled `Fallback Explainer (Ollama Offline)`.
- **Persistent Trail Journal**: Stores every sighting and acoustic observation in an offline SQLite database (`trailwhisper.db`).
- **Audio Decoding Safety**: Built to handle raw `audio/webm`, `audio/ogg`, or PCM `audio/wav` from the browser without crashing if system-level `ffmpeg` is missing.

---

## 📂 Project Structure

```
trailwhisper/
├── app.py                # FastAPI server, SQLite database, BirdNET adapter & Ollama client
├── requirements.txt      # Lightweight, clean Python dependencies
├── README.md             # Comprehensive offline setup & usage guide
├── .gitignore            # Git exclusion rules for virtualenv, DB, & temp files
├── templates/
│   └── index.html        # Clean, semantic HTML5 interface (zero external CDNs)
└── static/
    ├── style.css         # Modern, high-contrast forest trail CSS theme
    └── app.js            # Vanilla JavaScript (MediaRecorder, SpeechSynthesis, visualizer)
```

---

## 🚀 Quickstart Guide (Windows PowerShell)

Follow these steps in Windows PowerShell to set up and launch TrailWhisper.

### 1. Create and Activate Virtual Environment

Open PowerShell in the project directory:

```powershell
# Navigate into the project folder
cd trailwhisper

# Create a virtual environment named 'venv'
python -m venv venv

# Activate the virtual environment
.\venv\Scripts\Activate.ps1
```

*(Note: If PowerShell displays an ExecutionPolicy error, run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned` and re-run activate).*

### 2. Install Python Dependencies

Install the core, lightweight dependencies:

```powershell
pip install -r requirements.txt
```

### 3. (Optional) Start Ollama & Pull the Model

To enable local LLM explanations, download [Ollama for Windows](https://ollama.com/download) and run:

```powershell
# Start Ollama service (if not already running in system tray)
ollama run llama3.2:1b
```

> **Note**: If you don't install or run Ollama, TrailWhisper **automatically and seamlessly falls back** to its built-in offline species explainers without any errors!

### 4. Start the TrailWhisper Server

Launch the local FastAPI server using Uvicorn:

```powershell
uvicorn app:app --reload --host 127.0.0.1 --port 8000
```

Once started, open your web browser to:
👉 **[http://localhost:8000](http://localhost:8000)**

---

## ✈️ Running in True Airplane Mode (Off-Grid Trail Walk)

TrailWhisper is designed from the ground up to operate completely disconnected from the internet:

1. **Before leaving home**:
   - Turn on your computer or mobile hotspot device.
   - Run `ollama run llama3.2:1b` (optional) to make sure weights are cached locally.
   - Start `uvicorn app:app --host 0.0.0.0 --port 8000`.
   - Open `http://localhost:8000` in your browser.
2. **On the trail**:
   - Enable **Airplane Mode** (Wi-Fi and Cellular disconnected).
   - Tap **Record Audio** on TrailWhisper.
   - The browser records 5 seconds of audio via the local MediaStream API, analyzes it against the local classifier, generates conversational notes, speaks them aloud via native browser speech synthesis, and saves the observation to your local SQLite database!

---

## 🎧 The 5-Second Trail Workflow

```
[Tap 'Record Audio'] 
       │
       ▼
[Microphone records 5s soundbite + Real-time Canvas Waveform]
       │
       ▼
[POST /api/identify with multipart audio data]
       │
       ├─► [Audio Safety Check: Detect silence/corruption]
       │
       ├─► [Bird Identification: Local BirdNET or Deterministic Demo Classifier]
       │
       ├─► [Insight Synthesis: Ollama llama3.2:1b or Pre-curated Offline Fact]
       │
       └─► [Persist to SQLite Trail Journal]
       │
       ▼
[Result Card Revealed + SpeechSynthesis automatically speaks insight out loud]
```

---

## 🛠️ REST API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Serves the TrailWhisper single-page offline web application. |
| `GET` | `/api/health` | Health check endpoint returning app status, version, and mode. |
| `GET` | `/api/status` | Detailed diagnostics (Backend, BirdNET status, Ollama status & models, SQLite observation count). |
| `POST` | `/api/identify` | Accepts uploaded 5-second audio (`multipart/form-data`), identifies species, synthesizes explanation, records in SQLite, and returns JSON. |
| `GET` | `/api/journal` | Returns all recorded observations from the local SQLite database. |
| `DELETE` | `/api/journal` | Clears all observations from the database (with confirmation). |

---

## 🧪 Automated Testing

A comprehensive test suite is included in `test_workflow.py` to verify all routes, error states, and safety fallbacks without needing manual clicks:

```powershell
python test_workflow.py
```

The test suite validates:
1. `GET /api/health` — 200 OK health response.
2. `GET /api/status` — Reports system component status.
3. `POST /api/identify` with **silent/empty audio** — Properly rejects with 400 Bad Request and friendly feedback.
4. `POST /api/identify` with **5s synthetic bird audio** — Accurately identifies demo species, formats 2-sentence explanation, and tags source.
5. `GET /api/journal` — Confirms record is saved in SQLite database.
6. `DELETE /api/journal` — Confirms journal can be safely reset.
7. `GET /` — Validates HTML single-page web app is delivered properly.
8. **WebM/OGG safe decoding** — Verifies audio processing succeeds without crashing even if system `ffmpeg` is missing.

---

## 📜 License

Created with ❤️ for Hacktoberfest. Distributed under the MIT License.
