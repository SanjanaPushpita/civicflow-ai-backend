const http = require("http");
const crypto = require("crypto");
const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
const FIREBASE_PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || "civicflow-local-admin-secret";

const REPORT_COLLECTION = "civic_reports";
const LIVE_SESSION_COLLECTION = "live_location_sessions";
const ADMIN_COOKIE_NAME = "civicflow_admin_session";
const STATUS_OPTIONS = ["Received", "Under Review", "Contacted", "Emergency Escalated", "Resolved", "Rejected / Invalid"];

const memoryReports = [];
const memoryLiveSessions = new Map();
let firestoreDb = null;
let firebaseStatus = "not-configured";
let firebaseError = null;

const helplines = {
  nationalEmergency: { number: "999", title: "জাতীয় জরুরি সেবা" },
  childHelpline: { number: "1098", title: "চাইল্ড হেল্পলাইন" },
  womenChildProtection: { number: "109", title: "নারী ও শিশু নির্যাতন প্রতিরোধ জাতীয় হেল্পলাইন" },
  health: { number: "16263", title: "স্বাস্থ্য বাতায়ন" },
  nationalInfo: { number: "333", title: "জাতীয় তথ্য, সেবা ও অভিযোগ কেন্দ্র" },
  disasterWarning: { number: "1090", title: "দুর্যোগের আগাম বার্তা" },
  cyberCrime: { number: "16444", title: "সাইবার ক্রাইম হেল্পলাইন" },
  dhakaWasa: { number: "16124", title: "ঢাকা ওয়াসা হেল্পলাইন" },
  dpdc: { number: "16116", title: "ঢাকা ডিপিডিসি হেল্পলাইন" },
  nid: { number: "105", title: "জাতীয় পরিচয়পত্র সেবা" },
  railway: { number: "131", title: "বাংলাদেশ রেলওয়ে কল সেন্টার" },
  bangladeshBank: { number: "16267", title: "বাংলাদেশ ব্যাংক" },
};

function initializeFirebase() {
  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
    firebaseStatus = "missing-env";
    firebaseError = "Missing FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, or FIREBASE_PRIVATE_KEY.";
    return;
  }

  try {
    if (getApps().length === 0) {
      initializeApp({
        credential: cert({
          projectId: FIREBASE_PROJECT_ID,
          clientEmail: FIREBASE_CLIENT_EMAIL,
          privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
        }),
      });
    }

    firestoreDb = getFirestore();
    firebaseStatus = "connected";
    firebaseError = null;
    console.log("Firebase Firestore connected successfully.");
  } catch (error) {
    firestoreDb = null;
    firebaseStatus = "connection-failed";
    firebaseError = error.message;
    console.error("Firebase connection failed:", error.message);
  }
}
initializeFirebase();

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
  });
  res.end(JSON.stringify(data));
}

function sendHtml(res, html, statusCode = 200, extraHeaders = {}) {
  res.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8", ...extraHeaders });
  res.end(html);
}

