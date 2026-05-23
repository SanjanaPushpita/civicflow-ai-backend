const http = require("http");

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

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
  cyberCrime: { number: "16444", title: "সাইবার ক্রাইম হেল্পলাইন" },
  dhakaWasa: { number: "16124", title: "ঢাকা ওয়াসা হেল্পলাইন" },
  dpdc: { number: "16116", title: "ঢাকা ডিপিডিসি হেল্পলাইন" },
  nid: { number: "105", title: "জাতীয় পরিচয়পত্র সেবা" },
  btrc: { number: "100", title: "বিটিআরসি" },
  agriculture: { number: "16122", title: "কৃষি কল সেন্টার" },
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

      if (body.length > 20_000_000) {
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
    .replace(/[।,.?!:;'"`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(text, words) {
  return words.some((word) => {
    const cleanWord = String(word || "").toLowerCase().trim();
    return cleanWord.length > 0 && text.includes(cleanWord);
  });
}

function repairCommonSpeechMistakes(text) {
  return normalize(text)
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
    .replaceAll("শিশু", " child ")
    .replaceAll("শিশুকে", " child ")
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
    .replaceAll("আগুন লাগছে", " fire ")
    .replaceAll("আগুন লেগেছে", " fire ")
    .replaceAll("ফায়ার", " fire ")
    .replaceAll("ফায়ার", " fire ")
    .replaceAll("ফায়ার সার্ভিস", " fire service ")
    .replaceAll("ফায়ার সার্ভিস", " fire service ")
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
    .replaceAll("গাছ ভেঙে", " fallen tree ")
    .replaceAll("গাছ পড়ে", " fallen tree ")
    .replaceAll("গাছ পড়ে", " fallen tree ")

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
      emergencyType: "Fire / Rescue Emergency",
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
      emergencyType: "Medical / Ambulance Emergency",
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
      emergencyType: "Police / Safety Emergency",
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

function buildRepeatReport(reason) {
  return repairReport(
    {
      intent: "Voice Clarification Needed",
      category: "Voice Needs Repeat",
      location: "Current user area",
      summary:
        reason ||
        "CivicFlow AI could not clearly understand the voice recording.",
      recommendedAction:
        "Please ask the user to repeat slowly and clearly near the microphone.",
      confidence: 0.0,
    },
    "Audio unclear"
  );
}

function isQuotaError(errorMessage) {
  const message = String(errorMessage || "").toLowerCase();

  return (
    message.includes("quota") ||
    message.includes("rate limit") ||
    message.includes("resource_exhausted")
  );
}

function cleanAiErrorMessage(errorMessage) {
  if (isQuotaError(errorMessage)) {
    return "Gemini AI quota is currently unavailable. The app used the fallback safety router instead.";
  }

  return "Gemini AI is temporarily unavailable. The app used the fallback safety router instead.";
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
        temperature: 0,
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
You are CivicFlow AI, a Bangladesh civic and emergency help-routing assistant.

Understand the user's report in Bangla, English, Banglish, or regional Bangla.
Return ONLY valid JSON.
Do not use severity words like low, medium, high, critical.
Do not minimize the user's issue.

User transcript:
"${transcript}"

Return this JSON:
{
  "intent": "string",
  "category": "string",
  "location": "string",
  "summary": "string",
  "recommendedAction": "string",
  "confidence": number
}

Routing:
- Fire, smoke, burning, আগুন = Fire / Rescue Emergency.
- Child kidnapping, child taken away, missing child = Child Kidnapping / Abduction.
- Accident, injured, ambulance = Medical / Ambulance Emergency.
- Theft, robbery, attack, danger = Police / Crime Emergency.
- No water, water supply, WASA = Water Supply Problem.
- Electricity, power, current issue = Electricity Problem.
- Cyber crime, hacked, online fraud = Cyber Crime / Online Fraud.
- Tree fell, road blocked, drain, garbage, street light = General Citizen Service Request.
- If the transcript is empty or clearly impossible, category = Voice Needs Repeat.
`;

  const text = await callGemini([{ text: prompt }]);
  const rawReport = safeJsonParse(text);

  return repairReport(rawReport, transcript);
}

async function analyzeAudioWithGemini(audioBase64, mimeType) {
  const prompt = `
You are CivicFlow AI for Bangladesh.

You will receive a short citizen voice recording.
The speaker may speak Bangla, English, Banglish, or regional Bangla.

Main task:
First transcribe the voice as accurately as possible.
Then classify the civic/emergency issue.

IMPORTANT:
- Do NOT become overly cautious.
- Do NOT mark unclear just because of accent, rural speech, Banglish, or regional Bangla.
- Only set needsRepeat true if there is silence, no human speech, extremely heavy noise, or the speech is impossible to understand.
- If you can hear even a few meaningful words, transcribe the best possible meaning and classify from that.
- If the user says "fire", "আগুন", "agun", "fayar", or "fire in my area", classify as Fire / Rescue Emergency.
- Do not confuse "fire" with "tree".
- If the user says "tree", "গাছ", "tree broke", or "fallen tree", classify as General Citizen Service Request, not fire.
- If you hear both fire and tree, fire takes priority.

Return ONLY valid JSON with this exact shape:
{
  "detectedLanguage": "Bangla | English | Banglish | Mixed | Regional Bangla | Unknown",
  "originalTranscript": "best exact transcript in the natural script",
  "banglaTranscript": "Bangla script transcript if available, otherwise empty string",
  "englishTranslation": "English meaning",
  "banglishRoman": "Roman Bangla / Banglish if available, otherwise empty string",
  "transcriptionConfidence": number,
  "needsRepeat": boolean,
  "repeatReason": "short reason if needsRepeat is true, otherwise empty string",
  "report": {
    "intent": "string",
    "category": "string",
    "location": "Current user area",
    "summary": "string",
    "recommendedAction": "string",
    "confidence": number
  }
}

Routing:
- Fire, smoke, burning, আগুন = Fire / Rescue Emergency.
- Child kidnapping, child taken away, child missing = Child Kidnapping / Abduction.
- Accident, injured, ambulance = Medical / Ambulance Emergency.
- Theft, robbery, attack, danger = Police / Crime Emergency.
- Women or child abuse / harassment / violence = Women / Child Safety Support.
- No water / water supply / WASA = Water Supply Problem.
- Electricity / power / current = Electricity Problem.
- Cyber crime / hacked / online fraud = Cyber Crime / Online Fraud.
- Tree fell, road blocked, drain, garbage, street light = General Citizen Service Request.

Return JSON only.
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

  const originalTranscript = String(
    parsed.originalTranscript ||
      parsed.banglaTranscript ||
      parsed.englishTranslation ||
      parsed.banglishRoman ||
      ""
  ).trim();

  const confidence =
    typeof parsed.transcriptionConfidence === "number"
      ? parsed.transcriptionConfidence
      : 0.65;

  const transcriptText = normalize(
    `${originalTranscript} ${parsed.banglaTranscript || ""} ${
      parsed.englishTranslation || ""
    } ${parsed.banglishRoman || ""}`
  );

  const trulyUnclear =
    originalTranscript.length < 3 ||
    includesAny(transcriptText, [
      "silence",
      "no speech",
      "no human speech",
      "inaudible",
      "unintelligible",
      "cannot hear",
      "can't hear",
      "impossible to understand",
    ]);

  const modelAskedRepeat = parsed.needsRepeat === true;

  if (trulyUnclear || (modelAskedRepeat && confidence < 0.35)) {
    const repeatReport = buildRepeatReport(
      parsed.repeatReason ||
        "The voice was not clear enough. Please repeat the issue clearly."
    );

    return {
      detectedLanguage: String(parsed.detectedLanguage || "Unknown"),
      originalTranscript: originalTranscript || "Audio unclear.",
      banglaTranscript: String(parsed.banglaTranscript || ""),
      englishTranslation: String(parsed.englishTranslation || ""),
      banglishRoman: String(parsed.banglishRoman || ""),
      report: repeatReport,
    };
  }

  const repairedReport = repairReport(parsed.report || {}, transcriptText);

  return {
    detectedLanguage: String(parsed.detectedLanguage || "Unknown"),
    originalTranscript,
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
  } else if (includesAny(text, ["fire", "smoke", "burning"])) {
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
      geminiError: cleanAiErrorMessage(error.message),
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
      error: cleanAiErrorMessage(error.message),
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
      const cleanMessage = cleanAiErrorMessage(error.message);

      const fallbackReport = repairReport(
        {
          intent: "Audio Help Request",
          category: "Voice Audio Needs Review",
          location: "Current user area",
          summary:
            "The backend received the audio, but real AI audio understanding is currently unavailable.",
          recommendedAction:
            "Please repeat clearly or try again after AI quota is available.",
          confidence: 0.0,
        },
        "Audio transcript unavailable."
      );

      sendJson(res, 200, {
        ok: false,
        mode: "audio-ai-unavailable",
        error: cleanMessage,
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
      error: cleanAiErrorMessage(error.message),
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
      timeZone: "Asia/Dhaka",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
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

  const latestText = latestReport
    ? `${latestReport.report?.category || "Report"} • ${formatDateTime(
        latestReport.createdAt
      )}`
    : "No report yet";

  const backendMode = GEMINI_API_KEY ? "Gemini Ready" : "Fallback Only";

  const reportCards = savedReports
    .map((item, index) => {
      const report = item.report || {};
      const isEmergency = Boolean(report.isEmergency);
      const badgeText = isEmergency ? "Emergency" : "Normal";
      const badgeClass = isEmergency ? "badge emergency" : "badge normal";

      const primaryHelp =
        report.helplineLabel && report.helplineNumber
          ? `${report.helplineLabel} • ${report.helplineNumber}`
          : "No helpline selected";

      const secondaryHelp =
        report.secondaryHelplineLabel && report.secondaryHelplineNumber
          ? `<div class="mini-card">
              <span>Also</span>
              <strong>${escapeHtml(report.secondaryHelplineLabel)} • ${escapeHtml(
              report.secondaryHelplineNumber
            )}</strong>
            </div>`
          : "";

      const transcriptBlock = item.transcript
        ? `<section class="text-block transcript">
            <span>Transcript</span>
            <p>${escapeHtml(item.transcript)}</p>
          </section>`
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
          <div class="card-head">
            <div>
              <span class="${badgeClass}">${badgeText}</span>
              <span class="report-number">#${index + 1}</span>
            </div>
            <span class="time">${escapeHtml(formatDateTime(item.createdAt))}</span>
          </div>

          <h2>${escapeHtml(report.category || "Unknown Issue")}</h2>

          <div class="mini-grid">
            <div class="mini-card">
              <span>Status</span>
              <strong>${escapeHtml(item.status || "received")}</strong>
            </div>
            <div class="mini-card">
              <span>Source</span>
              <strong>${escapeHtml(item.source || "flutter-app")}</strong>
            </div>
            <div class="mini-card">
              <span>Area</span>
              <strong>${escapeHtml(report.location || "Unknown area")}</strong>
            </div>
            <div class="mini-card">
              <span>Help</span>
              <strong>${escapeHtml(primaryHelp)}</strong>
            </div>
            ${secondaryHelp}
          </div>

          ${transcriptBlock}

          <section class="text-block">
            <span>AI Summary</span>
            <p>${escapeHtml(report.summary || "No summary available.")}</p>
          </section>

          <section class="text-block action">
            <span>Recommended Action</span>
            <p>${escapeHtml(
              report.recommendedAction || "Review and route manually."
            )}</p>
          </section>

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
          <p>Submit a report from the Flutter app. It will appear here after backend submission.</p>
        </div>`
      : "";

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
      --side: #0d131b;
      --surface: #111923;
      --border: rgba(56, 189, 248, 0.18);
      --primary: #38bdf8;
      --danger: #ff5a5f;
      --text: #f8fafc;
      --muted: #b6c2cf;
      --muted2: #7d8b99;
      --soft: rgba(56, 189, 248, 0.10);
      --dangerSoft: rgba(255, 90, 95, 0.13);
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      color: var(--text);
      font-family: Arial, Helvetica, sans-serif;
      background: var(--bg);
    }

    .layout {
      display: grid;
      grid-template-columns: 310px minmax(0, 1fr);
      min-height: 100vh;
    }

    aside {
      position: sticky;
      top: 0;
      height: 100vh;
      padding: 24px;
      background: linear-gradient(180deg, #0d131b, #070b10);
      border-right: 1px solid var(--border);
      overflow-y: auto;
    }

    .brand-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 999px;
      color: var(--primary);
      background: var(--soft);
      border: 1px solid rgba(56, 189, 248, 0.25);
      font-size: 12px;
      font-weight: 900;
    }

    .dot {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: var(--primary);
    }

    h1 {
      margin: 18px 0 8px;
      font-size: 34px;
      line-height: 0.95;
      letter-spacing: -1.2px;
    }

    .sidebar-text {
      margin: 0 0 22px;
      color: var(--muted);
      line-height: 1.45;
      font-size: 14px;
    }

    .side-section-title {
      color: var(--muted2);
      text-transform: uppercase;
      letter-spacing: 0.8px;
      font-size: 11px;
      font-weight: 1000;
      margin: 22px 0 10px;
    }

    .side-card,
    .stat,
    .report-card,
    .mini-card,
    .text-block,
    .empty {
      border-radius: 18px;
      background: rgba(255, 255, 255, 0.035);
      border: 1px solid rgba(255, 255, 255, 0.07);
    }

    .side-card {
      padding: 14px;
      margin-bottom: 10px;
    }

    .side-card span,
    .mini-card span,
    .text-block span {
      display: block;
      color: var(--muted2);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.7px;
      font-weight: 900;
      margin-bottom: 5px;
    }

    .side-card strong,
    .mini-card strong {
      display: block;
      color: var(--text);
      font-size: 13px;
      line-height: 1.4;
      word-break: break-word;
    }

    .side-stats {
      display: grid;
      gap: 10px;
    }

    .stat {
      padding: 16px;
      background: var(--surface);
      border-color: var(--border);
    }

    .stat-number {
      font-size: 34px;
      line-height: 1;
      color: var(--primary);
      font-weight: 1000;
    }

    .stat.danger .stat-number {
      color: var(--danger);
    }

    .stat-label {
      margin-top: 6px;
      color: var(--muted);
      font-size: 13px;
      font-weight: 900;
    }

    .main {
      min-width: 0;
      padding: 24px;
    }

    .topbar {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      align-items: flex-start;
      margin-bottom: 18px;
    }

    .topbar h2 {
      margin: 0;
      font-size: 28px;
      letter-spacing: -0.5px;
    }

    .topbar p {
      margin: 6px 0 0;
      color: var(--muted);
      line-height: 1.4;
    }

    .actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 0;
      cursor: pointer;
      padding: 12px 16px;
      border-radius: 999px;
      background: var(--primary);
      color: #061018;
      font-weight: 1000;
      text-decoration: none;
      font-size: 14px;
      white-space: nowrap;
    }

    .btn.secondary {
      color: var(--text);
      background: rgba(255, 255, 255, 0.07);
      border: 1px solid rgba(255, 255, 255, 0.10);
    }

    .filters {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 12px;
      margin-bottom: 18px;
    }

    .search {
      width: 100%;
      padding: 15px 16px;
      border-radius: 18px;
      border: 1px solid rgba(255, 255, 255, 0.10);
      background: rgba(17, 25, 35, 0.95);
      color: var(--text);
      outline: none;
      font-size: 15px;
      font-weight: 700;
    }

    .chips {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .chip {
      padding: 13px 15px;
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.10);
      background: rgba(17, 25, 35, 0.95);
      color: var(--muted);
      cursor: pointer;
      font-weight: 1000;
    }

    .chip.active {
      background: var(--soft);
      border-color: rgba(56, 189, 248, 0.34);
      color: var(--primary);
    }

    .reports {
      display: grid;
      gap: 14px;
    }

    .report-card {
      padding: 18px;
      border-radius: 24px;
      background: rgba(17, 25, 35, 0.96);
      border: 1px solid var(--border);
    }

    .report-card.hidden {
      display: none;
    }

    .card-head {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      margin-bottom: 12px;
    }

    .badge {
      display: inline-flex;
      padding: 7px 11px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 1000;
    }

    .badge.emergency {
      background: var(--dangerSoft);
      color: var(--danger);
      border: 1px solid rgba(255, 90, 95, 0.36);
    }

    .badge.normal {
      background: var(--soft);
      color: var(--primary);
      border: 1px solid rgba(56, 189, 248, 0.34);
    }

    .report-number {
      color: var(--muted2);
      margin-left: 8px;
      font-size: 12px;
      font-weight: 1000;
    }

    .time {
      color: var(--muted);
      font-size: 12px;
      font-weight: 900;
      text-align: right;
    }

    .report-card h2 {
      margin: 0 0 12px;
      font-size: 22px;
      letter-spacing: -0.35px;
    }

    .mini-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 12px;
    }

    .mini-card {
      padding: 12px;
      min-width: 0;
    }

    .text-block {
      margin-top: 10px;
      padding: 14px;
      background: rgba(56, 189, 248, 0.075);
      border-color: rgba(56, 189, 248, 0.14);
    }

    .text-block.transcript {
      background: rgba(255, 255, 255, 0.035);
      border-color: rgba(255, 255, 255, 0.06);
    }

    .text-block.action {
      background: rgba(34, 197, 94, 0.07);
      border-color: rgba(34, 197, 94, 0.16);
    }

    .text-block p {
      margin: 0;
      color: #dbe4ee;
      line-height: 1.5;
      font-size: 14px;
    }

    .id {
      margin: 12px 0 0;
      color: var(--muted2);
      font-size: 11px;
      word-break: break-all;
      font-weight: 800;
    }

    .empty {
      padding: 34px;
      border: 1px dashed rgba(56, 189, 248, 0.28);
      text-align: center;
    }

    .empty-icon {
      font-size: 40px;
      margin-bottom: 12px;
    }

    @media (max-width: 1100px) {
      .layout {
        grid-template-columns: 1fr;
      }

      aside {
        position: relative;
        height: auto;
      }

      .side-stats {
        grid-template-columns: repeat(3, 1fr);
      }

      .mini-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 720px) {
      .main {
        padding: 18px;
      }

      .topbar,
      .filters {
        grid-template-columns: 1fr;
        display: grid;
      }

      .actions,
      .chips {
        justify-content: flex-start;
      }

      .side-stats,
      .mini-grid {
        grid-template-columns: 1fr;
      }

      .card-head {
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
  <div class="layout">
    <aside>
      <div class="brand-pill"><span class="dot"></span> Live Backend</div>
      <h1>CivicFlow AI</h1>
      <p class="sidebar-text">
        Admin dashboard for citizen reports received from the Flutter app.
      </p>

      <div class="side-section-title">System</div>
      <div class="side-card">
        <span>AI Mode</span>
        <strong>${escapeHtml(backendMode)}</strong>
      </div>
      <div class="side-card">
        <span>Model</span>
        <strong>${escapeHtml(GEMINI_MODEL)}</strong>
      </div>
      <div class="side-card">
        <span>Latest Report</span>
        <strong>${escapeHtml(latestText)}</strong>
      </div>

      <div class="side-section-title">Report Summary</div>
      <div class="side-stats">
        <div class="stat">
          <div class="stat-number">${totalReports}</div>
          <div class="stat-label">Total Reports</div>
        </div>
        <div class="stat danger">
          <div class="stat-number">${emergencyReports}</div>
          <div class="stat-label">Emergency Routes</div>
        </div>
        <div class="stat">
          <div class="stat-number">${normalReports}</div>
          <div class="stat-label">Normal Routes</div>
        </div>
      </div>
    </aside>

    <main class="main">
      <section class="topbar">
        <div>
          <h2>Submitted Reports</h2>
          <p>Search, filter, and review citizen help routes clearly.</p>
        </div>
        <div class="actions">
          <a class="btn secondary" href="/api/civicflow/reports" target="_blank">View JSON</a>
          <a class="btn" href="/dashboard">Refresh</a>
        </div>
      </section>

      <section class="filters">
        <input id="searchInput" class="search" type="search" placeholder="Search by issue, helpline, status, summary..." />
        <div class="chips">
          <button class="chip active" data-filter="all">All</button>
          <button class="chip" data-filter="emergency">Emergency</button>
          <button class="chip" data-filter="normal">Normal</button>
        </div>
      </section>

      <section id="reports" class="reports">
        ${emptyState}
        ${reportCards}
      </section>
    </main>
  </div>

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