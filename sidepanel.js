const apiKeyInput = document.getElementById("apiKey");
const claimInput = document.getElementById("claimInput");
const analyzeBtn = document.getElementById("analyzeBtn");
const resultCard = document.getElementById("resultCard");

chrome.storage.local.get(["geminiApiKey", "pendingClaim"], (data) => {
  if (data.geminiApiKey) apiKeyInput.value = data.geminiApiKey;
  if (data.pendingClaim) {
    claimInput.value = data.pendingClaim;
    if (data.geminiApiKey) runAudit();
  }
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.pendingClaim?.newValue) {
    claimInput.value = changes.pendingClaim.newValue;
    if (apiKeyInput.value.trim()) runAudit();
  }
});

apiKeyInput.addEventListener("change", () => {
  chrome.storage.local.set({ geminiApiKey: apiKeyInput.value.trim() });
});

analyzeBtn.addEventListener("click", runAudit);

async function runAudit() {
  const apiKey = apiKeyInput.value.trim();
  const claim = claimInput.value.trim();

  if (!apiKey) return alert("Paste your free Google AI Studio Gemini API key first.");
  if (!claim) return alert("Enter or highlight a claim to audit.");

  chrome.storage.local.set({ geminiApiKey: apiKey });
  analyzeBtn.disabled = true;
  analyzeBtn.textContent = "Searching web & auditing...";
  resultCard.classList.add("hidden");

  const prompt = `You are PageArbiter, an impartial fact-checker and rhetorical bias auditor.
Analyze the following text using live Google Search grounding:
"""${claim}"""

Respond ONLY with valid JSON (no markdown fences) matching this exact schema:
{
  "verdict": "TRUE" | "FALSE" | "MISLEADING" | "UNVERIFIED",
  "summary": "2-sentence direct factual ruling.",
  "bias_analysis": "Identify emotional framing, cherry-picking, logical fallacies, or state Neutral framing if objective.",
  "evidence": ["bullet point 1", "bullet point 2", "bullet point 3"]
}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }]
        })
      }
    );

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || "API Error");

    const candidate = data.candidates?.[0];
    let rawText = candidate?.content?.parts?.[0]?.text || "{}";
    rawText = rawText.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(rawText);

    renderResult(parsed, candidate?.groundingMetadata?.groundingChunks || []);
  } catch (err) {
    alert("Audit failed: " + err.message);
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = "Audit & Fact-Check";
  }
}

function renderResult(data, chunks) {
  const badge = document.getElementById("verdictBadge");
  const verdict = (data.verdict || "UNVERIFIED").toUpperCase();
  badge.textContent = verdict;
  badge.className = `verdict-pill v-${verdict}`;

  document.getElementById("summaryText").textContent = data.summary || "";
  document.getElementById("biasText").textContent = data.bias_analysis || "";

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

  const uniqueLinks = new Map();
  chunks.forEach((c) => {
    if (c.web?.uri && c.web?.title) uniqueLinks.set(c.web.uri, c.web.title);
  });

  if (uniqueLinks.size > 0) {
    sourcesWrap.classList.remove("hidden");
    uniqueLinks.forEach((title, url) => {
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.textContent = "↗ " + title;
      sourcesList.appendChild(a);
    });
  } else {
    sourcesWrap.classList.add("hidden");
  }

  resultCard.classList.remove("hidden");
}
