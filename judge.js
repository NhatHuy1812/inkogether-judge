import { GoogleGenerativeAI } from "@google/generative-ai";
import { performance } from "perf_hooks";

const MIN_SCORE = 0.1;
const QUICK_MATCH_THRESHOLD = 0.5;
const MIN_WORD_LENGTH = 3; 

// Stopwords to ignore during matching (very common words that carry no signal)
const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all",
  "can", "had", "her", "was", "one", "our", "out", "day",
  "get", "has", "him", "his", "how", "its", "let", "may",
  "nor", "now", "off", "old", "own", "put", "say", "she",
  "too", "use", "way", "who", "did", "man",
]);

/**
 * Normalizes a string: lowercase, trim, collapse whitespace.
 * Returns null if the input is empty/nullish.
 */
function normalize(str) {
  if (!str || typeof str !== "string") return null;
  return str.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Tokenizes a normalized string into meaningful words (no stopwords, min length).
 */
function tokenize(str) {
  return str
    .split(" ")
    .filter(w => w.length >= MIN_WORD_LENGTH && !STOPWORDS.has(w));
}

/**
 * Clamps a number to [min, max].
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Wraps performance.now() into a simple stopwatch.
 */
function stopwatch() {
  const start = performance.now();
  return () => parseFloat((performance.now() - start).toFixed(2));
}

// ---------------------------------------------------------------------------
// quickMatch  (pure, synchronous)
// ---------------------------------------------------------------------------

/**
 * Fast heuristic similarity score using word overlap + character-level Jaccard.
 *
 * Scoring strategy:
 *   1. Word overlap  – weighted 70%
 *   2. Char-level Jaccard on bigrams – weighted 30% (catches morphological similarity)
 *
 * Both components are normalized to [0, 1] before blending.
 */
export function quickMatch(guess, target) {
  const elapsed = stopwatch();

  const g = normalize(guess);
  const t = normalize(target);

  if (!g || !t) return { score: MIN_SCORE, duration: 0 };

  // ── Exact match shortcut ──────────────────────────────────────────────────
  if (g === t) return { score: 1.0, duration: elapsed() };

  // ── Word overlap (F1-style) ───────────────────────────────────────────────
  const gWords = new Set(tokenize(g));
  const tWords = new Set(tokenize(t));

  let wordScore = 0;
  if (gWords.size > 0 && tWords.size > 0) {
    let hits = 0;
    for (const w of gWords) if (tWords.has(w)) hits++;
    const precision = hits / gWords.size;
    const recall    = hits / tWords.size;
    wordScore = precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : 0;
  }

  // ── Character bigram Jaccard ──────────────────────────────────────────────
  const bigrams = str => {
    const set = new Set();
    for (let i = 0; i < str.length - 1; i++) set.add(str.slice(i, i + 2));
    return set;
  };

  const gBi = bigrams(g.replace(/ /g, ""));
  const tBi = bigrams(t.replace(/ /g, ""));
  let charScore = 0;
  if (gBi.size > 0 && tBi.size > 0) {
    let intersection = 0;
    for (const b of gBi) if (tBi.has(b)) intersection++;
    charScore = intersection / (gBi.size + tBi.size - intersection);
  }

  const score = clamp(0.7 * wordScore + 0.3 * charScore, MIN_SCORE, 1.0);

  return {
    score: parseFloat(score.toFixed(4)),
    duration: elapsed(),
  };
}

// ---------------------------------------------------------------------------
// AI client cache  (singleton per API key)
// ---------------------------------------------------------------------------

const _clientCache = new Map();

function getModel(apiKey) {
  if (!_clientCache.has(apiKey)) {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash-lite",
      generationConfig: {
        temperature: 0,        // deterministic scoring
        maxOutputTokens: 64,   // only need {"score": 0.xx}
        responseMimeType: "application/json", // ask for JSON directly
      },
    });
    _clientCache.set(apiKey, model);
  }
  return _clientCache.get(apiKey);
}

// ---------------------------------------------------------------------------
// getAiScore  (async, calls Gemini)
// ---------------------------------------------------------------------------

const AI_PROMPT_TEMPLATE = (target, guess) =>
  `You are a semantic similarity judge for a word-guessing game.
The secret word/phrase is: "${target}"
The player's guess is: "${guess}"
Rate how semantically similar the guess is to the secret on a scale from 0.0 (completely unrelated) to 1.0 (exact or synonymous match).
Respond ONLY with valid JSON, no markdown: {"score": <float between 0.0 and 1.0>}`;

/**
 * Calls the Gemini API and returns a validated similarity score.
 * Returns MIN_SCORE on any failure so the caller always gets a usable number.
 */
export async function getAiScore(guess, target, apiKey) {
  const elapsed = stopwatch();

  if (!apiKey || typeof apiKey !== "string") {
    return { score: MIN_SCORE, duration: 0, error: "missing_api_key" };
  }

  const g = normalize(guess);
  const t = normalize(target);

  if (!g || !t) return { score: MIN_SCORE, duration: 0, error: "empty_input" };

  try {
    const model = getModel(apiKey);
    const result = await model.generateContent(AI_PROMPT_TEMPLATE(t, g));
    const raw = result.response.text().trim();

    // Parse JSON – strip accidental markdown fences if the model ignores instructions
    const jsonStr = raw.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(jsonStr);

    const score = typeof parsed?.score === "number"
      ? clamp(parsed.score, MIN_SCORE, 1.0)
      : MIN_SCORE;

    return { score: parseFloat(score.toFixed(4)), duration: elapsed() };
  } catch (error) {
    return {
      score: MIN_SCORE,
      duration: elapsed(),
      error: error?.message ?? "unknown_error",
    };
  }
}

// ---------------------------------------------------------------------------
// compareGuesses  (main entry point)
// ---------------------------------------------------------------------------

/**
 * Two-stage comparison:
 *   Stage 1 – quickMatch (free, instant)
 *   Stage 2 – getAiScore (paid API, only when heuristic is uncertain)
 *
 * The "uncertain zone" is [MIN_SCORE, QUICK_MATCH_THRESHOLD).
 * A perfect exact-match (1.0) from quickMatch also skips the AI call.
 */
export async function compareGuesses(guess, target, apiKey) {
  const quick = quickMatch(guess, target);

  const needsAi = quick.score < QUICK_MATCH_THRESHOLD && quick.score < 1.0;

  if (!needsAi) {
    return { ...quick, method: "quick" };
  }

  const ai = await getAiScore(guess, target, apiKey);
  return { ...ai, quickScore: quick.score, method: "ai" };
}

/**
 * GENERATE GAME PROMPTS (Gemini 2.0 Flash Lite)
 * Returns an array of simple English phrases for players to draw.
 */
export async function generateGamePrompts(apiKey, count = 10) {
    if (!apiKey) return [];

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ 
        model: "gemini-2.0-flash-lite",
        generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.8,
        }
    });

    const prompt = `
        Generate ${count} simple drawing prompts for a game. 
        Format: "Subject + Action + Object". 
        Difficulty: Easy to draw. 
        Return JSON: {"prompts": ["phrase1", "phrase2", ...]}
    `;

    try {
        const result = await model.generateContent(prompt);
        const data = JSON.parse(result.response.text());
        
        return data.prompts || []; 
    } catch (error) {
        console.error("[Generate Prompts Error]", error.message);
        return [
            "Cat riding a rocket", 
            "Dog wearing a hat", 
            "Robot eating an apple"
        ]; 
    }
}