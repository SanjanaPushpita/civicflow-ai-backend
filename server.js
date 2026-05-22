const http = require("http");

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

const savedReports = [];

const helplines = {
  nationalEmergency: {
    number: "999",
    title: "জাতীয় জরুরি সেবা",
  },
  childHelpline: {
    number: "1098",
    title: "চাইল্ড হেল্পলাইন",
  },
  womenChildProtection: {
    number: "109",
    title: "নারী ও শিশু নির্যাতন প্রতিরোধ জাতীয় হেল্পলাইন",
  },
  health: {
    number: "16263",
    title: "স্বাস্থ্য বাতায়ন",
  },
  nationalInfo: {
    number: "333",
    title: "জাতীয় তথ্য, সেবা ও অভিযোগ কেন্দ্র",
  },
  cyberCrime: {
    number: "16444",
    title: "সাইবার ক্রাইম হেল্পলাইন",
  },
  dhakaWasa: {
    number: "16124",
    title: "ঢাকা ওয়াসা হেল্পলাইন",
  },
  dpdc: {
    number: "16116",
    title: "ঢাকা ডিপিডিসি হেল্পলাইন",
  },
  nid: {
    number: "105",
    title: "জাতীয় পরিচয়পত্র সেবা",
  },
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
  });

  res.end(JSON.stringify(data));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk.toString();

      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });

    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });

    req.on("error", reject);
  });
}

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[।,.?!:;]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(text, words) {
  return words.some((word) => text.includes(word));
}

function repairCommonSpeechMistakes(text) {
  return normalize(text)
    .replaceAll("badshah", " child ")
    .replaceAll("badsha", " child ")
    .replaceAll("haran", " kidnap ")
    .replaceAll("horon", " kidnap ")
    .replaceAll("gh", " gone ")
    .replaceAll("বাচ্চা", " child ")
    .replaceAll("বাচ্চাকে", " child ")
    .replaceAll("শিশু", " child ")
    .replaceAll("শিশুকে", " child ")
    .replaceAll("ছেলে", " child ")
    .replaceAll("মেয়ে", " child ")
    .replaceAll("মেয়ে", " child ")
    .replaceAll("নিয়ে পালিয়ে", " kidnap ")
    .replaceAll("নিয়ে পালিয়ে", " kidnap ")
    .replaceAll("পালিয়ে গেছে", " kidnap ")
    .replaceAll("পালিয়ে গেছে", " kidnap ")
    .replaceAll("অপহরণ", " kidnap ")
    .replaceAll("অপহৃত", " kidnapped ")
    .replaceAll("কিডন্যাপ", " kidnap ")
    .replaceAll("নিখোঁজ", " missing ")
    .replaceAll("পানি", " water ")
    .replaceAll("পানির", " water ")
    .replaceAll("ওয়াসা", " wasa ")
    .replaceAll("ওয়াসা", " wasa ")
    .replaceAll("আগুন", " fire ")
    .replaceAll("ধোঁয়া", " smoke ")
    .replaceAll("ধোঁয়া", " smoke ")
    .replaceAll("বিদ্যুৎ", " electricity ")
    .replaceAll("কারেন্ট", " electricity ")
    .replaceAll("সাইবার", " cyber ")
    .replaceAll("হ্যাক", " hack ");
}

