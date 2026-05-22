const http = require("http");

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";

const savedReports = [];

const helplines = {
  nationalEmergency: { number: "999", title: "জাতীয় জরুরি সেবা" },
  childHelpline: { number: "1098", title: "চাইল্ড হেল্পলাইন" },
  womenChildProtection: {
    number: "109",
    title: "নারী ও শিশু নির্যাতন প্রতিরোধ জাতীয় হেল্পলাইন",
  },
  health: { number: "16263", title: "স্বাস্থ্য বাতায়ন" },
  nationalInfo: { number: "333", title: "জাতীয় তথ্য, সেবা ও অভিযোগ কেন্দ্র" },
  disasterWarning: { number: "1090", title: "দুর্যোগের আগাম বার্তা" },
  legalAid: { number: "16430", title: "সরকারি আইনি সহায়তা" },
  antiCorruption: { number: "106", title: "দুর্নীতি দমন কমিশন" },
  cyberCrime: { number: "16444", title: "সাইবার ক্রাইম হেল্পলাইন" },
  dhakaWasa: { number: "16124", title: "ঢাকা ওয়াসা হেল্পলাইন" },
  dpdc: { number: "16116", title: "ঢাকা ডিপিডিসি হেল্পলাইন" },
  nid: { number: "105", title: "জাতীয় পরিচয়পত্র সেবা" },
  btrc: { number: "100", title: "বিটিআরসি" },
  agriculture: { number: "16122", title: "কৃষি কল সেন্টার" },
  agricultureFisheriesLivestock: {
    number: "16123",
    title: "কৃষি, মৎস্য ও প্রাণিসম্পদ তথ্য",
  },
  railway: { number: "131", title: "বাংলাদেশ রেলওয়ে কল সেন্টার" },
  bangladeshBank: { number: "16267", title: "বাংলাদেশ ব্যাংক" },
  probashiBondhu: { number: "16135", title: "প্রবাস বন্ধু কল সেন্টার" },
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

function sendHtml(res, html) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
  });

  res.end(html);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk.toString();

      if (body.length > 18_000_000) {
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
  return words.some((word) => {
    const cleanWord = String(word || "").toLowerCase().trim();
    return cleanWord && text.includes(cleanWord);
  });
}