function redirect(res, location, extraHeaders = {}) {
  res.writeHead(302, { Location: location, ...extraHeaders });
  res.end();
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
      if (body.length > 20_000_000) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function readJsonBody(req) {
  const raw = await readRawBody(req);
  try {
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    throw new Error("Invalid JSON body.");
  }
}

async function readFormBody(req) {
  return new URLSearchParams(await readRawBody(req));
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[।,.?!:;'"`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(text, words) {
  return words.some((word) => text.includes(String(word || "").toLowerCase().trim()));
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

function getCookie(req, name) {
  const cookies = String(req.headers.cookie || "").split(";").map((x) => x.trim());
  for (const cookie of cookies) {
    const [key, ...valueParts] = cookie.split("=");
    if (key === name) return decodeURIComponent(valueParts.join("="));
  }
  return "";
}

function makeAdminSessionToken() {
  return crypto.createHmac("sha256", ADMIN_SESSION_SECRET).update(ADMIN_PASSWORD).digest("hex");
}

function safeCompare(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isDashboardAuthorized(req) {
  return Boolean(ADMIN_PASSWORD) && safeCompare(getCookie(req, ADMIN_COOKIE_NAME), makeAdminSessionToken());
}

function getSecureCookieSuffix(req) {
  const host = req.headers.host || "";
  return host.includes("localhost") || host.includes("127.0.0.1") ? "" : "; Secure";
}

function repairCommonSpeechMistakes(text) {
  return normalize(text)
    .replaceAll("এলাকা", " area ")
    .replaceAll("এলাকায়", " area ")
    .replaceAll("এলাকায়", " area ")
    .replaceAll("জরুরি", " emergency ")
    .replaceAll("ইমার্জেন্সি", " emergency ")
    .replaceAll("সাহায্য", " help ")
    .replaceAll("বাঁচাও", " save me ")
    .replaceAll("বিপদ", " danger ")
    .replaceAll("হুমকি", " threat ")
    .replaceAll("পুলিশ", " police ")
    .replaceAll("আগুন", " fire ")
    .replaceAll("ফায়ার", " fire ")
    .replaceAll("ধোঁয়া", " smoke ")
    .replaceAll("অ্যাম্বুলেন্স", " ambulance ")
    .replaceAll("এম্বুলেন্স", " ambulance ")
    .replaceAll("দুর্ঘটনা", " accident ")
    .replaceAll("আহত", " injured ")
    .replaceAll("রক্ত", " blood ")
    .replaceAll("অপহরণ", " kidnap ")
    .replaceAll("কিডন্যাপ", " kidnap ")
    .replaceAll("নিখোঁজ", " missing ")
    .replaceAll("হারিয়ে গেছে", " missing ")
    .replaceAll("নারী", " woman ")
    .replaceAll("মহিলা", " woman ")
    .replaceAll("হয়রানি", " harassment ")
    .replaceAll("নির্যাতন", " abuse ")
    .replaceAll("সহিংসতা", " violence ")
    .replaceAll("শিশু", " child ")
    .replaceAll("বাচ্চা", " child ")
    .replaceAll("ঘূর্ণিঝড়", " cyclone ")
    .replaceAll("বন্যা", " flood ")
    .replaceAll("ভূমিকম্প", " earthquake ")
    .replaceAll("দুর্যোগ", " disaster ")
    .replaceAll("সাইবার", " cyber ")
    .replaceAll("হ্যাক", " hack ")
    .replaceAll("পানি", " water ")
    .replaceAll("ওয়াসা", " wasa ")
    .replaceAll("বিদ্যুৎ", " electricity ")
    .replaceAll("কারেন্ট", " electricity ")
    .replaceAll("গাছ পড়ে", " fallen tree ")
    .replaceAll("গাছ পড়ে", " fallen tree ")
    .replaceAll("গাছ ভেঙে", " fallen tree ");
}

function getSafeHelplineRoute(category, transcript) {
  const text = repairCommonSpeechMistakes(`${category} ${transcript}`);

  if (includesAny(text, ["fire", "smoke", "burning"]) && !includesAny(text, ["fallen tree"])) {
    return { isEmergency: true, emergencyType: "Fire / Rescue Emergency", helpline: helplines.nationalEmergency, secondaryHelpline: null, liveTrackingRequired: true };
  }
  if (includesAny(text, ["kidnap", "kidnapped", "abduction", "missing child"])) {
    return { isEmergency: true, emergencyType: "Kidnapping / Abduction Emergency", helpline: helplines.nationalEmergency, secondaryHelpline: helplines.childHelpline, liveTrackingRequired: true };
  }
  if (includesAny(text, ["ambulance", "accident", "injured", "blood", "medical emergency", "unconscious"])) {
    return { isEmergency: true, emergencyType: "Medical / Ambulance Emergency", helpline: helplines.nationalEmergency, secondaryHelpline: helplines.health, liveTrackingRequired: true };
  }
  if (includesAny(text, ["woman", "women", "harassment", "abuse", "violence", "assault", "rape"])) {
    return { isEmergency: true, emergencyType: "Women / Child Safety Emergency", helpline: helplines.womenChildProtection, secondaryHelpline: helplines.nationalEmergency, liveTrackingRequired: true };
  }
  if (includesAny(text, ["child"]) && includesAny(text, ["danger", "missing", "abuse", "violence", "kidnap"])) {
    return { isEmergency: true, emergencyType: "Child Safety Emergency", helpline: helplines.childHelpline, secondaryHelpline: helplines.nationalEmergency, liveTrackingRequired: true };
  }
  if (includesAny(text, ["cyclone", "flood", "earthquake", "storm", "disaster", "trapped"])) {
    return { isEmergency: true, emergencyType: "Disaster Emergency", helpline: helplines.nationalEmergency, secondaryHelpline: helplines.disasterWarning, liveTrackingRequired: true };
  }
  if (includesAny(text, ["police", "crime", "robbery", "theft", "attack", "danger", "threat", "help lagbe", "emergency", "save me"])) {
    return { isEmergency: true, emergencyType: "Police / Safety Emergency", helpline: helplines.nationalEmergency, secondaryHelpline: null, liveTrackingRequired: true };
  }
  if (includesAny(text, ["water", "wasa"])) return { isEmergency: false, emergencyType: null, helpline: helplines.dhakaWasa, secondaryHelpline: null, liveTrackingRequired: false };
  if (includesAny(text, ["electricity", "power", "current", "dpdc"])) return { isEmergency: false, emergencyType: null, helpline: helplines.dpdc, secondaryHelpline: null, liveTrackingRequired: false };
  if (includesAny(text, ["cyber", "hack", "hacked", "fraud", "scam"])) return { isEmergency: false, emergencyType: null, helpline: helplines.cyberCrime, secondaryHelpline: null, liveTrackingRequired: false };
  if (includesAny(text, ["health", "doctor", "hospital", "medicine"])) return { isEmergency: false, emergencyType: null, helpline: helplines.health, secondaryHelpline: null, liveTrackingRequired: false };
  if (includesAny(text, ["nid", "national id", "voter id"])) return { isEmergency: false, emergencyType: null, helpline: helplines.nid, secondaryHelpline: null, liveTrackingRequired: false };
  if (includesAny(text, ["railway", "train", "ticket"])) return { isEmergency: false, emergencyType: null, helpline: helplines.railway, secondaryHelpline: null, liveTrackingRequired: false };
  if (includesAny(text, ["bank", "loan", "money", "financial"])) return { isEmergency: false, emergencyType: null, helpline: helplines.bangladeshBank, secondaryHelpline: null, liveTrackingRequired: false };

  return { isEmergency: false, emergencyType: null, helpline: helplines.nationalInfo, secondaryHelpline: null, liveTrackingRequired: false };
}

function safeJsonParse(text) {
  const cleaned = String(text || "").replace(/```json/g, "").replace(/```/g, "").trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first === -1 || last === -1) throw new Error("Gemini did not return JSON.");
  return JSON.parse(cleaned.slice(first, last + 1));
}

function repairReport(report, transcript) {
  const category = String(report.category || "General Citizen Service Request");
  const route = getSafeHelplineRoute(category, transcript);

  return {
    intent: String(report.intent || "Help Request"),
    category,
    location: String(report.location || "Current user area"),
    summary: String(report.summary || `The citizen said: "${transcript}". CivicFlow AI prepared this as a citizen service request.`),
    recommendedAction: String(report.recommendedAction || `Contact ${route.helpline.title} ${route.helpline.number}.`),
    confidence: typeof report.confidence === "number" && report.confidence >= 0 ? Math.min(report.confidence, 1) : 0.85,
    isEmergency: route.isEmergency,
    emergencyType: route.emergencyType,
    helplineNumber: route.helpline.number,
    helplineLabel: route.helpline.title,
    secondaryHelplineNumber: route.secondaryHelpline ? route.secondaryHelpline.number : null,
    secondaryHelplineLabel: route.secondaryHelpline ? route.secondaryHelpline.title : null,
    liveTrackingRequired: route.liveTrackingRequired,
    gpsLatitude: report.gpsLatitude ?? null,
    gpsLongitude: report.gpsLongitude ?? null,
    gpsAccuracyMeters: report.gpsAccuracyMeters ?? null,
    gpsCapturedAtIso: report.gpsCapturedAtIso ?? null,
    mapsUrl: report.mapsUrl ?? null,
  };
}

function buildRepeatReport(reason) {
  return repairReport(
    {
      intent: "Voice Clarification Needed",
      category: "Voice Needs Repeat",
      location: "Current user area",
      summary: reason || "CivicFlow AI could not hear enough speech from the recording.",
      recommendedAction: "Please speak again clearly and keep the phone close to the mouth.",
      confidence: 0,
    },
    "Audio unclear"
  );
}

function isQuotaError(message) {
  const clean = String(message || "").toLowerCase();
  return clean.includes("quota") || clean.includes("rate limit") || clean.includes("resource_exhausted");
}

function cleanAiErrorMessage(message) {
  return isQuotaError(message)
    ? "Gemini AI quota is currently unavailable. The app used the fallback safety router instead."
    : "Gemini AI is temporarily unavailable. The app used the fallback safety router instead.";
}

async function callGemini(parts, responseMimeType = "application/json") {
  if (!GEMINI_API_KEY) throw new Error("Missing GEMINI_API_KEY environment variable.");

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { temperature: 0, responseMimeType },
    }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Gemini API request failed.");

  return data.candidates?.[0]?.content?.parts?.[0]?.text || data.candidates?.[0]?.content?.parts?.map((part) => part.text).join("") || "";
}

async function analyzeWithGemini(transcript) {
  const prompt = `You are CivicFlow AI, a Bangladesh civic and emergency help-routing assistant. Understand Bangla, English, Banglish, or regional Bangla. Return ONLY valid JSON with intent, category, location, summary, recommendedAction, confidence. Do not use severity words. User transcript: "${transcript}". Routing: fire/আগুন=Fire / Rescue Emergency; kidnap/অপহরণ/missing child=Kidnapping / Abduction Emergency; ambulance/accident=Medical / Ambulance Emergency; danger/বিপদ/attack/robbery/police=Police / Safety Emergency; women harassment/violence=Women / Child Safety Emergency; disaster/flood/cyclone=Disaster Emergency; water/WASA=Water Supply Problem; electricity=Electricity Problem; cyber/hack=Cyber Crime / Online Fraud; tree/drain/garbage=General Citizen Service Request.`;
  return repairReport(safeJsonParse(await callGemini([{ text: prompt }])), transcript);
}

async function analyzeAudioWithGemini(audioBase64, mimeType) {
  const prompt = "You are CivicFlow AI for Bangladesh. Transcribe short audio in Bangla, English, Banglish, or regional Bangla. Return ONLY JSON: detectedLanguage, originalTranscript, banglaTranscript, englishTranslation, banglishRoman, transcriptionConfidence, needsRepeat, repeatReason, report{intent,category,location,summary,recommendedAction,confidence}. Do not say unclear unless almost no human voice. Emergency/bipod/help/fire/ambulance/kidnap/harassment/disaster must be routed as emergency.";
  const parsed = safeJsonParse(await callGemini([{ text: prompt }, { inlineData: { mimeType, data: audioBase64 } }]));
  const original = String(parsed.originalTranscript || parsed.banglaTranscript || parsed.englishTranslation || parsed.banglishRoman || "").trim();
  const allText = normalize(`${original} ${parsed.banglaTranscript || ""} ${parsed.englishTranslation || ""} ${parsed.banglishRoman || ""} ${parsed.report?.category || ""} ${parsed.report?.summary || ""}`);
  const empty = original.length < 2 || includesAny(allText, ["no human voice", "no speech", "silence", "empty audio", "cannot hear anything", "inaudible"]);

  if (empty) {
    return {
      detectedLanguage: String(parsed.detectedLanguage || "Unknown"),
      originalTranscript: original || "Audio unclear.",
      banglaTranscript: String(parsed.banglaTranscript || ""),
      englishTranslation: String(parsed.englishTranslation || ""),
      banglishRoman: String(parsed.banglishRoman || ""),
      report: buildRepeatReport(parsed.repeatReason || "The recording did not contain enough clear human voice."),
    };
  }

  return {
    detectedLanguage: String(parsed.detectedLanguage || "Unknown"),
    originalTranscript: original,
    banglaTranscript: String(parsed.banglaTranscript || ""),
    englishTranslation: String(parsed.englishTranslation || ""),
    banglishRoman: String(parsed.banglishRoman || ""),
    report: repairReport(parsed.report || {}, allText),
  };
}

function analyzeWithRules(transcript) {
  const text = repairCommonSpeechMistakes(transcript);
  let category = "General Citizen Service Request";
  if (includesAny(text, ["fire", "smoke", "burning"])) category = "Fire / Rescue Emergency";
  else if (includesAny(text, ["kidnap", "kidnapped", "missing", "abduction"])) category = "Kidnapping / Abduction Emergency";
  else if (includesAny(text, ["ambulance", "accident", "injured", "blood"])) category = "Medical / Ambulance Emergency";
  else if (includesAny(text, ["woman", "harassment", "abuse", "violence"])) category = "Women / Child Safety Emergency";
  else if (includesAny(text, ["police", "theft", "robbery", "attack", "danger", "emergency", "help lagbe"])) category = "Police / Safety Emergency";
  else if (includesAny(text, ["cyclone", "flood", "earthquake", "disaster"])) category = "Disaster Emergency";
  else if (includesAny(text, ["water", "wasa"])) category = "Water Supply Problem";
  else if (includesAny(text, ["electricity", "power", "current"])) category = "Electricity Problem";
  else if (includesAny(text, ["cyber", "hack", "fraud"])) category = "Cyber Crime / Online Fraud";

  return repairReport(
    {
      intent: "Help Request",
      category,
      location: "Current user area",
      summary: `The citizen said: "${transcript}". CivicFlow AI prepared this help route.`,
      recommendedAction: "Contact the recommended help service.",
      confidence: 0.8,
    },
    transcript
  );
}

async function analyzeTranscript(transcript) {
  try {
    return { mode: "gemini", report: await analyzeWithGemini(transcript) };
  } catch (error) {
    return { mode: "rules-fallback", geminiError: cleanAiErrorMessage(error.message), report: analyzeWithRules(transcript) };
  }
}

function sanitizeLocationData(locationData) {
  if (!locationData || typeof locationData !== "object") return null;
  const latitude = Number(locationData.latitude);
  const longitude = Number(locationData.longitude);
  const accuracyMeters = Number(locationData.accuracyMeters);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  return {
    latitude,
    longitude,
    accuracyMeters: Number.isFinite(accuracyMeters) ? accuracyMeters : null,
    capturedAtIso: locationData.capturedAtIso || locationData.updatedAtIso || new Date().toISOString(),
    mapsUrl: locationData.mapsUrl || `https://www.google.com/maps?q=${latitude},${longitude}`,
    provider: String(locationData.provider || "phone-location"),
  };
}

function mergeLocationIntoReport(report, locationData) {
  const loc = sanitizeLocationData(locationData);
  if (!loc) return report;
  return { ...report, gpsLatitude: loc.latitude, gpsLongitude: loc.longitude, gpsAccuracyMeters: loc.accuracyMeters, gpsCapturedAtIso: loc.capturedAtIso, mapsUrl: loc.mapsUrl };
}

async function saveReport(savedReport) {
  memoryReports.unshift(savedReport);
  if (memoryReports.length > 100) memoryReports.pop();

  if (!firestoreDb) return { storage: "memory", firebaseStatus, firebaseError };

  await firestoreDb.collection(REPORT_COLLECTION).doc(savedReport.id).set(
    {
      ...savedReport,
      createdAtMs: savedReport.createdAtMs || Date.now(),
      updatedAtMs: Date.now(),
      updatedAt: new Date().toISOString(),
      storageSource: "firebase-firestore",
    },
    { merge: true }
  );

  return { storage: "firebase-firestore", firebaseStatus, firebaseError: null };
}

async function loadReports() {
  if (!firestoreDb) return { reports: memoryReports, storage: "memory", firebaseStatus, firebaseError };

  try {
    const snapshot = await firestoreDb.collection(REPORT_COLLECTION).orderBy("createdAtMs", "desc").limit(100).get();
    return { reports: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })), storage: "firebase-firestore", firebaseStatus, firebaseError: null };
  } catch (error) {
    return { reports: memoryReports, storage: "memory-fallback", firebaseStatus: "read-failed", firebaseError: error.message };
  }
}

