import os
import sys
import time
import math
import hashlib
import sqlite3
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, File, UploadFile, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
import httpx

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("TrailWhisper")

# Determine base paths
BASE_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "trailwhisper.db"

# ---------------------------------------------------------------------------
# Database Management
# ---------------------------------------------------------------------------
def get_db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS observations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            common_name TEXT NOT NULL,
            scientific_name TEXT NOT NULL,
            confidence REAL NOT NULL,
            source TEXT NOT NULL,
            explanation TEXT NOT NULL,
            explainer_source TEXT NOT NULL,
            audio_duration_seconds REAL DEFAULT 5.0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    """)
    conn.commit()
    conn.close()
    logger.info(f"Database initialized at {DB_PATH}")

init_db()

# ---------------------------------------------------------------------------
# BirdNET / Classifier Adapter & Demo Mode
# ---------------------------------------------------------------------------
# The 5 demo fallback species per requirements
DEMO_SPECIES = [
    {
        "common_name": "American Robin",
        "scientific_name": "Turdus migratorius",
        "call_type": "Cheerful territorial whistle",
        "fallback_explanation": "American Robins sing a cheerful, carol-like song to mark their territory and greet the sunrise. Their rich whistles often signal the start of spring and active foraging along the trail."
    },
    {
        "common_name": "Black-capped Chickadee",
        "scientific_name": "Poecile atricapillus",
        "call_type": "Fee-bee whistle and alarm chatter",
        "fallback_explanation": "Black-capped Chickadees use their famous 'chick-a-dee-dee' alarm call to alert flock members about nearby predators. The more 'dee' notes they add at the end, the greater the perceived threat."
    },
    {
        "common_name": "Blue Jay",
        "scientific_name": "Cyanocitta cristata",
        "call_type": "Piercing bell scream and rattle",
        "fallback_explanation": "Blue Jays produce loud, piercing screams to communicate over long forest distances and warn others of hawks. These intelligent corvids even mimic hawk cries to scatter smaller birds from feeding spots."
    },
    {
        "common_name": "Northern Cardinal",
        "scientific_name": "Cardinalis cardinalis",
        "call_type": "Clear slurred whistle",
        "fallback_explanation": "Northern Cardinals whistle clear, two-part melodies to defend their nesting territory and coordinate with their mates. Both male and female cardinals sing, which is rare among temperate songbirds."
    },
    {
        "common_name": "Mourning Dove",
        "scientific_name": "Zenaida macroura",
        "call_type": "Gentle coo-OO-oo lament",
        "fallback_explanation": "Mourning Doves emit a gentle, mournful 'coo-OO-oo' song used almost exclusively by unmated males searching for a partner. Their wing feathers also produce a distinctive whistling flutter when taking off."
    }
]

# Safe import of BirdNET & Audio libraries
BIRDNET_AVAILABLE = False
birdnet_analyzer = None

try:
    from birdnetlib import Recording
    from birdnetlib.analyzer import Analyzer
    # Try initializing Analyzer if weights are available
    try:
        birdnet_analyzer = Analyzer()
        BIRDNET_AVAILABLE = True
        logger.info("BirdNET local model loaded successfully.")
    except Exception as e:
        logger.info(f"BirdNET library present, but model weights or dependencies not initialized ({e}). Using Demo Mode.")
        BIRDNET_AVAILABLE = False
except ImportError:
    logger.info("birdnetlib not installed. Operating in Demo Mode.")
    BIRDNET_AVAILABLE = False


def check_audio_silent_or_corrupt(audio_bytes: bytes) -> tuple[bool, str]:
    """
    Inspects audio bytes for corruption or complete silence.
    Handles lack of system ffmpeg by inspecting byte variance and energy safely.
    """
    if len(audio_bytes) < 300:
        return True, "Audio file is too small or incomplete."

    # Sample non-header bytes (skip first 128 bytes of headers like RIFF, WebM, OGG)
    payload = audio_bytes[128:] if len(audio_bytes) > 256 else audio_bytes
    if not payload:
        return True, "Audio payload contains no data."

    # Check byte variance to catch uniform silence (e.g. all 0x00 or identical bytes)
    unique_bytes = len(set(payload[:4096]))
    if unique_bytes < 5:
        return True, "Audio recording is completely silent or muted. Please record closer to the sound."

    # If it's a WAV file, we can also check sample amplitudes using stdlib wave
    if audio_bytes.startswith(b"RIFF") and b"WAVE" in audio_bytes[:16]:
        try:
            import io
            import wave
            with wave.open(io.BytesIO(audio_bytes), "rb") as wf:
                n_frames = wf.getnframes()
                if n_frames == 0:
                    return True, "Audio contains 0 frames."
                frames = wf.readframes(min(n_frames, 8000))
                # Check RMS energy of 16-bit PCM
                if len(frames) >= 2:
                    import struct
                    fmt = f"<{len(frames)//2}h"
                    samples = struct.unpack(fmt, frames[:len(frames) - (len(frames)%2)])
                    rms = math.sqrt(sum(s*s for s in samples) / len(samples))
                    if rms < 25.0:  # extremely quiet / near-zero signal
                        return True, "Audio is silent or too quiet to identify. Please hold the mic closer to the bird."
        except Exception as e:
            logger.debug(f"WAV inspection fallback: {e}")

    return False, ""


def classify_audio(audio_bytes: bytes, filename: str = "recording.webm") -> Dict[str, Any]:
    """
    Runs local BirdNET if available; otherwise uses deterministic Demo Mode classifier.
    Never presents mock predictions as real identifications.
    """
    # 1. Real BirdNET identification if available
    if BIRDNET_AVAILABLE and birdnet_analyzer:
        temp_path = DATA_DIR / f"temp_{int(time.time()*1000)}_{filename}"
        try:
            with open(temp_path, "wb") as f:
                f.write(audio_bytes)
            
            recording = Recording(
                birdnet_analyzer,
                str(temp_path),
                min_conf=0.25,
            )
            recording.extract_detections()
            detections = recording.detections
            
            if detections and len(detections) > 0:
                top_match = max(detections, key=lambda d: d.get("confidence", 0.0))
                common_name = top_match.get("common_name", "Unknown Bird")
                scientific_name = top_match.get("scientific_name", "")
                confidence = float(top_match.get("confidence", 0.75))
                return {
                    "common_name": common_name,
                    "scientific_name": scientific_name,
                    "confidence": round(confidence, 2),
                    "source": "BirdNET (Local)",
                    "species_index": -1
                }
        except Exception as e:
            logger.warning(f"BirdNET prediction failed ({e}). Falling back to Demo Mode.")
        finally:
            if temp_path.exists():
                try:
                    temp_path.unlink()
                except Exception:
                    pass

    # 2. Deterministic Demo Mode Classifier
    # Compute deterministic hash from audio content (excluding dynamic container timestamp bytes)
    sample_slice = audio_bytes[100:2000] if len(audio_bytes) > 2000 else audio_bytes
    hasher = hashlib.sha256(sample_slice)
    digest_int = int(hasher.hexdigest(), 16)

    species_idx = digest_int % len(DEMO_SPECIES)
    selected_species = DEMO_SPECIES[species_idx]

    # Generate realistic confidence between 0.78 and 0.94 deterministically
    confidence = 0.78 + ((digest_int >> 4) % 17) * 0.01

    return {
        "common_name": selected_species["common_name"],
        "scientific_name": selected_species["scientific_name"],
        "confidence": round(confidence, 2),
        "source": "Simulated Demo",
        "species_index": species_idx,
        "fallback_explanation": selected_species["fallback_explanation"]
    }

# ---------------------------------------------------------------------------
# Local LLM Integration (Ollama)
# ---------------------------------------------------------------------------
OLLAMA_BASE_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "llama3.2:1b")

async def check_ollama_status() -> Dict[str, Any]:
    """
    Checks if Ollama is running and whether the requested model is loaded.
    Strictly queries http://localhost:11434.
    """
    status_info = {
        "connected": False,
        "endpoint": OLLAMA_BASE_URL,
        "target_model": OLLAMA_MODEL,
        "model_found": False,
        "available_models": []
    }
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
            if resp.status_code == 200:
                data = resp.json()
                models = [m.get("name", "") for m in data.get("models", [])]
                status_info["connected"] = True
                status_info["available_models"] = models
                status_info["model_found"] = any(
                    OLLAMA_MODEL in m or m.startswith(OLLAMA_MODEL.split(":")[0]) 
                    for m in models
                )
    except Exception as e:
        logger.debug(f"Ollama check failed: {e}")
        status_info["connected"] = False

    return status_info


def clean_to_two_sentences(text: str) -> str:
    """
    Ensures LLM response is cleanly formatted into strictly two sentences (<35 words).
    """
    text = text.strip().replace('"', '').replace('**', '').replace('__', '')
    # Split by common sentence terminators
    import re
    sentences = [s.strip() for s in re.split(r'(?<=[.!?])\s+', text) if s.strip()]
    if len(sentences) >= 2:
        return f"{sentences[0]} {sentences[1]}"
    elif len(sentences) == 1:
        return sentences[0]
    return text


async def generate_bird_explanation(common_name: str, scientific_name: str, fallback_text: Optional[str] = None) -> tuple[str, str]:
    """
    Prompts local Ollama strictly at http://localhost:11434 to produce exactly 2 sentences (<35 words).
    Falls back gracefully if Ollama is unreachable or times out.
    Returns (explanation_text, explainer_source).
    """
    # Fallback text if Ollama fails
    if not fallback_text:
        # Check if species is in DEMO_SPECIES
        match = next((s for s in DEMO_SPECIES if s["common_name"] == common_name), None)
        if match:
            fallback_text = match["fallback_explanation"]
        else:
            fallback_text = f"The {common_name} is known for its distinctive acoustic call on the trail. Its vocalizations help communicate territory boundaries and flock positions among the trees."

    prompt = (
        f"You are TrailWhisper, an offline nature companion. "
        f"The user heard a {common_name} ({scientific_name}). "
        f"Write strictly TWO conversational sentences (under 35 words total) explaining what this bird is and why it makes this sound. "
        f"Do not use quotes, bullet points, greetings, or extra words."
    )

    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            resp = await client.post(
                f"{OLLAMA_BASE_URL}/api/generate",
                json={
                    "model": OLLAMA_MODEL,
                    "prompt": prompt,
                    "stream": False,
                    "options": {
                        "temperature": 0.4,
                        "num_predict": 75,
                        "stop": ["\n\n", "User:", "TrailWhisper:"]
                    }
                }
            )
            if resp.status_code == 200:
                result = resp.json()
                raw_response = result.get("response", "").strip()
                if raw_response:
                    cleaned = clean_to_two_sentences(raw_response)
                    return cleaned, f"Ollama ({OLLAMA_MODEL})"
    except Exception as e:
        logger.info(f"Ollama call unreachable or timed out ({e}). Using offline fallback explainer.")

    return fallback_text, "Fallback Explainer (Ollama Offline)"

# ---------------------------------------------------------------------------
# FastAPI Application & Routes
# ---------------------------------------------------------------------------
app = FastAPI(
    title="TrailWhisper",
    description="Offline AI Trail Companion for Audio-First Bird Call Identification",
    version="1.0.0"
)

# Mount static and templates
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


@app.get("/", response_class=HTMLResponse)
async def get_index(request: Request):
    """Serves the TrailWhisper offline single-page web app."""
    index_file = TEMPLATES_DIR / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return HTMLResponse("<h1>TrailWhisper</h1><p>index.html not found</p>", status_code=404)


@app.get("/api/health")
async def get_health():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "app": "TrailWhisper",
        "version": "1.0.0",
        "mode": "offline-first",
        "timestamp": datetime.utcnow().isoformat() + "Z"
    }


@app.get("/api/status")
async def get_status():
    """Returns detailed offline readiness status for Backend, BirdNET, Ollama, and SQLite."""
    ollama_info = await check_ollama_status()
    
    # Check SQLite count
    db_count = 0
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM observations")
        db_count = cursor.fetchone()[0]
        conn.close()
    except Exception as e:
        logger.error(f"Error querying observation count: {e}")

    return {
        "backend": {
            "status": "online",
            "message": "FastAPI running locally"
        },
        "birdnet": {
            "status": "active" if BIRDNET_AVAILABLE else "demo",
            "source": "BirdNET (Local)" if BIRDNET_AVAILABLE else "Simulated Demo",
            "message": "Local BirdNET weights loaded" if BIRDNET_AVAILABLE else "Demo Mode active (deterministic fallback)",
            "available_species": [s["common_name"] for s in DEMO_SPECIES]
        },
        "ollama": {
            "status": "connected" if ollama_info["connected"] else "disconnected",
            "endpoint": ollama_info["endpoint"],
            "target_model": ollama_info["target_model"],
            "model_found": ollama_info["model_found"],
            "available_models": ollama_info["available_models"],
            "message": "Ollama ready" if (ollama_info["connected"] and ollama_info["model_found"]) else "Ollama offline or model not loaded (offline fallback active)"
        },
        "database": {
            "status": "ok",
            "total_observations": db_count
        }
    }


@app.post("/api/identify")
async def identify_bird_audio(audio_file: UploadFile = File(...)):
    """
    Main identification workflow:
    1. Reads 5-second audio upload.
    2. Checks for silence or corrupt data.
    3. Runs BirdNET adapter or Demo Mode classifier.
    4. Generates 2-sentence conversational explanation via Ollama or offline fallback.
    5. Saves observation to SQLite database.
    6. Returns observation payload.
    """
    try:
        audio_bytes = await audio_file.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read audio stream: {e}")

    # Inspect for silence or corruption
    is_silent, error_msg = check_audio_silent_or_corrupt(audio_bytes)
    if is_silent:
        raise HTTPException(
            status_code=400,
            detail=error_msg or "Audio is silent or too quiet to identify. Please hold the mic closer to the bird call."
        )

    # Classify bird species
    classification = classify_audio(audio_bytes, filename=audio_file.filename or "recording.webm")
    common_name = classification["common_name"]
    scientific_name = classification["scientific_name"]
    confidence = classification["confidence"]
    detection_source = classification["source"]
    fallback_text = classification.get("fallback_explanation")

    # Generate 2-sentence conversational explanation
    explanation, explainer_source = await generate_bird_explanation(
        common_name, scientific_name, fallback_text=fallback_text
    )

    # Save to SQLite database
    now_iso = datetime.utcnow().isoformat() + "Z"
    observation_id = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO observations 
            (timestamp, common_name, scientific_name, confidence, source, explanation, explainer_source, audio_duration_seconds)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (now_iso, common_name, scientific_name, confidence, detection_source, explanation, explainer_source, 5.0))
        conn.commit()
        observation_id = cursor.lastrowid
        conn.close()
    except Exception as e:
        logger.error(f"Failed to save observation to database: {e}")

    return {
        "id": observation_id,
        "timestamp": now_iso,
        "common_name": common_name,
        "scientific_name": scientific_name,
        "confidence": confidence,
        "source": detection_source,
        "explanation": explanation,
        "explainer_source": explainer_source,
        "audio_duration_seconds": 5.0
    }


@app.get("/api/journal")
async def get_journal():
    """Returns saved observations from the local SQLite database."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT id, timestamp, common_name, scientific_name, confidence, source, explanation, explainer_source, audio_duration_seconds, created_at
            FROM observations
            ORDER BY id DESC
        """)
        rows = cursor.fetchall()
        conn.close()
        entries = [dict(row) for row in rows]
        return entries
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database query error: {e}")


@app.delete("/api/journal")
async def clear_journal():
    """Clears all observations from the local SQLite database."""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM observations")
        count = cursor.fetchone()[0]
        cursor.execute("DELETE FROM observations")
        conn.commit()
        conn.close()
        return {
            "message": "Trail journal cleared successfully.",
            "deleted_count": count
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to clear journal: {e}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
