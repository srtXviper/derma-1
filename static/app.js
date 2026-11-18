const imageInput = document.getElementById("skin-image");
const dropZone = document.getElementById("drop-zone");
const preview = document.getElementById("image-preview");
const placeholder = document.getElementById("upload-placeholder");
const imageMeta = document.getElementById("image-meta");
const imageStatus = document.getElementById("image-status");
const modelResults = document.getElementById("model-results");
const checkImageBtn = document.getElementById("check-image-btn");
const cameraVideo = document.getElementById("camera-preview");
const cameraStartBtn = document.getElementById("camera-start-btn");
const cameraCaptureBtn = document.getElementById("camera-capture-btn");
const cameraStopBtn = document.getElementById("camera-stop-btn");
let selectedFile = null;
let cameraStream = null;
let latestPredictions = [];

function setStatus(message, error = false) {
  imageStatus.textContent = message;
  imageStatus.classList.toggle("error", error);
}

function clearModelResults() {
  modelResults.replaceChildren();
  modelResults.hidden = true;
  modelResults.style.display = "none";
}

function addText(parent, tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  parent.appendChild(node);
  return node;
}

// A light browser-side enhancement: modest brightness and contrast adjustment.
// The source photo is never modified; only the analysis copy is enhanced.
function enhanceImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const sourceUrl = URL.createObjectURL(file);
    image.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const ctx = canvas.getContext("2d");
      ctx.filter = "brightness(1.05) contrast(1.06)";
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => {
        URL.revokeObjectURL(sourceUrl);
        if (!blob) return reject(new Error("Could not prepare the enhanced image."));
        resolve(new File([blob], "dermascan-enhanced.jpg", { type: "image/jpeg" }));
      }, "image/jpeg", 0.92);
    };
    image.onerror = () => { URL.revokeObjectURL(sourceUrl); reject(new Error("Could not read this image.")); };
    image.src = sourceUrl;
  });
}

async function selectImage(file) {
  if (!file) return;
  setStatus("Preparing image…");
  clearModelResults();
  latestPredictions = [];
  preview.hidden = true;
  imageMeta.hidden = true;
  placeholder.hidden = false;
  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (!allowed.includes(file.type)) { selectedFile = null; setStatus("Unsupported file. Choose a JPG, PNG, or WEBP image.", true); return; }
  if (file.size > 8 * 1024 * 1024) { selectedFile = null; setStatus("This file is larger than 8 MB. Choose a smaller image.", true); return; }
  try {
    selectedFile = await enhanceImage(file);
    preview.src = URL.createObjectURL(selectedFile);
    preview.hidden = false;
    placeholder.hidden = true;
    imageMeta.hidden = false;
    imageMeta.textContent = `${file.name} · auto enhanced`;
    setStatus("Image ready. Auto enhancement applied to the analysis copy.");
  } catch (error) {
    selectedFile = null;
    setStatus(error.message || "Could not prepare this image.", true);
  }
}

function stopCamera() {
  if (cameraStream) cameraStream.getTracks().forEach(track => track.stop());
  cameraStream = null;
  cameraVideo.srcObject = null;
  cameraVideo.hidden = true;
  cameraStartBtn.hidden = false;
  cameraCaptureBtn.hidden = true;
  cameraStopBtn.hidden = true;
}

