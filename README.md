# Scoring Logic Integration — `judge.js`

This document explains how to use the exported functions in `judge.js` to build an automatic scoring system and prompt generator for a drawing game.

---

## Exported Functions

The module exposes three core functions for handling game logic.

### 1. `quickMatch(guess, target)`

Uses a **Keyword Matching** algorithm that runs directly on the server CPU.

- **Purpose:** Return an instant result (0ms latency) to the player.
- **Features:** Automatically strips Vietnamese diacritics, lowercases input, and filters out stop words.
- **Returns:**
  - `score` — Float between `0.1` and `1.0`
  - `duration` — Processing time in milliseconds

```javascript
import { quickMatch } from './judge.js';

const result = quickMatch("Con meo dang bay", "Con mèo bay");
console.log(result.score); // ~1.0 — diacritics are normalized before comparison
```

---

### 2. `getAiScore(guess, target, apiKey)`

Sends data to **Gemini 2.0 Flash Lite** for semantic similarity analysis.

- **Purpose:** Recognize synonyms and paraphrases (e.g., `"spacecraft"` ≈ `"rocket"`).
- **Features:** Optimized with JSON Mode for maximum throughput (~600–900ms response time).
- **Returns:**
  - `score` — Final float score determined by the AI
  - `duration` — API response time in milliseconds

```javascript
import { getAiScore } from './judge.js';

const aiResult = await getAiScore("Spaceship", "Rocket", process.env.GEMINI_API_KEY);
console.log(aiResult.score); // ~0.9 — AI understands these are semantically equivalent
```

---

### 3. `generateGamePrompts(apiKey, count)`

Requests the AI to generate a list of random drawing prompts.

- **Purpose:** Auto-generate prompts in English to start a new game round.
- **Prompt Structure:** Always follows the pattern `Subject + Action + Object` (e.g., `A rabbit eating a carrot`).
- **Returns:** An array of strings.

```javascript
import { generateGamePrompts } from './judge.js';

const prompts = await generateGamePrompts(process.env.GEMINI_API_KEY, 5);
// Output: ["Cat playing guitar", "Dog driving a bus", ...]
```

---

## Recommended Flow — Hybrid Logic

To optimize user experience and minimize API costs, implement the following hybrid logic in `server.js`:

```
Step 1 — Instant:      Call quickMatch().
                        If score > 0.8 → mark as correct, return result immediately.
                        Do NOT call the AI.

Step 2 — Intermediate: If quickMatch score is low → send a temporary result to the UI
                        with the flag isFinal: false.

Step 3 — Final:        Call getAiScore() to retrieve the accurate AI score.
                        Send the final result with the flag isFinal: true.
```

This approach ensures players get immediate feedback while AI scoring runs in the background for ambiguous guesses.

---

## Requirements

- **Node.js:** v20+
- **Environment:** A `.env` file must contain a valid `GEMINI_API_KEY`

### Install dependencies

```bash
npm install @google/generative-ai dotenv
```

---

## Notes

For questions about internal processing logic, refer to the comments in [`compare.js`](./compare.js).