function getSafeHelplineRoute(category, transcript) {
  const text = repairCommonSpeechMistakes(`${category} ${transcript}`);

  if (
    includesAny(text, ["child"]) &&
    includesAny(text, ["kidnap", "kidnapped", "missing", "abduction"])
  ) {
    return {
      isEmergency: true,
      emergencyType: "Child Safety Emergency",
      helpline: helplines.nationalEmergency,
      secondaryHelpline: helplines.childHelpline,
    };
  }

  if (includesAny(text, ["kidnap", "kidnapped", "missing", "abduction"])) {
    return {
      isEmergency: true,
      emergencyType: "Police / Safety Emergency",
      helpline: helplines.nationalEmergency,
      secondaryHelpline: null,
    };
  }

  if (includesAny(text, ["fire", "smoke", "burning"])) {
    return {
      isEmergency: true,
      emergencyType: "Fire / Rescue",
      helpline: helplines.nationalEmergency,
      secondaryHelpline: null,
    };
  }

  if (
    includesAny(text, [
      "ambulance",
      "accident",
      "injured",
      "blood",
      "medical emergency",
    ])
  ) {
    return {
      isEmergency: true,
      emergencyType: "Medical / Ambulance",
      helpline: helplines.nationalEmergency,
      secondaryHelpline: helplines.health,
    };
  }

  if (
    includesAny(text, [
      "police",
      "crime",
      "robbery",
      "theft",
      "attack",
      "danger",
    ])
  ) {
    return {
      isEmergency: true,
      emergencyType: "Police / Safety",
      helpline: helplines.nationalEmergency,
      secondaryHelpline: null,
    };
  }

  if (
    includesAny(text, ["woman", "women", "harassment", "abuse", "violence"])
  ) {
    return {
      isEmergency: true,
      emergencyType: "Women / Child Safety",
      helpline: helplines.womenChildProtection,
      secondaryHelpline: helplines.nationalEmergency,
    };
  }

  if (includesAny(text, ["water", "wasa"])) {
    return {
      isEmergency: false,
      emergencyType: null,
      helpline: helplines.dhakaWasa,
      secondaryHelpline: null,
    };
  }

  if (includesAny(text, ["electricity", "power", "current", "dpdc"])) {
    return {
      isEmergency: false,
      emergencyType: null,
      helpline: helplines.dpdc,
      secondaryHelpline: null,
    };
  }

  if (includesAny(text, ["cyber", "hack", "fraud", "scam"])) {
    return {
      isEmergency: false,
      emergencyType: null,
      helpline: helplines.cyberCrime,
      secondaryHelpline: null,
    };
  }

  if (includesAny(text, ["health", "doctor", "hospital", "medicine"])) {
    return {
      isEmergency: false,
      emergencyType: null,
      helpline: helplines.health,
      secondaryHelpline: null,
    };
  }

  if (includesAny(text, ["nid", "national id", "voter id"])) {
    return {
      isEmergency: false,
      emergencyType: null,
      helpline: helplines.nid,
      secondaryHelpline: null,
    };
  }

  return {
    isEmergency: false,
    emergencyType: null,
    helpline: helplines.nationalInfo,
    secondaryHelpline: null,
  };
}

function safeJsonParse(text) {
  const cleaned = String(text || "")
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error("Gemini did not return JSON.");
  }

  return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
}

function repairReport(report, transcript) {
  const category = String(report.category || "General Citizen Service Request");
  const route = getSafeHelplineRoute(category, transcript);

  return {
    intent: String(report.intent || "Help Request"),
    category,
    location: String(report.location || "Current user area"),
    summary: String(
      report.summary ||
        `The citizen said: "${transcript}". CivicFlow AI prepared this as a citizen service request.`
    ),
    recommendedAction: String(
      report.recommendedAction ||
        `Contact ${route.helpline.title} ${route.helpline.number}.`
    ),
    confidence:
      typeof report.confidence === "number" && report.confidence >= 0
        ? Math.min(report.confidence, 1)
        : 0.85,
    isEmergency: route.isEmergency,
    emergencyType: route.emergencyType,
    helplineNumber: route.helpline.number,
    helplineLabel: route.helpline.title,
    secondaryHelplineNumber: route.secondaryHelpline
      ? route.secondaryHelpline.number
      : null,
    secondaryHelplineLabel: route.secondaryHelpline
      ? route.secondaryHelpline.title
      : null,
  };
}

async function analyzeWithGemini(transcript) {
  if (!GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY environment variable.");
  }

  const prompt = `
You are CivicFlow AI, an emergency and citizen-service routing assistant for Bangladesh.

Understand the user's report in Bangla, English, or Banglish.
Return ONLY valid JSON.
Do not use severity words like low, medium, high, critical.
Do not insult or minimize the user's issue.

User transcript:
"${transcript}"

Return only this JSON shape:
{
  "intent": "string",
  "category": "string",
  "location": "string",
  "summary": "string",
  "recommendedAction": "string",
  "confidence": number
}

Routing examples:
- Child kidnapping, child taken away, child missing = Child Kidnapping / Abduction.
- Fire or smoke = Fire / Rescue Emergency.
- Accident, injured, ambulance = Medical / Ambulance Emergency.
- Theft, robbery, attack, danger = Police / Crime Emergency.
- No water or WASA = Water Supply Problem.
- Electricity or power issue = Electricity Problem.
- Cyber crime or hacked = Cyber Crime / Online Fraud.
`;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(
    GEMINI_API_KEY
  )}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || "Gemini API request failed.");
  }

  const text =
    data.candidates?.[0]?.content?.parts?.[0]?.text ||
    data.candidates?.[0]?.content?.parts?.map((part) => part.text).join("") ||
    "";

  const rawReport = safeJsonParse(text);

  return repairReport(rawReport, transcript);
}