cameraStartBtn.addEventListener("click", async () => {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("Live camera needs a secure HTTPS connection (or localhost).", true);
    return;
  }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    cameraVideo.srcObject = cameraStream;
    cameraVideo.hidden = false;
    cameraStartBtn.hidden = true;
    cameraCaptureBtn.hidden = false;
    cameraStopBtn.hidden = false;
    setStatus("Camera is ready. Capture when the skin area is clearly visible.");
  } catch (error) {
    setStatus("Camera access was blocked. Allow camera permission and try again.", true);
  }
});
cameraCaptureBtn.addEventListener("click", () => {
  if (!cameraVideo.videoWidth) { setStatus("Camera is not ready yet. Try again in a moment.", true); return; }
  const canvas = document.getElementById("capture-canvas");
  const scale = Math.min(1, 1600 / Math.max(cameraVideo.videoWidth, cameraVideo.videoHeight));
  canvas.width = Math.round(cameraVideo.videoWidth * scale);
  canvas.height = Math.round(cameraVideo.videoHeight * scale);
  const ctx = canvas.getContext("2d");
  ctx.filter = "brightness(1.05) contrast(1.06)";
  ctx.drawImage(cameraVideo, 0, 0, canvas.width, canvas.height);
  canvas.toBlob(blob => {
    if (!blob) { setStatus("Could not capture the photo. Please try again.", true); return; }
    const photo = new File([blob], "camera-capture.jpg", { type: "image/jpeg" });
    stopCamera();
    selectImage(photo);
  }, "image/jpeg", 0.92);
});
cameraStopBtn.addEventListener("click", stopCamera);
window.addEventListener("pagehide", stopCamera);

imageInput.addEventListener("change", event => selectImage(event.target.files[0]));
["dragenter", "dragover"].forEach(name => dropZone.addEventListener(name, event => {
  event.preventDefault();
  dropZone.classList.add("dragover");
}));
["dragleave", "drop"].forEach(name => dropZone.addEventListener(name, event => {
  event.preventDefault();
  dropZone.classList.remove("dragover");
}));
dropZone.addEventListener("drop", event => selectImage(event.dataTransfer.files[0]));