async function updateReportStatus(reportId, status, adminNote) {
  const cleanedReportId = String(reportId || "").trim();
  const cleanedStatus = String(status || "").trim();
  const cleanedAdminNote = String(adminNote || "").trim().slice(0, 2000);

  if (!cleanedReportId) throw new Error("Missing report ID.");
  if (!STATUS_OPTIONS.includes(cleanedStatus)) throw new Error("Invalid report status.");

  const updatePayload = { status: cleanedStatus, adminNote: cleanedAdminNote, updatedAt: new Date().toISOString(), updatedAtMs: Date.now() };
  const index = memoryReports.findIndex((item) => item.id === cleanedReportId);
  if (index !== -1) memoryReports[index] = { ...memoryReports[index], ...updatePayload };

  if (!firestoreDb) return { storage: "memory", firebaseStatus, firebaseError };

  await firestoreDb.collection(REPORT_COLLECTION).doc(cleanedReportId).set(updatePayload, { merge: true });
  return { storage: "firebase-firestore", firebaseStatus, firebaseError: null };
}

function getLiveSessionComputedStatus(session) {
  if (!session) return "none";
  const status = String(session.status || "active");
  const expiresAtMs = Number(session.expiresAtMs || 0);
  return status === "active" && expiresAtMs && Date.now() > expiresAtMs ? "expired" : status;
}

function buildReportLiveUpdatePayload(session) {
  const loc = session.latestLocation || null;
  return {
    liveTrackingEnabled: true,
    liveTrackingStatus: getLiveSessionComputedStatus(session),
    liveSessionId: session.id,
    liveStartedAtIso: session.startedAtIso,
    liveExpiresAtIso: session.expiresAtIso,
    liveLastLocationAtIso: session.lastLocationAtIso || null,
    liveUpdateCount: session.updateCount || 0,
    currentLatitude: loc ? loc.latitude : null,
    currentLongitude: loc ? loc.longitude : null,
    currentAccuracyMeters: loc ? loc.accuracyMeters : null,
    currentMapsUrl: loc ? loc.mapsUrl : null,
    updatedAt: new Date().toISOString(),
    updatedAtMs: Date.now(),
  };
}

