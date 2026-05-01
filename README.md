# judge.js — Scoring Logic for Drawing Game

A lightweight scoring module for a word-guessing/drawing game, powered by Gemini 2.0 Flash Lite.

## Functions

### `compareGuesses(guess, target, apiKey)`

Compares the player's guess against the target phrase and returns a similarity score between `0.1` and `1.0`.

Runs a fast keyword match first. If the result is uncertain, it falls back to Gemini for semantic analysis (e.g. recognizing that `"spaceship"` and `"rocket"` are equivalent).

```javascript
import { compareGuesses } from './judge.js';

const result = await compareGuesses("rocket", "spaceship", process.env.GEMINI_API_KEY);
console.log(result.score); // ~0.9
```

---

### `generateGamePrompts(apiKey, count)`

Generates a list of random English drawing prompts in `Subject + Action + Object` format.

```javascript
import { generateGamePrompts } from './judge.js';

const prompts = await generateGamePrompts(process.env.GEMINI_API_KEY, 5);
// ["Cat riding a rocket", "Dog wearing a hat", ...]
```

---

## Setup

```bash
npm install @google/generative-ai dotenv
```

Add your API key to a `.env` file:

```
GEMINI_API_KEY=your_key_here
```