function repairCommonSpeechMistakes(text) {
  return normalize(text)
    .replaceAll("badshah", " child ")
    .replaceAll("badsha", " child ")
    .replaceAll("badsah", " child ")
    .replaceAll("haran", " kidnap ")
    .replaceAll("horon", " kidnap ")
    .replaceAll("huran", " kidnap ")
    .replaceAll("gh", " gone ")
    .replaceAll("দেয়ার ইজ নো", " there is no ")
    .replaceAll("দেয়ার ইজ নো", " there is no ")
    .replaceAll("দেয়ার ইজ", " there is ")
    .replaceAll("দেয়ার ইজ", " there is ")
    .replaceAll("ইজ", " is ")
    .replaceAll("ইস", " is ")
    .replaceAll("নো", " no ")
    .replaceAll("নাই", " no ")
    .replaceAll("নেই", " no ")
    .replaceAll("মাই", " my ")
    .replaceAll("এরিয়া", " area ")
    .replaceAll("এরিয়া", " area ")
    .replaceAll("এলাকা", " area ")
    .replaceAll("এলাকায়", " area ")
    .replaceAll("এলাকায়", " area ")
    .replaceAll("বাচ্চা", " child ")
    .replaceAll("বাচ্চাকে", " child ")
    .replaceAll("বাচ্চাটাকে", " child ")
    .replaceAll("বাচ্চাটি", " child ")
    .replaceAll("শিশু", " child ")
    .replaceAll("শিশুকে", " child ")
    .replaceAll("শিশুটাকে", " child ")
    .replaceAll("ছেলে", " child ")
    .replaceAll("ছেলেকে", " child ")
    .replaceAll("মেয়ে", " child ")
    .replaceAll("মেয়ে", " child ")
    .replaceAll("মেয়েকে", " child ")
    .replaceAll("মেয়েকে", " child ")
    .replaceAll("নিয়ে পালিয়ে", " kidnap ")
    .replaceAll("নিয়ে পালিয়ে", " kidnap ")
    .replaceAll("পালিয়ে গেছে", " kidnap ")
    .replaceAll("পালিয়ে গেছে", " kidnap ")
    .replaceAll("পালিয়ে গিয়েছে", " kidnap ")
    .replaceAll("পালিয়ে গিয়েছে", " kidnap ")
    .replaceAll("তুলে নিয়ে গেছে", " kidnap ")
    .replaceAll("তুলে নিয়ে গেছে", " kidnap ")
    .replaceAll("ধরে নিয়ে গেছে", " kidnap ")
    .replaceAll("ধরে নিয়ে গেছে", " kidnap ")
    .replaceAll("জোর করে নিয়ে গেছে", " kidnap ")
    .replaceAll("জোর করে নিয়ে গেছে", " kidnap ")
    .replaceAll("অপহরণ", " kidnap ")
    .replaceAll("অপহৃত", " kidnapped ")
    .replaceAll("কিডন্যাপ", " kidnap ")
    .replaceAll("কিডনাপ", " kidnap ")
    .replaceAll("নিখোঁজ", " missing ")
    .replaceAll("হারিয়ে গেছে", " missing ")
    .replaceAll("হারিয়ে গেছে", " missing ")
    .replaceAll("পানি", " water ")
    .replaceAll("পানির", " water ")
    .replaceAll("জল", " water ")
    .replaceAll("ওয়াটার", " water ")
    .replaceAll("ওয়াটার", " water ")
    .replaceAll("ওয়াসা", " wasa ")
    .replaceAll("ওয়াসা", " wasa ")
    .replaceAll("আগুন", " fire ")
    .replaceAll("ফায়ার", " fire ")
    .replaceAll("ফায়ার", " fire ")
    .replaceAll("ধোঁয়া", " smoke ")
    .replaceAll("ধোঁয়া", " smoke ")
    .replaceAll("জ্বলছে", " burning ")
    .replaceAll("বিদ্যুৎ", " electricity ")
    .replaceAll("কারেন্ট", " electricity ")
    .replaceAll("লোডশেডিং", " electricity ")
    .replaceAll("ডিপিডিসি", " dpdc ")
    .replaceAll("পুলিশ", " police ")
    .replaceAll("চুরি", " theft ")
    .replaceAll("ডাকাতি", " robbery ")
    .replaceAll("ছিনতাই", " robbery ")
    .replaceAll("হামলা", " attack ")
    .replaceAll("মারামারি", " attack ")
    .replaceAll("মারধর", " attack ")
    .replaceAll("বিপদ", " danger ")
    .replaceAll("হুমকি", " threat ")
    .replaceAll("অ্যাম্বুলেন্স", " ambulance ")
    .replaceAll("এম্বুলেন্স", " ambulance ")
    .replaceAll("দুর্ঘটনা", " accident ")
    .replaceAll("আহত", " injured ")
    .replaceAll("রক্ত", " blood ")
    .replaceAll("অজ্ঞান", " unconscious ")
    .replaceAll("নারী", " woman ")
    .replaceAll("মহিলা", " woman ")
    .replaceAll("নির্যাতন", " abuse ")
    .replaceAll("হয়রানি", " harassment ")
    .replaceAll("হয়রানি", " harassment ")
    .replaceAll("সহিংসতা", " violence ")
    .replaceAll("সাইবার", " cyber ")
    .replaceAll("হ্যাক", " hack ")
    .replaceAll("হ্যাকড", " hacked ")
    .replaceAll("প্রতারণা", " fraud ")
    .replaceAll("ফেসবুক", " facebook ")
    .replaceAll("অনলাইন", " online ")
    .replaceAll("রাস্তা", " road ")
    .replaceAll("সড়ক", " road ")
    .replaceAll("সড়ক", " road ")
    .replaceAll("গর্ত", " pothole ")
    .replaceAll("ড্রেন", " drain ")
    .replaceAll("নালা", " drain ")
    .replaceAll("জলাবদ্ধতা", " waterlogging ")
    .replaceAll("ময়লা", " garbage ")
    .replaceAll("ময়লা", " garbage ")
    .replaceAll("আবর্জনা", " garbage ")
    .replaceAll("বাতি", " street light ")
    .replaceAll("লাইট", " street light ")
    .replaceAll("অন্ধকার", " dark street ")
    .replaceAll("এনআইডি", " nid ")
    .replaceAll("এন আই ডি", " nid ")
    .replaceAll("পরিচয়পত্র", " nid ")
    .replaceAll("পরিচয়পত্র", " nid ");
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
      "unconscious",
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
      "threat",
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

  if (includesAny(text, ["cyber", "hack", "hacked", "fraud", "scam"])) {
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

  if (includesAny(text, ["railway", "train", "ticket"])) {
    return {
      isEmergency: false,
      emergencyType: null,
      helpline: helplines.railway,
      secondaryHelpline: null,
    };
  }

  if (includesAny(text, ["bank", "loan", "money", "financial"])) {
    return {
      isEmergency: false,
      emergencyType: null,
      helpline: helplines.bangladeshBank,
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

async function callGemini(parts, responseMimeType = "application/json") {
  if (!GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY environment variable.");
  }

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
          parts,
        },
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType,
      },
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || "Gemini API request failed.");
  }

  return (
    data.candidates?.[0]?.content?.parts?.[0]?.text ||
    data.candidates?.[0]?.content?.parts?.map((part) => part.text).join("") ||
    ""
  );
}