async function updateReportLiveFields(session) {
  const payload = buildReportLiveUpdatePayload(session);
  const index = memoryReports.findIndex((item) => item.id === session.reportId);
  if (index !== -1) memoryReports[index] = { ...memoryReports[index], ...payload };

  if (!firestoreDb || !session.reportId) return;

  try {
    await firestoreDb.collection(REPORT_COLLECTION).doc(session.reportId).set(payload, { merge: true });
  } catch (error) {
    console.error("Failed to update report live fields:", error.message);
  }
}

async function saveLiveSession(session) {
  memoryLiveSessions.set(session.id, session);
  if (!firestoreDb) return { storage: "memory", firebaseStatus, firebaseError };

  await firestoreDb.collection(LIVE_SESSION_COLLECTION).doc(session.id).set(
    {
      ...session,
      updatedAtMs: Date.now(),
      storageSource: "firebase-firestore",
    },
    { merge: true }
  );

  return { storage: "firebase-firestore", firebaseStatus, firebaseError: null };
}

async function saveLiveLocationPoint(session, locationData, sequence) {
  if (!firestoreDb) return;

  try {
    const id = `${String(sequence || 0).padStart(6, "0")}_${Date.now()}`;
    await firestoreDb.collection(LIVE_SESSION_COLLECTION).doc(session.id).collection("points").doc(id).set({
      sessionId: session.id,
      reportId: session.reportId,
      sequence,
      locationData,
      capturedAtIso: locationData.capturedAtIso,
      createdAtIso: new Date().toISOString(),
      createdAtMs: Date.now(),
    });
  } catch (error) {
    console.error("Failed to save live point:", error.message);
  }
}

async function loadLiveSessions(limit = 50) {
  if (!firestoreDb) {
    return Array.from(memoryLiveSessions.values()).sort((a, b) => Number(b.updatedAtMs || 0) - Number(a.updatedAtMs || 0)).slice(0, limit);
  }

  try {
    const snapshot = await firestoreDb.collection(LIVE_SESSION_COLLECTION).orderBy("updatedAtMs", "desc").limit(limit).get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error("Failed to load live sessions:", error.message);
    return Array.from(memoryLiveSessions.values());
  }
}

async function loadLiveSessionById(sessionId) {
  const id = String(sessionId || "").trim();
  if (!id) return null;
  if (memoryLiveSessions.has(id)) return memoryLiveSessions.get(id);
  if (!firestoreDb) return null;

  try {
    const doc = await firestoreDb.collection(LIVE_SESSION_COLLECTION).doc(id).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  } catch (error) {
    console.error("Failed to load live session:", error.message);
    return null;
  }
}

async function handleLiveTrackingStart(req, res) {
  try {
    const body = await readJsonBody(req);
    const reportId = String(body.reportId || "").trim();
    const durationRaw = Number(body.durationMinutes || 30);
    const durationMinutes = Number.isFinite(durationRaw) ? Math.min(Math.max(durationRaw, 1), 120) : 30;
    const firstLocation = sanitizeLocationData(body.initialLocation);

    if (!reportId) return sendJson(res, 400, { ok: false, error: "Missing reportId." });
    if (!firstLocation) return sendJson(res, 400, { ok: false, error: "Missing valid initialLocation for live tracking." });

    const now = new Date();
    const expiresAt = new Date(now.getTime() + durationMinutes * 60 * 1000);
    const liveSession = {
      id: makeId("live"),
      reportId,
      status: "active",
      source: String(body.source || "flutter-app"),
      transcript: body.transcript || null,
      report: body.report || null,
      durationMinutes,
      startedAtIso: now.toISOString(),
      expiresAtIso: expiresAt.toISOString(),
      startedAtMs: now.getTime(),
      expiresAtMs: expiresAt.getTime(),
      latestLocation: firstLocation,
      lastLocationAtIso: firstLocation.capturedAtIso,
      updateCount: 1,
      lastSequence: 0,
      updatedAtIso: now.toISOString(),
      updatedAtMs: now.getTime(),
      stopReason: null,
    };

    const storageResult = await saveLiveSession(liveSession);
    await saveLiveLocationPoint(liveSession, firstLocation, 0);
    await updateReportLiveFields(liveSession);

    sendJson(res, 201, { ok: true, message: "Emergency live tracking started.", liveSession, ...storageResult });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message });
  }
}

async function handleLiveTrackingUpdate(req, res) {
  try {
    const body = await readJsonBody(req);
    const sessionId = String(body.sessionId || "").trim();
    const reportId = String(body.reportId || "").trim();
    const sequence = Number(body.sequence || 0);
    const cleanLocation = sanitizeLocationData(body.locationData);

    if (!sessionId) return sendJson(res, 400, { ok: false, error: "Missing sessionId." });
    if (!cleanLocation) return sendJson(res, 400, { ok: false, error: "Missing valid locationData." });

    const existing = await loadLiveSessionById(sessionId);
    if (!existing) return sendJson(res, 404, { ok: false, error: "Live tracking session not found." });

    const status = getLiveSessionComputedStatus(existing);
    const updated = {
      ...existing,
      reportId: existing.reportId || reportId,
      status: status === "expired" ? "expired" : "active",
      latestLocation: cleanLocation,
      lastLocationAtIso: cleanLocation.capturedAtIso,
      lastSequence: Number.isFinite(sequence) ? sequence : existing.lastSequence || 0,
      updateCount: Number(existing.updateCount || 0) + 1,
      updatedAtIso: new Date().toISOString(),
      updatedAtMs: Date.now(),
    };

    const storageResult = await saveLiveSession(updated);
    await saveLiveLocationPoint(updated, cleanLocation, updated.lastSequence);
    await updateReportLiveFields(updated);

    sendJson(res, 200, {
      ok: true,
      message: updated.status === "expired" ? "Live tracking session has expired. Last location saved." : "Live location updated.",
      liveSession: updated,
      ...storageResult,
    });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message });
  }
}

async function handleLiveTrackingStop(req, res) {
  try {
    const body = await readJsonBody(req);
    const sessionId = String(body.sessionId || "").trim();
    const reason = String(body.reason || "Live tracking stopped.").slice(0, 300);

    if (!sessionId) return sendJson(res, 400, { ok: false, error: "Missing sessionId." });

    const existing = await loadLiveSessionById(sessionId);
    if (!existing) return sendJson(res, 404, { ok: false, error: "Live tracking session not found." });

    const stopped = {
      ...existing,
      status: reason.toLowerCase().includes("expired") ? "expired" : "stopped",
      stopReason: reason,
      stoppedAtIso: body.stoppedAtIso || new Date().toISOString(),
      updatedAtIso: new Date().toISOString(),
      updatedAtMs: Date.now(),
    };

    const storageResult = await saveLiveSession(stopped);
    await updateReportLiveFields(stopped);

    sendJson(res, 200, { ok: true, message: reason, liveSession: stopped, ...storageResult });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message });
  }
}

async function handleLiveTrackingList(req, res) {
  const sessions = await loadLiveSessions(100);
  sendJson(res, 200, { ok: true, totalSessions: sessions.length, liveSessions: sessions, storage: firestoreDb ? "firebase-firestore" : "memory", firebaseStatus, firebaseError });
}