function analyzeWithRules(transcript) {
  const text = repairCommonSpeechMistakes(transcript);

  let category = "General Citizen Service Request";

  if (
    includesAny(text, ["child"]) &&
    includesAny(text, ["kidnap", "kidnapped", "missing"])
  ) {
    category = "Child Kidnapping / Abduction";
  } else if (includesAny(text, ["kidnap", "kidnapped", "missing"])) {
    category = "Kidnapping / Abduction";
  } else if (includesAny(text, ["fire", "smoke"])) {
    category = "Fire / Rescue Emergency";
  } else if (includesAny(text, ["water", "wasa"])) {
    category = "Water Supply Problem";
  } else if (includesAny(text, ["electricity", "power"])) {
    category = "Electricity Problem";
  } else if (includesAny(text, ["cyber", "hack", "fraud"])) {
    category = "Cyber Crime / Online Fraud";
  }

  return repairReport(
    {
      intent: "Help Request",
      category,
      location: "Current user area",
      summary: `The citizen said: "${transcript}". CivicFlow AI prepared this as a citizen service request.`,
      recommendedAction: "Contact the recommended help service.",
      confidence: 0.8,
    },
    transcript
  );
}

async function analyzeTranscript(transcript) {
  try {
    const report = await analyzeWithGemini(transcript);

    return {
      mode: "gemini",
      report,
    };
  } catch (error) {
    const report = analyzeWithRules(transcript);

    return {
      mode: "rules-fallback",
      geminiError: error.message,
      report,
    };
  }
}

async function handleAnalyzeText(req, res) {
  try {
    const body = await readJsonBody(req);
    const transcript = body.transcript;

    if (!transcript || typeof transcript !== "string") {
      sendJson(res, 400, {
        ok: false,
        error: "Missing transcript",
      });
      return;
    }

    const result = await analyzeTranscript(transcript);

    sendJson(res, 200, {
      ok: true,
      ...result,
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: error.message,
    });
  }
}

async function handleSubmitReport(req, res) {
  try {
    const body = await readJsonBody(req);

    if (!body.report || typeof body.report !== "object") {
      sendJson(res, 400, {
        ok: false,
        error: "Missing report object",
      });
      return;
    }

    const savedReport = {
      id: `civicflow_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      createdAt: new Date().toISOString(),
      status: String(body.status || "received"),
      source: String(body.source || "flutter-app"),
      transcript: body.transcript || null,
      report: body.report,
    };

    savedReports.unshift(savedReport);

    if (savedReports.length > 100) {
      savedReports.pop();
    }

    sendJson(res, 201, {
      ok: true,
      message: "Report received by CivicFlow AI backend.",
      savedReport,
      totalReports: savedReports.length,
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: error.message,
    });
  }
}

function handleListReports(req, res) {
  sendJson(res, 200, {
    ok: true,
    totalReports: savedReports.length,
    reports: savedReports,
  });
}

async function handleTest(req, res, url) {
  const text = url.searchParams.get("text") || "আমার এলাকায় পানি নেই";
  const result = await analyzeTranscript(text);

  sendJson(res, 200, {
    ok: true,
    input: text,
    ...result,
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "OPTIONS") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname === "/") {
    sendJson(res, 200, {
      ok: true,
      service: "CivicFlow AI Backend",
      message:
        "Use /health, /test?text=your_problem_here, or /api/civicflow/reports",
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      service: "CivicFlow AI Backend",
      mode: GEMINI_API_KEY ? "gemini-ready" : "missing-gemini-key",
      model: GEMINI_MODEL,
      savedReports: savedReports.length,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/test") {
    await handleTest(req, res, url);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/civicflow/analyze-text") {
    await handleAnalyzeText(req, res);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/civicflow/reports") {
    await handleSubmitReport(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/civicflow/reports") {
    handleListReports(req, res);
    return;
  }

  sendJson(res, 404, {
    ok: false,
    error: "Not found",
  });
});

server.listen(PORT, () => {
  console.log(`CivicFlow AI backend running on port ${PORT}`);
});