function renderPredictions(data) {
  clearModelResults();
  modelResults.hidden = false;
  // Inline display makes the result visible even if an older stylesheet hides this component.
  modelResults.style.display = "block";

  addText(modelResults, "h4", "", "Experimental AI image results");
  addText(
    modelResults,
    "p",
    "model-note",
    `Model: ${data.model_id || "image classifier"}. Scores are model outputs, not calibrated probabilities and not diagnostic certainty.`
  );

  const predictions = Array.isArray(data.predictions) ? data.predictions : [];
  latestPredictions = predictions;
  if (!predictions.length) {
    addText(
      modelResults,
      "p",
      "model-disclaimer",
      "The server accepted the image but did not return prediction labels. Check that the latest model-enabled app.py is running, then restart the server."
    );
    addText(modelResults, "p", "model-note", `Response mode: ${data.mode || "not supplied"}.`);
    return;
  }

  const list = document.createElement("div");
  list.className = "prediction-list";
  predictions.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "prediction-row";
    const label = document.createElement("strong");
    label.textContent = `${index + 1}. ${item.label || "Unlabelled class"}`;
    const score = document.createElement("span");
    const raw = Number(item.score);
    const percent = Number.isFinite(raw) ? (raw >= 0 && raw <= 1 ? raw * 100 : raw) : null;
    score.textContent = percent === null ? "Score unavailable" : `${percent.toFixed(1)}% model score`;
    row.append(label, score);
    list.appendChild(row);

    if (item.label) {
      const link = document.createElement("a");
      link.href = `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(item.label + " skin condition")}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.className = "reference-link";
      link.textContent = `Find scientific articles about “${item.label}” on PubMed`;
      list.appendChild(link);
    }
  });
  modelResults.appendChild(list);

  addText(modelResults, "h4", "", "How to interpret this result");
  addText(
    modelResults,
    "p",
    "model-note",
    "These are image-classifier matches, not a confirmed condition. Skin conditions can look similar, and image quality, skin tone, lighting, and the body area may affect the output. Do not start, stop, or change medication based on these labels."
  );
  addText(
    modelResults,
    "p",
    "model-disclaimer",
    data.disclaimer || "Educational/research use only. This model is not clinically validated. A qualified healthcare professional can assess the concern in context."
  );
}

checkImageBtn.addEventListener("click", async () => {
  if (!selectedFile) {
    setStatus("Choose an image first.", true);
    return;
  }
  const old = checkImageBtn.innerHTML;
  checkImageBtn.disabled = true;
  checkImageBtn.textContent = "Loading model / analyzing…";
  clearModelResults();
  try {
    const form = new FormData();
    form.append("image", selectedFile);
    const response = await fetch("/api/image-check", { method: "POST", body: form });
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error(`Server returned an unreadable response (HTTP ${response.status}). Check the PowerShell window.`);
    }
    if (!response.ok) throw new Error(data.detail || `Could not analyze image (HTTP ${response.status}).`);

    setStatus(`Image processed (${data.width} × ${data.height}). ${data.message || "Analysis response received."}`);
    renderPredictions(data);
    modelResults.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (error) {
    setStatus(error.message || "Could not reach the server. Is the backend running?", true);
    modelResults.hidden = false;
    modelResults.style.display = "block";
    modelResults.replaceChildren();
    addText(modelResults, "h4", "Analysis could not be completed", "Analysis could not be completed");
    addText(modelResults, "p", "model-disclaimer", error.message || "Check that the backend is running and inspect the PowerShell error output.");
  } finally {
    checkImageBtn.disabled = false;
    checkImageBtn.innerHTML = old;
  }
});

document.getElementById("symptom-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = {
    duration: form.duration.value,
    itching: form.itching.checked,
    pain: form.pain.checked,
    changing: form.changing.checked,
    bleeding_or_open_sore: form.bleeding_or_open_sore.checked,
    fever_or_rapid_spread: form.fever_or_rapid_spread.checked,
    notes: form.notes.value
  };
  const button = form.querySelector('button[type="submit"]');
  const old = button.innerHTML;
  button.disabled = true;
  button.textContent = "Preparing summary…";
  try {
    const response = await fetch("/api/symptom-summary", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "Could not generate summary.");
    document.getElementById("result-urgency").textContent = data.urgency_label;
    document.getElementById("result-summary").textContent = data.summary;
    document.getElementById("result-disclaimer").textContent = data.disclaimer;
    const imageStatusText = latestPredictions.length ? "Experimental CNN results available" : (selectedFile ? "Image not analyzed yet" : "No image submitted");
    document.getElementById("summary-image-status").textContent = imageStatusText;
    document.getElementById("summary-output-type").textContent = latestPredictions.length ? "Image + symptom guidance" : "Symptom guidance";
    document.getElementById("summary-image-match").textContent = latestPredictions.length ? latestPredictions[0].label : "Not available";
    const imageSummary = document.getElementById("summary-image-results");
    imageSummary.replaceChildren();
    if (latestPredictions.length) {
      imageSummary.hidden = false;
      addText(imageSummary, "b", "", "Experimental image matches (not a diagnosis)");
      latestPredictions.forEach((item, index) => {
        const raw = Number(item.score);
        const score = Number.isFinite(raw) ? `${((raw >= 0 && raw <= 1 ? raw * 100 : raw)).toFixed(1)}% model score` : "Score unavailable";
        addText(imageSummary, "p", "", `${index + 1}. ${item.label || "Unlabelled class"} — ${score}`);
      });
    } else {
      imageSummary.hidden = true;
    }
    const result = document.getElementById("results");
    result.hidden = false;
    document.getElementById("step-number").textContent = "02";
    result.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    alert(error.message || "Could not reach the server. Please try again.");
  } finally {
    button.disabled = false;
    button.innerHTML = old;
  }
});

document.getElementById("reset-btn").addEventListener("click", () => {
  stopCamera();
  latestPredictions = [];
  document.getElementById("symptom-form").reset();
  document.getElementById("results").hidden = true;
  document.getElementById("step-number").textContent = "01";
  imageInput.value = "";
  selectedFile = null;
  clearModelResults();
  preview.hidden = true;
  preview.removeAttribute("src");
  placeholder.hidden = false;
  imageMeta.hidden = true;
  setStatus("");
  document.getElementById("screening").scrollIntoView({ behavior: "smooth" });
});