async function handleAnalyzeText(req, res) {
  try {
    const body = await readJsonBody(req);
    if (!body.transcript || typeof body.transcript !== "string") return sendJson(res, 400, { ok: false, error: "Missing transcript" });
    sendJson(res, 200, { ok: true, ...(await analyzeTranscript(body.transcript)) });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: cleanAiErrorMessage(error.message) });
  }
}

async function handleAnalyzeAudio(req, res) {
  try {
    const body = await readJsonBody(req);
    if (!body.audioBase64 || typeof body.audioBase64 !== "string") return sendJson(res, 400, { ok: false, error: "Missing audioBase64" });

    try {
      sendJson(res, 200, { ok: true, mode: "gemini-audio", ...(await analyzeAudioWithGemini(body.audioBase64, body.mimeType || "audio/mp4")) });
    } catch (error) {
      sendJson(res, 200, {
        ok: false,
        mode: "audio-ai-unavailable",
        error: cleanAiErrorMessage(error.message),
        detectedLanguage: "Unknown",
        originalTranscript: "Audio transcript unavailable.",
        banglaTranscript: "",
        englishTranslation: "",
        banglishRoman: "",
        report: buildRepeatReport("The backend received the audio, but real AI audio understanding is temporarily unavailable."),
      });
    }
  } catch (error) {
    sendJson(res, 500, { ok: false, error: cleanAiErrorMessage(error.message) });
  }
}

async function handleSubmitReport(req, res) {
  try {
    const body = await readJsonBody(req);
    if (!body.report || typeof body.report !== "object") return sendJson(res, 400, { ok: false, error: "Missing report object" });

    const nowIso = new Date().toISOString();
    const savedReport = {
      id: makeId("civicflow"),
      createdAt: nowIso,
      updatedAt: nowIso,
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
      status: String(body.status || "Received"),
      source: String(body.source || "flutter-app"),
      transcript: body.transcript || null,
      adminNote: "",
      locationData: body.locationData || null,
      liveTrackingEnabled: false,
      liveTrackingStatus: null,
      liveSessionId: null,
      report: mergeLocationIntoReport(body.report, body.locationData),
    };

    const storageResult = await saveReport(savedReport);
    sendJson(res, 201, { ok: true, message: "Report received by CivicFlow AI backend.", savedReport, totalReports: memoryReports.length, ...storageResult });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message });
  }
}

async function handleListReports(req, res) {
  const result = await loadReports();
  sendJson(res, 200, { ok: true, totalReports: result.reports.length, reports: result.reports, storage: result.storage, firebaseStatus: result.firebaseStatus, firebaseError: result.firebaseError });
}

async function handleAdminReportsJson(req, res) {
  if (!isDashboardAuthorized(req)) return sendJson(res, 401, { ok: false, error: "Admin login required." });
  await handleListReports(req, res);
}

async function handleTest(req, res, url) {
  const text = url.searchParams.get("text") || "আমার এলাকায় পানি নেই";
  sendJson(res, 200, { ok: true, input: text, ...(await analyzeTranscript(text)) });
}

function formatDateTime(value) {
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value || "Unknown time");
    return date.toLocaleString("en-GB", { timeZone: "Asia/Dhaka", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
  } catch (_) {
    return String(value || "Unknown time");
  }
}

function buildStatusOptions(currentStatus) {
  const current = String(currentStatus || "Received");
  const options = STATUS_OPTIONS.includes(current) ? STATUS_OPTIONS : [current, ...STATUS_OPTIONS];
  return options.map((option) => `<option value="${escapeHtml(option)}" ${option === current ? "selected" : ""}>${escapeHtml(option)}</option>`).join("");
}

