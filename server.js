const http = require("http");

const PORT = process.env.PORT || 3000;

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept"
  });

  res.end(JSON.stringify(data));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk.toString();
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

function analyzeTranscript(transcript) {
  const raw = normalize(transcript);

  const text = raw
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
    .replaceAll("কিডন্যাপ", " kidnap ")
    .replaceAll("নিখোঁজ", " missing ")
    .replaceAll("পানি", " water ")
    .replaceAll("পানির", " water ")
    .replaceAll("আগুন", " fire ")
    .replaceAll("ধোঁয়া", " smoke ")
    .replaceAll("ধোঁয়া", " smoke ")
    .replaceAll("বিদ্যুৎ", " electricity ")
    .replaceAll("কারেন্ট", " electricity ")
    .replaceAll("রাস্তা", " road ")
    .replaceAll("ড্রেন", " drain ")
    .replaceAll("ময়লা", " garbage ")
    .replaceAll("ময়লা", " garbage ")
    .replaceAll("সাইবার", " cyber ")
    .replaceAll("হ্যাক", " hack ");

  const hasChild = includesAny(text, ["child", "kid", "baby", "boy", "girl"]);
  const hasKidnap = includesAny(text, [
    "kidnap",
    "kidnapped",
    "abducted",
    "abduction",
    "missing"
  ]);

  if (hasChild && hasKidnap) {
    return {
      intent: "Emergency Help Request",
      category: "Child Kidnapping / Abduction",
      location: "Current user area",
      summary:
        "The citizen is reporting that a child may have been kidnapped, taken away, abducted, or is missing.",
      recommendedAction:
        "Call 999 immediately. Child Helpline 1098 may also support child protection follow-up.",
      confidence: 0.98,
      isEmergency: true,
      emergencyType: "Child Safety Emergency",
      helplineNumber: "999",
      helplineLabel: "জাতীয় জরুরি সেবা",
      secondaryHelplineNumber: "1098",
      secondaryHelplineLabel: "চাইল্ড হেল্পলাইন"
    };
  }

  if (hasKidnap) {
    return {
      intent: "Emergency Help Request",
      category: "Kidnapping / Abduction",
      location: "Current user area",
      summary:
        "The citizen is reporting a possible kidnapping, abduction, or missing-person situation.",
      recommendedAction: "Call 999 for police or emergency support.",
      confidence: 0.96,
      isEmergency: true,
      emergencyType: "Police / Safety Emergency",
      helplineNumber: "999",
      helplineLabel: "জাতীয় জরুরি সেবা",
      secondaryHelplineNumber: null,
      secondaryHelplineLabel: null
    };
  }

  if (includesAny(text, ["fire", "smoke", "burning"])) {
    return {
      intent: "Emergency Help Request",
      category: "Fire / Rescue Emergency",
      location: "Current user area",
      summary: "The citizen is reporting a fire or rescue-related emergency.",
      recommendedAction: "Call 999 for fire service, police, or ambulance.",
      confidence: 0.96,
      isEmergency: true,
      emergencyType: "Fire / Rescue",
      helplineNumber: "999",
      helplineLabel: "জাতীয় জরুরি সেবা",
      secondaryHelplineNumber: null,
      secondaryHelplineLabel: null
    };
  }

  if (includesAny(text, ["water", "no water", "wasa"])) {
    return {
      intent: "Civic Service Request",
      category: "Water Supply Problem",
      location: "Current user area",
      summary:
        "The citizen is reporting no water, low water supply, or another water service issue.",
      recommendedAction: "Contact ঢাকা ওয়াসা হেল্পলাইন 16124.",
      confidence: 0.94,
      isEmergency: false,
      emergencyType: null,
      helplineNumber: "16124",
      helplineLabel: "ঢাকা ওয়াসা হেল্পলাইন",
      secondaryHelplineNumber: null,
      secondaryHelplineLabel: null
    };
  }

  if (includesAny(text, ["electricity", "power", "current"])) {
    return {
      intent: "Utility Service Request",
      category: "Electricity Problem",
      location: "Current user area",
      summary:
        "The citizen is reporting a power outage or electricity-related problem.",
      recommendedAction: "Contact ঢাকা ডিপিডিসি হেল্পলাইন 16116.",
      confidence: 0.93,
      isEmergency: false,
      emergencyType: null,
      helplineNumber: "16116",
      helplineLabel: "ঢাকা ডিপিডিসি হেল্পলাইন",
      secondaryHelplineNumber: null,
      secondaryHelplineLabel: null
    };
  }

  if (includesAny(text, ["cyber", "hack", "fraud", "scam"])) {
    return {
      intent: "Cyber Safety Help Request",
      category: "Cyber Crime / Online Fraud",
      location: "Current user area",
      summary:
        "The citizen is reporting hacking, online fraud, cyber crime, or digital safety concern.",
      recommendedAction: "Contact the cyber crime helpline 16444.",
      confidence: 0.93,
      isEmergency: false,
      emergencyType: null,
      helplineNumber: "16444",
      helplineLabel: "সাইবার ক্রাইম হেল্পলাইন",
      secondaryHelplineNumber: null,
      secondaryHelplineLabel: null
    };
  }

  return {
    intent: "Help Request",
    category: "General Citizen Service Request",
    location: "Current user area",
    summary: `The citizen said: "${transcript}". CivicFlow AI prepared this as a citizen service request.`,
    recommendedAction:
      "Contact জাতীয় তথ্য, সেবা ও অভিযোগ কেন্দ্র 333 for routing to the right service.",
    confidence: 0.75,
    isEmergency: false,
    emergencyType: null,
    helplineNumber: "333",
    helplineLabel: "জাতীয় তথ্য, সেবা ও অভিযোগ কেন্দ্র",
    secondaryHelplineNumber: null,
    secondaryHelplineLabel: null
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    sendJson(res, 200, {
      ok: true,
      service: "CivicFlow AI Backend",
      mode: "render-backend-mock"
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/civicflow/analyze-text") {
    try {
      const body = await readJsonBody(req);
      const transcript = body.transcript;

      if (!transcript || typeof transcript !== "string") {
        sendJson(res, 400, {
          ok: false,
          error: "Missing transcript"
        });
        return;
      }

      const report = analyzeTranscript(transcript);

      sendJson(res, 200, {
        ok: true,
        report
      });
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: error.message
      });
    }

    return;
  }

  sendJson(res, 404, {
    ok: false,
    error: "Not found"
  });
});

server.listen(PORT, () => {
  console.log(`CivicFlow AI backend running on port ${PORT}`);
});