async function analyzeWithGemini(transcript) {
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
- Women or child abuse / harassment / violence = Women / Child Safety Support.
- No water or WASA = Water Supply Problem.
- Electricity or power issue = Electricity Problem.
- Cyber crime or hacked = Cyber Crime / Online Fraud.
- Road, drain, garbage, street light = General Citizen Service Request.
`;

  const text = await callGemini([{ text: prompt }]);
  const rawReport = safeJsonParse(text);

  return repairReport(rawReport, transcript);
}

async function analyzeAudioWithGemini(audioBase64, mimeType) {
  const prompt = `
You are CivicFlow AI for Bangladesh.

You will receive an audio recording from a citizen.
The speaker may speak Bangla, English, or Banglish.
Your job:
1. Detect the spoken language.
2. Transcribe what the user said.
3. If Bangla, keep a clean Bangla transcript.
4. Translate the meaning into English.
5. Create a Banglish/Roman Bangla version if useful.
6. Create the citizen help route.

Return ONLY valid JSON with this exact shape:
{
  "detectedLanguage": "Bangla | English | Banglish | Mixed | Unknown",
  "originalTranscript": "what the user said in the most natural script",
  "banglaTranscript": "Bangla script transcript if available, otherwise empty string",
  "englishTranslation": "English meaning",
  "banglishRoman": "Roman Bangla / Banglish if available, otherwise empty string",
  "report": {
    "intent": "string",
    "category": "string",
    "location": "Current user area",
    "summary": "string",
    "recommendedAction": "string",
    "confidence": number
  }
}

Rules:
- Do not use low/medium/high/critical severity words.
- Do not minimize the user's issue.
- Child taken away, child kidnapping, child missing = Child Kidnapping / Abduction.
- Fire or smoke = Fire / Rescue Emergency.
- Accident, injured, ambulance = Medical / Ambulance Emergency.
- Theft, robbery, attack, danger = Police / Crime Emergency.
- No water or WASA = Water Supply Problem.
- Electricity/power issue = Electricity Problem.
- Cyber crime, hacked, online fraud = Cyber Crime / Online Fraud.
`;

  const text = await callGemini([
    { text: prompt },
    {
      inlineData: {
        mimeType,
        data: audioBase64,
      },
    },
  ]);

  const parsed = safeJsonParse(text);

  const originalTranscript =
    parsed.originalTranscript ||
    parsed.banglaTranscript ||
    parsed.englishTranslation ||
    parsed.banglishRoman ||
    "Audio transcript unavailable.";

  const repairedReport = repairReport(parsed.report || {}, originalTranscript);

  return {
    detectedLanguage: String(parsed.detectedLanguage || "Unknown"),
    originalTranscript: String(originalTranscript),
    banglaTranscript: String(parsed.banglaTranscript || ""),
    englishTranslation: String(parsed.englishTranslation || ""),
    banglishRoman: String(parsed.banglishRoman || ""),
    report: repairedReport,
  };
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
  } else if (includesAny(text, ["ambulance", "accident", "injured", "blood"])) {
    category = "Medical / Ambulance Emergency";
  } else if (includesAny(text, ["police", "theft", "robbery", "attack"])) {
    category = "Police / Crime Emergency";
  } else if (includesAny(text, ["water", "wasa"])) {
    category = "Water Supply Problem";
  } else if (includesAny(text, ["electricity", "power", "current"])) {
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

async function handleAnalyzeAudio(req, res) {
  try {
    const body = await readJsonBody(req);
    const audioBase64 = body.audioBase64;
    const mimeType = body.mimeType || "audio/mp4";

    if (!audioBase64 || typeof audioBase64 !== "string") {
      sendJson(res, 400, {
        ok: false,
        error: "Missing audioBase64",
      });
      return;
    }

    try {
      const result = await analyzeAudioWithGemini(audioBase64, mimeType);

      sendJson(res, 200, {
        ok: true,
        mode: "gemini-audio",
        ...result,
      });
    } catch (error) {
      const fallbackReport = repairReport(
        {
          intent: "Audio Help Request",
          category: "Voice Audio Needs Review",
          location: "Current user area",
          summary:
            "The backend received the audio, but Gemini audio analysis is currently unavailable.",
          recommendedAction:
            "Try again later, or use the normal voice/text fallback.",
          confidence: 0.0,
        },
        "Audio transcript unavailable."
      );

      sendJson(res, 200, {
        ok: false,
        mode: "audio-gemini-failed",
        error: error.message,
        detectedLanguage: "Unknown",
        originalTranscript: "Audio transcript unavailable.",
        banglaTranscript: "",
        englishTranslation: "",
        banglishRoman: "",
        report: fallbackReport,
      });
    }
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

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDateTime(value) {
  try {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return String(value || "Unknown time");
    }

    return date.toLocaleString("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch (_) {
    return String(value || "Unknown time");
  }
}

function handleDashboard(req, res) {
  const totalReports = savedReports.length;
  const emergencyReports = savedReports.filter(
    (item) => item.report && item.report.isEmergency
  ).length;
  const normalReports = totalReports - emergencyReports;
  const latestReport = savedReports[0];

  const reportCards = savedReports
    .map((item, index) => {
      const report = item.report || {};
      const isEmergency = Boolean(report.isEmergency);

      const badgeText = isEmergency ? "Emergency Help Route" : "Help Route";
      const badgeClass = isEmergency ? "badge emergency" : "badge normal";

      const primaryHelp =
        report.helplineLabel && report.helplineNumber
          ? `${report.helplineLabel} • ${report.helplineNumber}`
          : "No helpline selected";

      const secondaryHelp =
        report.secondaryHelplineLabel && report.secondaryHelplineNumber
          ? `<div class="info-line">
              <span>Also</span>
              <strong>${escapeHtml(report.secondaryHelplineLabel)} • ${escapeHtml(
              report.secondaryHelplineNumber
            )}</strong>
            </div>`
          : "";

      const transcriptBlock = item.transcript
        ? `<div class="transcript">
            <span>Transcript</span>
            <p>${escapeHtml(item.transcript)}</p>
          </div>`
        : "";

      return `
        <article
          class="report-card"
          data-type="${isEmergency ? "emergency" : "normal"}"
          data-search="${escapeHtml(
            `${report.category || ""} ${report.summary || ""} ${
              report.helplineLabel || ""
            } ${report.helplineNumber || ""} ${item.status || ""}`
          ).toLowerCase()}"
        >
          <div class="card-top">
            <div>
              <span class="${badgeClass}">${badgeText}</span>
              <span class="number">#${index + 1}</span>
            </div>
            <span class="time">${escapeHtml(formatDateTime(item.createdAt))}</span>
          </div>

          <h2>${escapeHtml(report.category || "Unknown Issue")}</h2>

          <div class="info-grid">
            <div class="info-line">
              <span>Status</span>
              <strong>${escapeHtml(item.status || "received")}</strong>
            </div>

            <div class="info-line">
              <span>Source</span>
              <strong>${escapeHtml(item.source || "flutter-app")}</strong>
            </div>

            <div class="info-line">
              <span>Area</span>
              <strong>${escapeHtml(report.location || "Unknown area")}</strong>
            </div>

            <div class="info-line">
              <span>Help</span>
              <strong>${escapeHtml(primaryHelp)}</strong>
            </div>

            ${secondaryHelp}
          </div>

          ${transcriptBlock}

          <div class="summary">
            <span>AI Summary</span>
            <p>${escapeHtml(report.summary || "No summary available.")}</p>
          </div>

          <div class="action">
            <span>Recommended Action</span>
            <p>${escapeHtml(
              report.recommendedAction || "Review and route manually."
            )}</p>
          </div>

          <p class="id">ID: ${escapeHtml(item.id)}</p>
        </article>
      `;
    })
    .join("");

  const emptyState =
    savedReports.length === 0
      ? `<div class="empty">
          <div class="empty-icon">📭</div>
          <h2>No reports received yet</h2>
          <p>Submit a report from the Flutter app. It will appear here immediately after backend submission.</p>
        </div>`
      : "";

  const latestText = latestReport
    ? `${latestReport.report?.category || "Report"} • ${formatDateTime(
        latestReport.createdAt
      )}`
    : "No report yet";

  const backendMode = GEMINI_API_KEY ? "Gemini Ready" : "Fallback Only";

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>CivicFlow AI Dashboard</title>
  <style>
    :root {
      --bg: #070b10;
      --surface: #101720;
      --border: rgba(56, 189, 248, 0.18);
      --primary: #38bdf8;
      --primary-soft: rgba(56, 189, 248, 0.11);
      --danger: #ff5a5f;
      --danger-soft: rgba(255, 90, 95, 0.13);
      --text: #f8fafc;
      --muted: #b6c2cf;
      --muted-2: #7d8b99;
      --shadow: rgba(0, 0, 0, 0.32);
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      font-family: Inter, Arial, Helvetica, sans-serif;
      background:
        radial-gradient(circle at top left, rgba(56, 189, 248, 0.14), transparent 28%),
        radial-gradient(circle at top right, rgba(255, 90, 95, 0.10), transparent 25%),
        var(--bg);
      color: var(--text);
    }

    .container {
      width: min(1180px, 100%);
      margin: 0 auto;
      padding: 0 22px;
    }

    header {
      padding: 34px 0 26px;
      border-bottom: 1px solid var(--border);
      background: rgba(7, 11, 16, 0.72);
      backdrop-filter: blur(18px);
    }

    .hero {
      display: grid;
      grid-template-columns: 1.5fr 0.8fr;
      gap: 18px;
      align-items: stretch;
    }

    .hero-card,
    .status-card,
    .stat-card,
    .report-card,
    .empty {
      background: rgba(16, 23, 32, 0.94);
      border: 1px solid var(--border);
      border-radius: 28px;
      box-shadow: 0 24px 50px var(--shadow);
    }

    .hero-card,
    .status-card {
      padding: 24px;
    }

    .eyebrow {
      display: inline-flex;
      padding: 8px 12px;
      border-radius: 999px;
      color: var(--primary);
      background: var(--primary-soft);
      border: 1px solid rgba(56, 189, 248, 0.24);
      font-size: 13px;
      font-weight: 900;
      margin-bottom: 16px;
    }

    h1 {
      margin: 0;
      font-size: clamp(32px, 5vw, 54px);
      line-height: 0.95;
      letter-spacing: -1.6px;
    }

    .subtitle {
      margin: 16px 0 0;
      color: var(--muted);
      line-height: 1.6;
      max-width: 760px;
      font-size: 16px;
    }

    .status-card h2 {
      margin: 0 0 14px;
      font-size: 18px;
    }

    .status-list {
      display: grid;
      gap: 12px;
    }

    .status-item,
    .info-line {
      padding: 14px;
      border-radius: 18px;
      background: rgba(255, 255, 255, 0.035);
      border: 1px solid rgba(255, 255, 255, 0.06);
    }

    .status-item span,
    .info-line span,
    .summary span,
    .action span,
    .transcript span {
      display: block;
      color: var(--muted-2);
      font-size: 12px;
      font-weight: 1000;
      text-transform: uppercase;
      letter-spacing: 0.65px;
      margin-bottom: 7px;
    }

    .status-item strong,
    .info-line strong {
      color: var(--text);
      font-size: 14px;
      line-height: 1.4;
    }

    main {
      padding: 26px 0 46px;
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      margin-bottom: 22px;
    }

    .stat-card {
      padding: 22px;
    }

    .stat-number {
      font-size: 42px;
      line-height: 1;
      font-weight: 1000;
      color: var(--primary);
    }

    .stat-card.emergency .stat-number {
      color: var(--danger);
    }

    .stat-label {
      margin-top: 10px;
      color: var(--muted);
      font-weight: 900;
    }

    .toolbar {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 16px;
      align-items: end;
      margin: 22px 0 18px;
    }

    .toolbar h2 {
      margin: 0;
      font-size: 26px;
    }

    .toolbar p {
      margin: 6px 0 0;
      color: var(--muted);
    }

    .toolbar-actions,
    .filter-buttons {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .btn {
      border: 0;
      cursor: pointer;
      padding: 12px 16px;
      border-radius: 999px;
      color: #071018;
      background: var(--primary);
      font-weight: 1000;
      text-decoration: none;
      font-size: 14px;
    }

    .btn.secondary {
      color: var(--text);
      background: rgba(255, 255, 255, 0.07);
      border: 1px solid rgba(255, 255, 255, 0.10);
    }

    .filters {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 12px;
      margin-bottom: 18px;
    }

    .search {
      width: 100%;
      padding: 15px 16px;
      border-radius: 18px;
      border: 1px solid rgba(255, 255, 255, 0.10);
      background: rgba(16, 23, 32, 0.86);
      color: var(--text);
      outline: none;
      font-size: 15px;
      font-weight: 700;
    }

    .chip {
      padding: 13px 15px;
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.10);
      background: rgba(16, 23, 32, 0.86);
      color: var(--muted);
      cursor: pointer;
      font-weight: 1000;
    }

    .chip.active {
      background: var(--primary-soft);
      border-color: rgba(56, 189, 248, 0.34);
      color: var(--primary);
    }

    .reports {
      display: grid;
      gap: 16px;
    }

    .report-card {
      padding: 22px;
    }

    .report-card.hidden {
      display: none;
    }

    .card-top {
      display: flex;
      justify-content: space-between;
      gap: 14px;
      align-items: center;
      margin-bottom: 16px;
    }

    .badge {
      display: inline-flex;
      padding: 8px 12px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 1000;
    }

    .badge.emergency {
      background: var(--danger-soft);
      color: var(--danger);
      border: 1px solid rgba(255, 90, 95, 0.36);
    }

    .badge.normal {
      background: var(--primary-soft);
      color: var(--primary);
      border: 1px solid rgba(56, 189, 248, 0.34);
    }

    .number {
      color: var(--muted-2);
      margin-left: 8px;
      font-size: 12px;
      font-weight: 1000;
    }

    .time {
      color: var(--muted);
      font-size: 13px;
      font-weight: 900;
      text-align: right;
    }

    .report-card h2 {
      margin: 0 0 16px;
      font-size: 24px;
    }

    .info-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
      margin-bottom: 16px;
    }

    .summary,
    .action,
    .transcript {
      margin-top: 12px;
      padding: 16px;
      border-radius: 18px;
      background: rgba(56, 189, 248, 0.075);
      border: 1px solid rgba(56, 189, 248, 0.14);
    }

    .action {
      background: rgba(34, 197, 94, 0.07);
      border-color: rgba(34, 197, 94, 0.16);
    }

    .transcript {
      background: rgba(255, 255, 255, 0.035);
      border-color: rgba(255, 255, 255, 0.06);
    }

    .summary p,
    .action p,
    .transcript p {
      margin: 0;
      color: #dbe4ee;
      line-height: 1.55;
      font-size: 15px;
    }

    .id {
      margin: 14px 0 0;
      color: var(--muted-2);
      font-size: 12px;
      word-break: break-all;
      font-weight: 800;
    }

    .empty {
      padding: 36px;
      text-align: center;
      border-style: dashed;
    }

    .empty-icon {
      font-size: 40px;
      margin-bottom: 12px;
    }

    footer {
      padding: 18px 0 32px;
      color: var(--muted-2);
      text-align: center;
      font-size: 13px;
      font-weight: 800;
    }

    @media (max-width: 860px) {
      .hero,
      .stats,
      .toolbar,
      .filters,
      .info-grid {
        grid-template-columns: 1fr;
      }

      .toolbar-actions,
      .filter-buttons {
        justify-content: flex-start;
      }

      .card-top {
        align-items: flex-start;
        flex-direction: column;
      }

      .time {
        text-align: left;
      }
    }
  </style>
</head>
<body>
  <header>
    <div class="container">
      <section class="hero">
        <div class="hero-card">
          <div class="eyebrow">● Live Backend Dashboard</div>
          <h1>CivicFlow AI</h1>
          <p class="subtitle">
            Admin-style view for reports submitted from the Flutter app.
            This dashboard proves that the mobile app sends report data to the Render backend,
            where authorities or admins could review the routed help requests.
          </p>
        </div>

        <aside class="status-card">
          <h2>System Status</h2>
          <div class="status-list">
            <div class="status-item"><span>AI Mode</span><strong>${escapeHtml(
              backendMode
            )}</strong></div>
            <div class="status-item"><span>Model</span><strong>${escapeHtml(
              GEMINI_MODEL
            )}</strong></div>
            <div class="status-item"><span>Latest Report</span><strong>${escapeHtml(
              latestText
            )}</strong></div>
          </div>
        </aside>
      </section>
    </div>
  </header>

  <main>
    <div class="container">
      <section class="stats">
        <div class="stat-card"><div class="stat-number">${totalReports}</div><div class="stat-label">Total Reports</div></div>
        <div class="stat-card emergency"><div class="stat-number">${emergencyReports}</div><div class="stat-label">Emergency Routes</div></div>
        <div class="stat-card"><div class="stat-number">${normalReports}</div><div class="stat-label">Normal Help Routes</div></div>
      </section>

      <div class="toolbar">
        <div>
          <h2>Submitted Reports</h2>
          <p>Search, filter, and review help routes submitted from the Flutter app.</p>
        </div>

        <div class="toolbar-actions">
          <a class="btn secondary" href="/api/civicflow/reports" target="_blank">View JSON</a>
          <a class="btn" href="/dashboard">Refresh</a>
        </div>
      </div>

      <section class="filters">
        <input id="searchInput" class="search" type="search" placeholder="Search by issue, helpline, status, summary..." />
        <div class="filter-buttons">
          <button class="chip active" data-filter="all">All</button>
          <button class="chip" data-filter="emergency">Emergency</button>
          <button class="chip" data-filter="normal">Normal</button>
        </div>
      </section>

      <section id="reports" class="reports">
        ${emptyState}
        ${reportCards}
      </section>
    </div>
  </main>

  <footer>
    CivicFlow AI Backend Dashboard • Temporary in-memory report storage for demo
  </footer>

  <script>
    const searchInput = document.getElementById("searchInput");
    const chips = document.querySelectorAll(".chip");
    const cards = document.querySelectorAll(".report-card");
    let activeFilter = "all";

    function applyFilters() {
      const query = (searchInput.value || "").toLowerCase().trim();

      cards.forEach((card) => {
        const type = card.dataset.type;
        const search = card.dataset.search || "";
        const matchesFilter = activeFilter === "all" || type === activeFilter;
        const matchesSearch = !query || search.includes(query);

        if (matchesFilter && matchesSearch) {
          card.classList.remove("hidden");
        } else {
          card.classList.add("hidden");
        }
      });
    }

    searchInput.addEventListener("input", applyFilters);

    chips.forEach((chip) => {
      chip.addEventListener("click", () => {
        chips.forEach((item) => item.classList.remove("active"));
        chip.classList.add("active");
        activeFilter = chip.dataset.filter;
        applyFilters();
      });
    });
  </script>
</body>
</html>
`;

  sendHtml(res, html);
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
        "Use /health, /dashboard, /test?text=your_problem_here, /api/civicflow/analyze-audio, or /api/civicflow/reports",
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
      audioRoute: "/api/civicflow/analyze-audio",
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/dashboard") {
    handleDashboard(req, res);
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

  if (req.method === "POST" && url.pathname === "/api/civicflow/analyze-audio") {
    await handleAnalyzeAudio(req, res);
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