function buildDashboardLoginPage(message = "") {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CivicFlow AI Admin Login</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:linear-gradient(135deg,#f8fafc 0%,#e0f2fe 48%,#eef2ff 100%);color:#0f172a;font-family:Inter,Arial,sans-serif;padding:20px}.card{width:100%;max-width:460px;background:rgba(255,255,255,.94);border:1px solid rgba(148,163,184,.28);border-radius:30px;padding:30px;box-shadow:0 24px 70px rgba(15,23,42,.12)}h1{margin:0 0 8px;font-size:32px;letter-spacing:-.04em}p{color:#64748b;line-height:1.55;margin:0 0 22px}label{font-size:13px;color:#475569;font-weight:900;letter-spacing:.08em;text-transform:uppercase}input{width:100%;margin-top:8px;padding:15px;border-radius:16px;border:1px solid #dbe3ef;background:#f8fafc;color:#0f172a;outline:none;font-weight:800}input:focus{border-color:#38bdf8;box-shadow:0 0 0 4px rgba(56,189,248,.16)}button{width:100%;margin-top:16px;padding:15px;border:0;border-radius:999px;background:#0284c7;color:#fff;font-weight:950;cursor:pointer;box-shadow:0 14px 28px rgba(2,132,199,.22)}.warning,.error{padding:13px;border-radius:16px;margin-bottom:14px;font-weight:850}.warning{background:#fff7ed;color:#c2410c;border:1px solid #fed7aa}.error{background:#fff1f2;color:#be123c;border:1px solid #fecdd3}.brand{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;background:#e0f2fe;color:#0369a1;font-weight:950;font-size:12px;margin-bottom:16px}</style></head><body><main class="card"><div class="brand">● Protected Backend</div><h1>CivicFlow AI</h1><p>Secure admin dashboard for reports and emergency live tracking.</p>${!ADMIN_PASSWORD ? `<div class="warning">ADMIN_PASSWORD is not set in Render Environment yet.</div>` : ""}${message ? `<div class="error">${escapeHtml(message)}</div>` : ""}<form method="POST" action="/dashboard-login"><label>Admin Password</label><input name="password" type="password" placeholder="Enter password"><button type="submit">Open Dashboard</button></form></main></body></html>`;
}

async function handleDashboardLogin(req, res) {
  if (!ADMIN_PASSWORD) return sendHtml(res, buildDashboardLoginPage("ADMIN_PASSWORD is not set in Render Environment yet."), 500);
  const password = String((await readFormBody(req)).get("password") || "");
  if (!safeCompare(password, ADMIN_PASSWORD)) return sendHtml(res, buildDashboardLoginPage("Wrong password. Try again."), 401);
  redirect(res, "/dashboard/reports", { "Set-Cookie": `${ADMIN_COOKIE_NAME}=${encodeURIComponent(makeAdminSessionToken())}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${getSecureCookieSuffix(req)}` });
}

function handleDashboardLogout(req, res) {
  redirect(res, "/dashboard", { "Set-Cookie": `${ADMIN_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${getSecureCookieSuffix(req)}` });
}

async function handleUpdateReportStatus(req, res) {
  if (!isDashboardAuthorized(req)) return sendHtml(res, buildDashboardLoginPage("Please login first."), 401);

  try {
    const form = await readFormBody(req);
    await updateReportStatus(String(form.get("reportId") || ""), String(form.get("status") || ""), String(form.get("adminNote") || ""));
    redirect(res, "/dashboard/reports");
  } catch (error) {
    sendHtml(res, `<h1 style="font-family:Arial;color:#0f172a;background:#f8fafc;padding:30px">Status update failed</h1><p style="font-family:Arial;color:#be123c;background:#f8fafc;padding:0 30px 30px">${escapeHtml(error.message)}</p><p style="font-family:Arial;background:#f8fafc;padding:0 30px 30px"><a style="color:#0284c7" href="/dashboard/reports">Back</a></p>`, 500);
  }
}

function buildDashboardCss() {
  return `<style>:root{--bg:#f5f8fc;--panel:#fff;--ink:#0f172a;--muted:#64748b;--line:#e5edf6;--primary:#0284c7;--green:#16a34a;--red:#e11d48}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,Arial,sans-serif;letter-spacing:-.01em}.layout{display:grid;grid-template-columns:280px 1fr;min-height:100vh}aside{background:linear-gradient(180deg,#fff 0%,#f8fbff 100%);border-right:1px solid var(--line);padding:24px;position:sticky;top:0;height:100vh;overflow:auto}main{padding:28px 30px 44px;max-width:1680px;width:100%;margin:0 auto}h1{font-size:32px;margin:0 0 8px;letter-spacing:-.045em}h2{font-size:22px;margin:0 0 14px;letter-spacing:-.035em}h3{font-size:17px;margin:12px 0 14px}p{color:var(--muted);line-height:1.55;margin:0}.brand-pill,.pill,.badge{display:inline-flex;align-items:center;justify-content:center;border-radius:999px;font-size:12px;font-weight:950;white-space:nowrap}.brand-pill{padding:8px 12px;background:#e0f2fe;color:#0369a1;margin-bottom:18px}.pill{padding:7px 11px;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe}.badge{padding:7px 10px;margin-right:6px}.badge.normal{background:#e0f2fe;color:#0369a1}.badge.emergency{background:#ffe4e6;color:#be123c}.badge.live{background:#dcfce7;color:#15803d}.badge.expired{background:#f1f5f9;color:#475569}.badge.stopped{background:#fef3c7;color:#b45309}.side-title{font-size:28px;margin:0 0 8px;letter-spacing:-.045em}.side-caption{font-size:14px;margin-bottom:20px}.side-card,.stat,.section,.report,.live,.mini,.gps,.text{background:var(--panel);border:1px solid var(--line);border-radius:22px;box-shadow:0 8px 22px rgba(15,23,42,.035)}.side-card{padding:14px 15px;margin:11px 0}.side-card span,.mini span,.gps span,.text span{display:block;color:#64748b;text-transform:uppercase;font-size:10.5px;letter-spacing:.12em;font-weight:950;margin-bottom:7px}.side-card b,.mini b{font-size:14px}.good{background:#f0fdf4;border-color:#bbf7d0}.bad{background:#fff1f2;border-color:#fecdd3}.blue{background:#eff6ff;border-color:#bfdbfe}.topbar{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:20px}.page-title-block{max-width:720px}.toolbar{display:flex;align-items:center;justify-content:flex-end;gap:10px;flex-wrap:wrap}.tabs{display:inline-flex;gap:6px;padding:5px;background:#eaf1f8;border:1px solid #dbe7f3;border-radius:999px}.tab{display:inline-flex;align-items:center;justify-content:center;text-decoration:none;border-radius:999px;padding:10px 15px;font-size:13px;font-weight:950;color:#475569}.tab.active{background:#fff;color:#0369a1;box-shadow:0 6px 16px rgba(15,23,42,.08)}.actions{display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap}.actions form{margin:0;display:flex}.button{display:inline-flex;align-items:center;justify-content:center;text-decoration:none;border:0;border-radius:999px;padding:0 16px;min-height:42px;height:42px;width:auto;max-width:max-content;line-height:1;font-weight:950;cursor:pointer;background:var(--primary);color:#fff;white-space:nowrap;box-shadow:0 10px 22px rgba(2,132,199,.18)}.button.dark{background:#fff;color:#0f172a;border:1px solid var(--line);box-shadow:0 8px 20px rgba(15,23,42,.05)}.button.logout{background:#fff1f2;color:#be123c;border:1px solid #fecdd3;box-shadow:none}.button.green{background:#16a34a;box-shadow:0 10px 22px rgba(22,163,74,.16)}.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:18px 0 22px}.stat{padding:18px;position:relative;overflow:hidden}.stat:before{content:"";position:absolute;right:-30px;top:-30px;width:92px;height:92px;border-radius:50%;background:#e0f2fe}.stat b{display:block;font-size:32px;line-height:1;color:var(--primary);position:relative}.stat strong{display:block;margin-top:7px;font-size:13px;color:#334155;position:relative}.stat.red:before{background:#ffe4e6}.stat.red b{color:var(--red)}.stat.green:before{background:#dcfce7}.stat.green b{color:var(--green)}.section{padding:20px;margin-bottom:20px}.section-head{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:14px}.report,.live{padding:18px;margin-bottom:16px}.report.emergency{border-color:#fecdd3}.card-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;border-bottom:1px solid #edf2f7;padding-bottom:14px;margin-bottom:14px}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.mini,.gps,.text{padding:13px;margin-top:10px}.gps{background:#f0f9ff;border-color:#bae6fd}.gps.green-panel{background:#f0fdf4;border-color:#bbf7d0}.text{box-shadow:none}.action{background:#f0fdf4;border-color:#bbf7d0}.empty{padding:28px;border:1px dashed #b9c8d8;border-radius:22px;text-align:center;color:#64748b;background:#f8fafc;font-weight:850}.notice{padding:14px 16px;border-radius:18px;background:#eff6ff;border:1px solid #bfdbfe;color:#1e40af;font-weight:850}select,textarea{width:100%;margin-top:8px;border-radius:14px;border:1px solid #dbe3ef;background:#fff;color:#0f172a;padding:12px;font-weight:750;outline:none}textarea{min-height:72px;resize:vertical}select:focus,textarea:focus{border-color:#38bdf8;box-shadow:0 0 0 4px rgba(56,189,248,.14)}.admin-form{margin-top:14px;padding:14px;border-radius:18px;background:#f8fafc;border:1px solid #e8eef6}details.history{margin-top:18px}details.history summary{cursor:pointer;color:#334155;font-weight:950;padding:16px;border-radius:20px;background:#fff;border:1px solid var(--line);box-shadow:0 8px 22px rgba(15,23,42,.035)}@media(max-width:1100px){.layout{grid-template-columns:1fr}aside{position:relative;height:auto}.stats,.grid{grid-template-columns:1fr}.topbar{flex-direction:column}.toolbar{justify-content:flex-start}.actions{justify-content:flex-start}}@media(max-width:620px){main{padding:20px}.tabs,.toolbar,.actions{width:100%}.tab,.button{flex:1;max-width:none}.stats{gap:10px}h1{font-size:27px}.side-title{font-size:24px}}</style>`;
}

function buildStorageBox(storage, firebaseErrorValue) {
  if (storage === "firebase-firestore" || firebaseStatus === "connected") return `<div class="side-card good"><span>Storage</span><b>Firebase Firestore connected</b></div>`;
  return `<div class="side-card bad"><span>Storage</span><b>${escapeHtml(storage || firebaseStatus)}<br>${escapeHtml(firebaseErrorValue || firebaseError || "Firebase not connected")}</b></div>`;
}

function buildDashboardSidebar({ latest, total, emergency, normal, activeLive, storage, firebaseErrorValue }) {
  return `<aside><div class="brand-pill">● Protected Backend</div><h1 class="side-title">CivicFlow AI</h1><p class="side-caption">Admin command center for reports and live emergency tracking.</p><div class="side-card blue"><span>AI Mode</span><b>${GEMINI_API_KEY ? "Gemini Ready" : "Fallback Only"}</b></div><div class="side-card"><span>Model</span><b>${escapeHtml(GEMINI_MODEL)}</b></div>${buildStorageBox(storage, firebaseErrorValue)}<div class="side-card"><span>Latest Report</span><b>${escapeHtml(latest)}</b></div><div class="side-card"><span>Total Reports</span><b>${total}</b></div><div class="side-card bad"><span>Emergency Routes</span><b>${emergency}</b></div><div class="side-card"><span>Normal Routes</span><b>${normal}</b></div><div class="side-card good"><span>Live Tracking</span><b>${activeLive} active session(s)</b></div></aside>`;
}

function buildTopActions(activePage, refreshPath) {
  return `<div class="toolbar"><div class="tabs"><a class="tab ${activePage === "reports" ? "active" : ""}" href="/dashboard/reports">Reports</a><a class="tab ${activePage === "live" ? "active" : ""}" href="/dashboard/live">Live Tracking</a></div><div class="actions"><a class="button dark" href="/api/civicflow/admin/reports-json" target="_blank">View JSON</a><a class="button" href="${escapeHtml(refreshPath)}">Refresh</a><form method="POST" action="/dashboard-logout"><button class="button logout" type="submit">Logout</button></form></div></div>`;
}

function buildStats(total, emergency, normal, activeLive) {
  return `<div class="stats"><div class="stat"><b>${total}</b><strong>Total Reports</strong></div><div class="stat red"><b>${emergency}</b><strong>Emergency Routes</strong></div><div class="stat"><b>${normal}</b><strong>Normal Routes</strong></div><div class="stat green"><b>${activeLive}</b><strong>Active Live</strong></div></div>`;
}

function buildDashboardLayout({ title, subtitle, activePage, refreshPath, autoRefreshSeconds, sidebar, stats, content }) {
  const metaRefresh = autoRefreshSeconds ? `<meta http-equiv="refresh" content="${autoRefreshSeconds}">` : "";
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">${metaRefresh}<title>${escapeHtml(title)}</title>${buildDashboardCss()}</head><body><div class="layout">${sidebar}<main><div class="topbar"><div class="page-title-block"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div>${buildTopActions(activePage, refreshPath)}</div>${stats}${content}</main></div></body></html>`;
}

async function handleReportsDashboard(req, res) {
  if (!isDashboardAuthorized(req)) return sendHtml(res, buildDashboardLoginPage("Please login first."), 401);

  const loadResult = await loadReports();
  const reports = loadResult.reports;
  const liveSessions = await loadLiveSessions(50);
  const total = reports.length;
  const emergency = reports.filter((x) => x.report && x.report.isEmergency).length;
  const normal = total - emergency;
  const activeLive = liveSessions.filter((x) => getLiveSessionComputedStatus(x) === "active").length;
  const latest = reports[0] ? `${reports[0].report?.category || "Report"} • ${formatDateTime(reports[0].createdAt)}` : "No report yet";
  const sidebar = buildDashboardSidebar({ latest, total, emergency, normal, activeLive, storage: loadResult.storage, firebaseErrorValue: loadResult.firebaseError });
  const cards = reports.map((item, index) => buildReportCard(item, index, liveSessions, false)).join("") || `<div class="empty">No reports received yet.</div>`;
  const content = `<section class="section"><div class="section-head"><div><h2>Submitted Reports</h2><p>Review, update, and manage citizen help routes. Live tracking is separated for faster monitoring.</p></div><span class="pill">${total} records</span></div>${cards}</section>`;
  sendHtml(res, buildDashboardLayout({ title: "Submitted Reports", subtitle: "Clean report review workspace for citizen help routes.", activePage: "reports", refreshPath: "/dashboard/reports", autoRefreshSeconds: null, sidebar, stats: buildStats(total, emergency, normal, activeLive), content }));
}

async function handleLiveDashboard(req, res) {
  if (!isDashboardAuthorized(req)) return sendHtml(res, buildDashboardLoginPage("Please login first."), 401);

  const loadResult = await loadReports();
  const reports = loadResult.reports;
  const liveSessions = await loadLiveSessions(100);
  const total = reports.length;
  const emergency = reports.filter((x) => x.report && x.report.isEmergency).length;
  const normal = total - emergency;
  const activeSessions = liveSessions.filter((session) => getLiveSessionComputedStatus(session) === "active");
  const inactiveSessions = liveSessions.filter((session) => getLiveSessionComputedStatus(session) !== "active");
  const activeLive = activeSessions.length;
  const latest = reports[0] ? `${reports[0].report?.category || "Report"} • ${formatDateTime(reports[0].createdAt)}` : "No report yet";
  const sidebar = buildDashboardSidebar({ latest, total, emergency, normal, activeLive, storage: loadResult.storage, firebaseErrorValue: loadResult.firebaseError });
  const activeCards = activeSessions.map(buildLiveSessionCard).join("") || `<div class="empty">No active live tracking sessions right now.</div>`;
  const inactiveCards = inactiveSessions.slice(0, 12).map(buildLiveSessionCard).join("") || `<div class="empty">No expired or stopped live sessions yet.</div>`;
  const content = `<section class="section"><div class="section-head"><div><h2>Active Live Emergency Tracking</h2><p>Auto-refreshes every 10 seconds. Active sessions stay at the top for quick authority action.</p></div><span class="pill">${activeLive} active</span></div><div class="notice">Open the latest location from an active session to monitor movement in Google Maps.</div><br>${activeCards}</section><details class="history"><summary>Show recent expired / stopped live sessions</summary><br>${inactiveCards}</details>`;
  sendHtml(res, buildDashboardLayout({ title: "Live Emergency Tracking", subtitle: "Focused monitoring page for emergency live location sessions.", activePage: "live", refreshPath: "/dashboard/live", autoRefreshSeconds: 10, sidebar, stats: buildStats(total, emergency, normal, activeLive), content }));
}

function buildReportCard(item, index, liveSessions, showLiveMini = false) {
  const r = item.report || {};
  const isE = Boolean(r.isEmergency);
  const live = item.liveSessionId ? liveSessions.find((s) => s.id === item.liveSessionId) : liveSessions.find((s) => String(s.reportId) === String(item.id));
  const liveStatus = live ? getLiveSessionComputedStatus(live) : null;
  const help = r.helplineLabel && r.helplineNumber ? `${r.helplineLabel} • ${r.helplineNumber}` : "No helpline selected";

  return `<article class="report ${isE ? "emergency" : ""}"><div class="card-head"><div><span class="badge ${isE ? "emergency" : "normal"}">${isE ? "Emergency" : "Normal"}</span>${liveStatus ? `<span class="badge ${liveStatus === "active" ? "live" : liveStatus === "stopped" ? "stopped" : "expired"}">Live ${escapeHtml(liveStatus)}</span>` : ""}<span style="color:#64748b;font-weight:950">#${index + 1}</span><h2>${escapeHtml(r.category || "Citizen Report")}</h2></div><b style="color:#64748b">${escapeHtml(formatDateTime(item.createdAt))}</b></div><div class="grid"><div class="mini"><span>Status</span><b>${escapeHtml(item.status || "Received")}</b></div><div class="mini"><span>Source</span><b>${escapeHtml(item.source || "flutter-app")}</b></div><div class="mini"><span>Area</span><b>${escapeHtml(r.location || "Current user area")}</b></div><div class="mini"><span>Help</span><b>${escapeHtml(help)}</b></div></div>${buildGpsBlock(r)}${showLiveMini && live ? buildLiveMiniBlock(live) : ""}<div class="text"><span>Transcript</span>${escapeHtml(item.transcript || "No transcript")}</div><div class="text"><span>AI Summary</span>${escapeHtml(r.summary || "No summary")}</div><div class="text action"><span>Recommended Action</span>${escapeHtml(r.recommendedAction || "No action")}</div><form method="POST" action="/dashboard/update-status" class="admin-form"><input type="hidden" name="reportId" value="${escapeHtml(item.id)}"><label><b>Update Status</b></label><select name="status">${buildStatusOptions(item.status)}</select><label style="display:block;margin-top:10px"><b>Admin Note</b></label><textarea name="adminNote" placeholder="Write admin note or action taken...">${escapeHtml(item.adminNote || "")}</textarea><button class="button" type="submit" style="margin-top:10px">Save Status</button></form><p style="font-size:12px;color:#94a3b8;margin-top:10px"><b>ID:</b> ${escapeHtml(item.id)}</p></article>`;
}

function buildGpsBlock(r) {
  const hasGps = r.gpsLatitude !== null && r.gpsLatitude !== undefined && r.gpsLongitude !== null && r.gpsLongitude !== undefined;
  if (!hasGps) return "";
  const url = r.mapsUrl || `https://www.google.com/maps?q=${r.gpsLatitude},${r.gpsLongitude}`;
  return `<div class="gps"><span>GPS Location</span><b>Latitude: ${escapeHtml(r.gpsLatitude)}<br>Longitude: ${escapeHtml(r.gpsLongitude)}</b><br><span style="margin-top:8px;text-transform:none;letter-spacing:0;color:#475569">GPS Accuracy: about ${escapeHtml(r.gpsAccuracyMeters || "unknown")} meters<br>Captured: ${escapeHtml(formatDateTime(r.gpsCapturedAtIso))}</span><p style="margin-top:12px"><a class="button dark" href="${escapeHtml(url)}" target="_blank">Open in Google Maps</a></p></div>`;
}

function buildLiveMiniBlock(s) {
  const loc = s.latestLocation || {};
  const url = loc.mapsUrl || (loc.latitude && loc.longitude ? `https://www.google.com/maps?q=${loc.latitude},${loc.longitude}` : "");
  return `<div class="gps green-panel"><span>Live Tracking</span><b>Status: ${escapeHtml(getLiveSessionComputedStatus(s))}<br>Updates: ${escapeHtml(s.updateCount || 0)}<br>Expires: ${escapeHtml(formatDateTime(s.expiresAtIso))}</b>${url ? `<p style="margin-top:12px"><a class="button green" href="${escapeHtml(url)}" target="_blank">Open Latest Live Location</a></p>` : ""}</div>`;
}

function buildLiveSessionCard(s) {
  const loc = s.latestLocation || {};
  const url = loc.mapsUrl || (loc.latitude && loc.longitude ? `https://www.google.com/maps?q=${loc.latitude},${loc.longitude}` : "");
  const status = getLiveSessionComputedStatus(s);
  const statusClass = status === "active" ? "live" : status === "stopped" ? "stopped" : "expired";
  return `<article class="live"><div class="card-head"><div><span class="badge ${statusClass}">${escapeHtml(status)}</span><h3>Live Session ${escapeHtml(s.id)}</h3></div>${url ? `<a class="button green" href="${escapeHtml(url)}" target="_blank">Open Latest Location</a>` : ""}</div><div class="grid"><div class="mini"><span>Report ID</span><b>${escapeHtml(s.reportId || "Unknown")}</b></div><div class="mini"><span>Started</span><b>${escapeHtml(formatDateTime(s.startedAtIso))}</b></div><div class="mini"><span>Expires</span><b>${escapeHtml(formatDateTime(s.expiresAtIso))}</b></div><div class="mini"><span>Updates</span><b>${escapeHtml(s.updateCount || 0)}</b></div></div>${loc.latitude && loc.longitude ? `<div class="gps green-panel"><span>Latest Live Location</span><b>Latitude: ${escapeHtml(loc.latitude)}<br>Longitude: ${escapeHtml(loc.longitude)}<br>GPS Accuracy: about ${escapeHtml(loc.accuracyMeters || "unknown")} meters</b>${s.lastLocationAtIso ? `<br><span style="margin-top:8px;text-transform:none;letter-spacing:0;color:#475569">Last update: ${escapeHtml(formatDateTime(s.lastLocationAtIso))}</span>` : ""}</div>` : `<div class="empty">No live location point saved for this session yet.</div>`}${s.stopReason ? `<div class="text"><span>Stop Reason</span>${escapeHtml(s.stopReason)}</div>` : ""}</article>`;
}

async function routeRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const path = url.pathname;
  if (req.method === "OPTIONS") return sendJson(res, 200, { ok: true });

  try {
    if (req.method === "GET" && ["/", "/health", "/api/health"].includes(path)) return sendJson(res, 200, { ok: true, service: "CivicFlow AI Backend", aiMode: GEMINI_API_KEY ? "gemini-ready" : "fallback-only", model: GEMINI_MODEL, firebaseStatus, firebaseError, time: new Date().toISOString() });
    if (req.method === "POST" && path === "/api/civicflow/analyze-text") return await handleAnalyzeText(req, res);
    if (req.method === "POST" && path === "/api/civicflow/analyze-audio") return await handleAnalyzeAudio(req, res);
    if (req.method === "POST" && ["/api/civicflow/reports", "/api/reports"].includes(path)) return await handleSubmitReport(req, res);
    if (req.method === "GET" && ["/api/civicflow/reports", "/api/reports"].includes(path)) return await handleListReports(req, res);
    if (req.method === "GET" && path === "/api/civicflow/admin/reports-json") return await handleAdminReportsJson(req, res);
    if (req.method === "POST" && path === "/api/civicflow/live-location/start") return await handleLiveTrackingStart(req, res);
    if (req.method === "POST" && path === "/api/civicflow/live-location/update") return await handleLiveTrackingUpdate(req, res);
    if (req.method === "POST" && path === "/api/civicflow/live-location/stop") return await handleLiveTrackingStop(req, res);
    if (req.method === "GET" && path === "/api/civicflow/live-location/sessions") return await handleLiveTrackingList(req, res);
    if (req.method === "GET" && path === "/api/civicflow/test") return await handleTest(req, res, url);
    if (req.method === "GET" && path === "/dashboard-login") return sendHtml(res, buildDashboardLoginPage());
    if (req.method === "POST" && path === "/dashboard-login") return await handleDashboardLogin(req, res);
    if (req.method === "POST" && path === "/dashboard-logout") return handleDashboardLogout(req, res);
    if (req.method === "POST" && path === "/dashboard/update-status") return await handleUpdateReportStatus(req, res);
    if (req.method === "GET" && path === "/dashboard") return await handleReportsDashboard(req, res);
    if (req.method === "GET" && path === "/dashboard/reports") return await handleReportsDashboard(req, res);
    if (req.method === "GET" && path === "/dashboard/live") return await handleLiveDashboard(req, res);

    sendJson(res, 404, { ok: false, error: "Route not found.", path });
  } catch (error) {
    console.error("Unhandled request error:", error);
    sendJson(res, 500, { ok: false, error: error.message || "Internal server error." });
  }
}

http.createServer((req, res) => {
  routeRequest(req, res);
}).listen(PORT, () => {
  console.log(`CivicFlow AI backend running on port ${PORT}`);
});
