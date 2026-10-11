/**
 * TrailWhisper — Offline AI Nature Companion
 * Vanilla JavaScript (Zero External Libraries / 100% Offline)
 */

document.addEventListener("DOMContentLoaded", () => {
  // --- DOM Element References ---
  const recordBtn = document.getElementById("record-btn");
  const cancelRecordBtn = document.getElementById("cancel-record-btn");
  const iconMic = document.getElementById("icon-mic");
  const iconSpinner = document.getElementById("icon-spinner");
  const countdownDisplay = document.getElementById("countdown-display");
  const countdownNumber = document.getElementById("countdown-number");
  const pulseRing = document.getElementById("pulse-ring");
  const recordStatusLabel = document.getElementById("record-status-label");
  const recorderFeedback = document.getElementById("recorder-feedback");
  const feedbackText = document.getElementById("feedback-text");
  const waveformCanvas = document.getElementById("waveform-canvas");

  // System Diagnostics Drawer
  const toggleDrawerBtn = document.getElementById("toggle-drawer-btn");
  const diagnosticsDrawer = document.getElementById("diagnostics-drawer");
  const refreshStatusBtn = document.getElementById("refresh-status-btn");
  const dotBackend = document.getElementById("dot-backend");
  const valBackend = document.getElementById("val-backend");
  const dotBirdnet = document.getElementById("dot-birdnet");
  const valBirdnet = document.getElementById("val-birdnet");
  const dotOllama = document.getElementById("dot-ollama");
  const valOllama = document.getElementById("val-ollama");
  const dotTts = document.getElementById("dot-tts");
  const valTts = document.getElementById("val-tts");

  // Result Card Elements
  const resultCard = document.getElementById("result-card");
  const resultSourceBadge = document.getElementById("result-source-badge");
  const resultConfidenceBadge = document.getElementById("result-confidence-badge");
  const resultCommonName = document.getElementById("result-common-name");
  const resultScientificName = document.getElementById("result-scientific-name");
  const resultExplanationText = document.getElementById("result-explanation-text");
  const resultExplainerSource = document.getElementById("result-explainer-source");
  const resultTimestamp = document.getElementById("result-timestamp");
  const replayVoiceBtn = document.getElementById("replay-voice-btn");
  const replayBtnLabel = document.getElementById("replay-btn-label");
  const autoSpeakToggle = document.getElementById("auto-speak-toggle");

  // Journal Elements
  const journalList = document.getElementById("journal-list");
  const journalEmpty = document.getElementById("journal-empty");
  const journalCountBadge = document.getElementById("journal-count-badge");
  const clearJournalBtn = document.getElementById("clear-journal-btn");

  // Confirmation Modal
  const confirmModal = document.getElementById("confirm-modal");
  const modalCancelBtn = document.getElementById("modal-cancel-btn");
  const modalConfirmBtn = document.getElementById("modal-confirm-btn");

  // --- State Variables ---
  let mediaRecorder = null;
  let audioStream = null;
  let audioChunks = [];
  let isRecording = false;
  let isAnalyzing = false;
  let countdownTimer = null;
  let secondsRemaining = 5;
  const RECORD_DURATION_SECONDS = 5;

  // Web Audio Visualizer
  let audioContext = null;
  let analyser = null;
  let visualizerAnimFrame = null;
  const canvasCtx = waveformCanvas.getContext("2d");

  // Speech Synthesis state
  const isSpeechSupported = "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  let currentUtterance = null;
  let currentActiveExplanation = "";

  // Load Auto-Speak preference from localStorage
  const savedAutoSpeak = localStorage.getItem("trailwhisper_auto_speak");
  if (savedAutoSpeak !== null) {
    autoSpeakToggle.checked = savedAutoSpeak === "true";
  }
  autoSpeakToggle.addEventListener("change", () => {
    localStorage.setItem("trailwhisper_auto_speak", autoSpeakToggle.checked);
  });

  // --- Initial Setup ---
  initCanvas();
  checkSpeechSupport();
  fetchSystemStatus();
  fetchJournal();

  // --- Event Listeners ---
  recordBtn.addEventListener("click", handleRecordClick);
  cancelRecordBtn.addEventListener("click", cancelRecording);
  replayVoiceBtn.addEventListener("click", () => speakText(currentActiveExplanation, replayVoiceBtn));
  
  toggleDrawerBtn.addEventListener("click", () => {
    const isClosed = diagnosticsDrawer.classList.contains("closed");
    diagnosticsDrawer.classList.toggle("closed", !isClosed);
    diagnosticsDrawer.setAttribute("aria-expanded", isClosed ? "true" : "false");
  });

  refreshStatusBtn.addEventListener("click", fetchSystemStatus);

  clearJournalBtn.addEventListener("click", () => {
    confirmModal.classList.remove("hidden");
  });

  modalCancelBtn.addEventListener("click", () => {
    confirmModal.classList.add("hidden");
  });

  modalConfirmBtn.addEventListener("click", async () => {
    confirmModal.classList.add("hidden");
    await clearJournalEntries();
  });

  // Close modal when clicking on backdrop
  confirmModal.addEventListener("click", (e) => {
    if (e.target === confirmModal) {
      confirmModal.classList.add("hidden");
    }
  });

  // --- Canvas Waveform Visualizer ---
  function initCanvas() {
    drawIdleWaveform();
  }

  function drawIdleWaveform() {
    if (isRecording) return;
    const width = waveformCanvas.width;
    const height = waveformCanvas.height;
    canvasCtx.clearRect(0, 0, width, height);

    // Draw gentle ambient horizontal line
    canvasCtx.beginPath();
    canvasCtx.strokeStyle = "rgba(52, 211, 153, 0.25)";
    canvasCtx.lineWidth = 2;
    canvasCtx.moveTo(0, height / 2);
    canvasCtx.lineTo(width, height / 2);
    canvasCtx.stroke();
  }

  function startAudioVisualizer(stream) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      audioContext = new AudioCtx();
      const source = audioContext.createMediaStreamSource(stream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      function renderFrame() {
        if (!isRecording) {
          drawIdleWaveform();
          return;
        }
        visualizerAnimFrame = requestAnimationFrame(renderFrame);
        analyser.getByteFrequencyData(dataArray);

        const width = waveformCanvas.width;
        const height = waveformCanvas.height;
        canvasCtx.clearRect(0, 0, width, height);

        const barWidth = (width / bufferLength) * 1.5;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          const barHeight = (dataArray[i] / 255) * (height - 10) + 4;
          canvasCtx.fillStyle = `rgba(52, 211, 153, ${0.4 + (barHeight / height) * 0.6})`;
          canvasCtx.fillRect(x, (height - barHeight) / 2, barWidth - 1, barHeight);
          x += barWidth;
        }
      }
      renderFrame();
    } catch (err) {
      console.warn("Visualizer initialization notice:", err);
    }
  }

  function stopAudioVisualizer() {
    if (visualizerAnimFrame) {
      cancelAnimationFrame(visualizerAnimFrame);
      visualizerAnimFrame = null;
    }
    if (audioContext && audioContext.state !== "closed") {
      audioContext.close().catch(() => {});
      audioContext = null;
    }
    drawIdleWaveform();
  }

  // --- Recording Workflow ---
  async function handleRecordClick() {
    if (isRecording || isAnalyzing) return;
    hideFeedback();

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showFeedback("Your browser does not support audio recording.", "error");
      return;
    }

    try {
      audioChunks = [];
      secondsRemaining = RECORD_DURATION_SECONDS;

      // Request microphone access
      audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: true
        }
      });

      // Prepare MediaRecorder with supported format
      let mimeType = "";
      if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
        mimeType = "audio/webm;codecs=opus";
      } else if (MediaRecorder.isTypeSupported("audio/webm")) {
        mimeType = "audio/webm";
      } else if (MediaRecorder.isTypeSupported("audio/ogg")) {
        mimeType = "audio/ogg";
      }

      const options = mimeType ? { mimeType } : {};
      mediaRecorder = new MediaRecorder(audioStream, options);

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunks.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const recordedBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType || "audio/webm" });
        cleanUpMediaStream();
        if (isRecording) {
          // Completed normally
          setAnalyzingState();
          await processAudio(recordedBlob);
        }
      };

      // Set recording UI state
      setRecordingState();
      mediaRecorder.start(250);
      startAudioVisualizer(audioStream);

      // 5-second countdown timer
      countdownTimer = setInterval(() => {
        secondsRemaining -= 1;
        countdownNumber.textContent = secondsRemaining;
        recordStatusLabel.textContent = `Recording trail audio (${secondsRemaining}s)...`;

        if (secondsRemaining <= 0) {
          clearInterval(countdownTimer);
          countdownTimer = null;
          if (mediaRecorder && mediaRecorder.state === "recording") {
            mediaRecorder.stop();
          }
        }
      }, 1000);

    } catch (err) {
      console.error("Microphone access error:", err);
      cleanUpMediaStream();
      resetRecordingUI();
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        showFeedback("Microphone permission was denied. Please allow microphone access to record bird calls.", "error");
      } else {
        showFeedback(`Microphone error: ${err.message || "Could not access microphone."}`, "error");
      }
    }
  }

  function cancelRecording() {
    if (!isRecording) return;
    clearInterval(countdownTimer);
    countdownTimer = null;
    isRecording = false;

    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      try {
        mediaRecorder.stop();
      } catch (e) {}
    }
    cleanUpMediaStream();
    stopAudioVisualizer();
    resetRecordingUI();
    showFeedback("Recording cancelled.", "info");
  }

  function cleanUpMediaStream() {
    if (audioStream) {
      audioStream.getTracks().forEach((track) => track.stop());
      audioStream = null;
    }
    stopAudioVisualizer();
  }

  // UI State Transitions
  function setRecordingState() {
    isRecording = true;
    isAnalyzing = false;
    recordBtn.disabled = false;
    recordBtn.classList.add("recording");
    recordBtn.classList.remove("analyzing");
    pulseRing.classList.add("active-recording");

    iconMic.classList.add("hidden");
    iconSpinner.classList.add("hidden");
    countdownDisplay.classList.remove("hidden");
    countdownNumber.textContent = RECORD_DURATION_SECONDS;

    cancelRecordBtn.classList.remove("hidden");
    recordStatusLabel.textContent = `Recording trail audio (${RECORD_DURATION_SECONDS}s)...`;
  }

  function setAnalyzingState() {
    isRecording = false;
    isAnalyzing = true;
    recordBtn.disabled = true;
    recordBtn.classList.remove("recording");
    recordBtn.classList.add("analyzing");
    pulseRing.classList.remove("active-recording");

    countdownDisplay.classList.add("hidden");
    iconMic.classList.add("hidden");
    iconSpinner.classList.remove("hidden");

    cancelRecordBtn.classList.add("hidden");
    recordStatusLabel.textContent = "Analyzing bird soundbite...";
  }

  function resetRecordingUI() {
    isRecording = false;
    isAnalyzing = false;
    recordBtn.disabled = false;
    recordBtn.classList.remove("recording", "analyzing");
    pulseRing.classList.remove("active-recording");

    iconMic.classList.remove("hidden");
    iconSpinner.classList.add("hidden");
    countdownDisplay.classList.add("hidden");

    cancelRecordBtn.classList.add("hidden");
    recordStatusLabel.textContent = "Ready to record";
  }

  // --- Backend Processing ---
  async function processAudio(audioBlob) {
    try {
      const formData = new FormData();
      const ext = audioBlob.type.includes("ogg") ? "ogg" : "webm";
      formData.append("audio_file", audioBlob, `trail_audio_${Date.now()}.${ext}`);

      const response = await fetch("/api/identify", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        let errMessage = "Identification failed.";
        try {
          const errData = await response.json();
          errMessage = errData.detail || errMessage;
        } catch (e) {}
        throw new Error(errMessage);
      }

      const observation = await response.json();
      displayObservationResult(observation);

      // Automatically speak explanation if toggle is active
      if (autoSpeakToggle.checked && observation.explanation) {
        speakText(observation.explanation, replayVoiceBtn);
      }

      // Refresh Journal list immediately
      await fetchJournal();

    } catch (err) {
      console.error("Audio processing failure:", err);
      showFeedback(err.message, "error");
    } finally {
      resetRecordingUI();
    }
  }

  // --- Display Observation Result ---
  function displayObservationResult(obs) {
    currentActiveExplanation = obs.explanation || "";

    resultCommonName.textContent = obs.common_name || "Unknown Bird";
    resultScientificName.textContent = obs.scientific_name || "";
    resultConfidenceBadge.textContent = `${Math.round((obs.confidence || 0.8) * 100)}% Confidence`;

    // Detection source tag
    resultSourceBadge.textContent = obs.source || "Simulated Demo";
    if (obs.source && obs.source.includes("BirdNET")) {
      resultSourceBadge.classList.add("real-birdnet");
    } else {
      resultSourceBadge.classList.remove("real-birdnet");
    }

    // Explanation & Explainer Source
    resultExplanationText.textContent = obs.explanation;
    resultExplainerSource.textContent = obs.explainer_source || "Offline Fallback";
    resultTimestamp.textContent = formatTimestamp(obs.timestamp);

    // Reveal result card with smooth scroll
    resultCard.classList.remove("hidden");
    resultCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // --- SpeechSynthesis API ---
  function checkSpeechSupport() {
    if (isSpeechSupported) {
      valTts.textContent = "Active (Browser TTS)";
      dotTts.className = "status-indicator-dot green";
    } else {
      valTts.textContent = "Unsupported";
      dotTts.className = "status-indicator-dot red";
    }
  }

  function speakText(text, triggerButton) {
    if (!isSpeechSupported) {
      showFeedback("Browser SpeechSynthesis is not supported on this device.", "info");
      return;
    }

    if (!text) return;

    // Stop any ongoing speech
    window.speechSynthesis.cancel();

    currentUtterance = new SpeechSynthesisUtterance(text);
    currentUtterance.rate = 1.0;
    currentUtterance.pitch = 1.0;

    // Pick natural voice if available
    const voices = window.speechSynthesis.getVoices();
    const englishVoice = voices.find((v) => v.lang.startsWith("en") && !v.name.includes("whisper"));
    if (englishVoice) {
      currentUtterance.voice = englishVoice;
    }

    if (triggerButton) {
      triggerButton.classList.add("speaking");
      if (triggerButton === replayVoiceBtn) {
        replayBtnLabel.textContent = "Speaking...";
      }
    }

    currentUtterance.onend = () => {
      if (triggerButton) {
        triggerButton.classList.remove("speaking");
        if (triggerButton === replayVoiceBtn) {
          replayBtnLabel.textContent = "Listen";
        }
      }
    };

    currentUtterance.onerror = (e) => {
      console.warn("SpeechSynthesis error:", e);
      if (triggerButton) {
        triggerButton.classList.remove("speaking");
        if (triggerButton === replayVoiceBtn) {
          replayBtnLabel.textContent = "Listen";
        }
      }
    };

    window.speechSynthesis.speak(currentUtterance);
  }

  // Pre-fetch voices when ready
  if (isSpeechSupported && window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = () => {
      window.speechSynthesis.getVoices();
    };
  }

  // --- Journal Management ---
  async function fetchJournal() {
    try {
      const response = await fetch("/api/journal");
      if (!response.ok) return;
      const entries = await response.json();
      renderJournal(entries);
    } catch (err) {
      console.error("Failed to load journal:", err);
    }
  }

  function renderJournal(entries) {
    journalCountBadge.textContent = `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`;

    if (!entries || entries.length === 0) {
      journalList.innerHTML = "";
      journalEmpty.classList.remove("hidden");
      clearJournalBtn.classList.add("hidden");
      return;
    }

    journalEmpty.classList.add("hidden");
    clearJournalBtn.classList.remove("hidden");
    journalList.innerHTML = "";

    entries.forEach((item) => {
      const card = document.createElement("div");
      card.className = "journal-item";

      const confidencePct = Math.round((item.confidence || 0.8) * 100);

      card.innerHTML = `
        <div class="journal-item-header">
          <div class="journal-item-titles">
            <span class="journal-item-common">${escapeHtml(item.common_name)}</span>
            <span class="journal-item-scientific">${escapeHtml(item.scientific_name)}</span>
          </div>
          <div class="journal-item-meta">
            <span class="tag-badge">${confidencePct}% match</span>
            <button class="journal-listen-btn" title="Speak this observation" aria-label="Speak observation">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
              </svg>
            </button>
          </div>
        </div>
        <p class="journal-item-body">${escapeHtml(item.explanation)}</p>
        <div class="journal-item-footer">
          <div class="journal-item-tags">
            <span class="tag-badge">${escapeHtml(item.source)}</span>
            <span class="tag-badge">${escapeHtml(item.explainer_source)}</span>
          </div>
          <span>${formatTimestamp(item.timestamp)}</span>
        </div>
      `;

      // Attach speech playback to journal item
      const listenBtn = card.querySelector(".journal-listen-btn");
      listenBtn.addEventListener("click", () => {
        speakText(item.explanation, listenBtn);
      });

      journalList.appendChild(card);
    });
  }

  async function clearJournalEntries() {
    try {
      const response = await fetch("/api/journal", { method: "DELETE" });
      if (response.ok) {
        showFeedback("Trail journal records cleared successfully.", "info");
        await fetchJournal();
      }
    } catch (err) {
      showFeedback(`Failed to clear journal: ${err.message}`, "error");
    }
  }

  // --- Diagnostics Status Check ---
  async function fetchSystemStatus() {
    try {
      const res = await fetch("/api/status");
      if (!res.ok) throw new Error("Status endpoint error");
      const data = await res.json();

      // Backend
      valBackend.textContent = "Online (FastAPI)";
      dotBackend.className = "status-indicator-dot green";

      // BirdNET
      if (data.birdnet.status === "active") {
        valBirdnet.textContent = "Active (Local Model)";
        dotBirdnet.className = "status-indicator-dot green";
      } else {
        valBirdnet.textContent = "Demo Mode (Offline)";
        dotBirdnet.className = "status-indicator-dot amber";
      }

      // Ollama
      if (data.ollama.status === "connected" && data.ollama.model_found) {
        valOllama.textContent = `Connected (${data.ollama.target_model})`;
        dotOllama.className = "status-indicator-dot green";
      } else if (data.ollama.status === "connected") {
        valOllama.textContent = "Connected (Model Missing)";
        dotOllama.className = "status-indicator-dot amber";
      } else {
        valOllama.textContent = "Disconnected (Fallback Active)";
        dotOllama.className = "status-indicator-dot amber";
      }

    } catch (err) {
      valBackend.textContent = "Offline";
      dotBackend.className = "status-indicator-dot red";
      valBirdnet.textContent = "Unavailable";
      dotBirdnet.className = "status-indicator-dot red";
      valOllama.textContent = "Unavailable";
      dotOllama.className = "status-indicator-dot red";
    }
  }

  // --- Helpers ---
  function showFeedback(message, type = "info") {
    feedbackText.textContent = message;
    recorderFeedback.className = `feedback-banner ${type}`;
    recorderFeedback.classList.remove("hidden");
  }

  function hideFeedback() {
    recorderFeedback.classList.add("hidden");
  }

  function formatTimestamp(isoString) {
    if (!isoString) return "Recent";
    try {
      const date = new Date(isoString);
      const now = new Date();
      const diffMs = now - date;
      const diffMins = Math.floor(diffMs / 60000);

      if (diffMins < 1) return "Just now";
      if (diffMins < 60) return `${diffMins}m ago`;
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch (e) {
      return "Recent";
    }
  }

  function escapeHtml(str) {
    if (!str) return "";
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
});
