const apiKeyInput = document.getElementById("apiKey");
const keyCard = document.getElementById("keyCard");
const toggleKeyBtn = document.getElementById("toggleKeyBtn");
const keyDot = document.getElementById("keyDot");
const claimInput = document.getElementById("claimInput");
const charCount = document.getElementById("charCount");
const analyzeBtn = document.getElementById("analyzeBtn");
const loaderCard = document.getElementById("loaderCard");
const loaderStep = document.getElementById("loaderStep");
const resultCard = document.getElementById("resultCard");
const copyBtn = document.getElementById("copyBtn");

let lastAuditData = null;

function updateKeyIndicator(hasKey) {
  if (hasKey) {
    keyDot.classList.add("active");
    keyCard.classList.add("hidden");
  } else {
    keyDot.classList.remove("active");
    keyCard.classList.remove("hidden");
  }
}

function updateCharCount() {
  charCount.textContent = `${claimInput.value.length} chars`;
}

claimInput.addEventListener("input", updateCharCount);

toggleKeyBtn.addEventListener("click", () => {
  keyCard.classList.toggle("hidden");
});

document.querySelectorAll(".preset-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    claimInput.value = chip.getAttribute("data-sample");
    updateCharCount();
    runAudit();
  });
});

chrome.storage.local.get(["geminiApiKey", "pendingClaim"], (data) => {
  if (data.geminiApiKey) {
    apiKeyInput.value = data.geminiApiKey;
    updateKeyIndicator(true);
  } else {
    updateKeyIndicator(false);
  }
  if (data.pendingClaim) {
    claimInput.value = data.pendingClaim;
    updateCharCount();
    if (data.geminiApiKey) runAudit();
  }
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.pendingClaim?.newValue || changes.timestamp?.newValue) {
    chrome.storage.local.get(["pendingClaim"], (d) => {
      if (d.pendingClaim) {
        claimInput.value = d.pendingClaim;
        updateCharCount();
        if (apiKeyInput.value.trim()) runAudit();
      }
    });
  }
});

apiKeyInput.addEventListener("input", () => {
  const val = apiKeyInput.value.trim();
  chrome.storage.local.set({ geminiApiKey: val });
  keyDot.classList.toggle("active", val.length > 10);
});

analyzeBtn.addEventListener("click", runAudit);

copyBtn.addEventListener("click", () => {
  if (!lastAuditData) return;
  const report = `⚖️ PageArbiter Fact-Check\nVerdict: ${lastAuditData.verdict} (${lastAuditData.credibility_score ?? 50}% Credibility)\nSummary: ${lastAuditData.summary}\nBias Audit: ${lastAuditData.bias_analysis}`;
  navigator.clipboard.writeText(report);
  copyBtn.textContent = "✅ Copied";
  setTimeout(() => (copyBtn.textContent = "📋 Copy Audit"), 1800);
});

async function callGemini(model, apiKey, prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.2
          }
        })
      }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function runAudit() {
  const apiKey = apiKeyInput.value.trim();
  const claim = claimInput.value.trim();

  if (!apiKey) {
    keyCard.classList.remove("hidden");
    apiKeyInput.focus();
    return;
  }
  if (!claim) return;

  chrome.storage.local.set({ geminiApiKey: apiKey });
  updateKeyIndicator(true);

  analyzeBtn.disabled = true;
  resultCard.classList.add("hidden");
  loaderCard.classList.remove("hidden");
  loaderStep.textContent = "Deconstructing claim & checking factual consensus...";

  const prompt = `You are PageArbiter, an impartial fact-checker and rhetorical bias auditor.
Analyze the following text:
"""${claim}"""

Respond ONLY with valid JSON matching this exact schema:
{
  "verdict": "TRUE" | "FALSE" | "MISLEADING" | "UNVERIFIED",
  "credibility_score": 0 to 100 integer (e.g. 95 for TRUE, 8 for FALSE, 40 for MISLEADING),
  "summary": "2-sentence direct, objective factual ruling.",
  "bias_analysis": "Identify emotional framing, cherry-picking, logical fallacies, or state Objective / Neutral framing.",
  "fallacy_tags": ["Tag 1", "Tag 2"],
  "evidence": ["Concise verification point 1", "Concise verification point 2", "Concise verification point 3"],
  "sources": [
    { "title": "Publication or Encyclopedia Name - Topic", "url": "https://en.wikipedia.org/wiki/..." }
  ]
}`;

  const models = ["gemini-3.5-flash-lite", "gemini-3.8-flash"];
  let lastError = null;

  for (const model of models) {
    try {
      const data = await callGemini(model, apiKey, prompt);
      let rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
      const firstBrace = rawText.indexOf("{");
      const lastBrace = rawText.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1) {
        rawText = rawText.slice(firstBrace, lastBrace + 1);
      }
      const parsed = JSON.parse(rawText);
      loaderCard.classList.add("hidden");
      renderResult(parsed);
      analyzeBtn.disabled = false;
      return;
    } catch (err) {
      lastError = err;
    }
  }

  loaderCard.classList.add("hidden");
  renderResult({
    verdict: "UNVERIFIED",
    credibility_score: 50,
    summary: "Audit error: " + (lastError?.message || "Connection timed out."),
    bias_analysis: "Check your API key or wait a few seconds and retry.",
    fallacy_tags: ["API Timeout"],
    evidence: [],
    sources: []
  });
  analyzeBtn.disabled = false;
}

function renderResult(data) {
  lastAuditData = data;
  const badge = document.getElementById("verdictBadge");
  const verdict = (data.verdict || "UNVERIFIED").toUpperCase();
  badge.textContent = verdict;
  badge.className = `verdict-pill v-${verdict}`;

  const defaultScore = verdict === "TRUE" ? 94 : verdict === "FALSE" ? 10 : 45;
  const score = typeof data.credibility_score === "number" ? data.credibility_score : defaultScore;
  document.getElementById("credScore").textContent = `${score}%`;
  const bar = document.getElementById("credBar");
  bar.style.width = `${score}%`;
  bar.style.background =
    verdict === "TRUE" ? "var(--true)" : verdict === "FALSE" ? "var(--false)" : "var(--mixed)";

  document.getElementById("summaryText").textContent = data.summary || "";
  document.getElementById("biasText").textContent = data.bias_analysis || "";

  const tagsList = document.getElementById("tagsList");
  tagsList.innerHTML = "";
  (data.fallacy_tags || []).forEach((tag) => {
    const span = document.createElement("span");
    span.className = "fallacy-tag";
    span.textContent = tag;
    tagsList.appendChild(span);
  });

  const list = document.getElementById("evidenceList");
  list.innerHTML = "";
  (data.evidence || []).forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    list.appendChild(li);
  });

  const sourcesWrap = document.getElementById("sourcesWrap");
  const sourcesList = document.getElementById("sourcesList");
  sourcesList.innerHTML = "";

  const sources = data.sources || [];
  if (sources.length > 0) {
    sourcesWrap.classList.remove("hidden");
    sources.forEach((s) => {
      if (s.url && s.title) {
        const a = document.createElement("a");
        a.href = s.url;
        a.target = "_blank";
        a.innerHTML = `<span>${s.title}</span><b>↗</b>`;
        sourcesList.appendChild(a);
      }
    });
  } else {
    sourcesWrap.classList.add("hidden");
  }

  resultCard.classList.remove("hidden");
}
