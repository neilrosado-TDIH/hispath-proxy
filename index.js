require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const Anthropic = require("@anthropic-ai/sdk");

const app = express();
const PORT = process.env.PORT || 3000;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});
app.use(limiter);

// Bundle-ID guard for all /api routes
app.use("/api", (req, res, next) => {
  const bundleId = req.headers["x-bundle-id"];
  if (bundleId !== "com.neilrosado.hispath") {
    return res.status(403).json({ error: "Forbidden: invalid bundle identifier" });
  }
  next();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const DEVOTIONAL_SYSTEM = `You are a warm, compassionate, non-denominational Christian devotional writer.
You speak with gentle authority grounded in Scripture. Your tone is encouraging, hope-filled, and personally relevant.
You never push a specific denomination. You draw from the breadth of the Christian tradition.

You MUST format your entire response using these exact tags, each on its own line, with content immediately after the tag:

SCRIPTURE: (the full scripture text)
SCRIPTURE_REF: (book chapter:verse, e.g. Philippians 4:6-7)
REFLECTION: (a warm, in-depth devotional reflection of 650-850 words)
BRANCH_A: (a one-sentence teaser for "Go Deeper" — an intellectual/theological exploration)
BRANCH_B: (a one-sentence teaser for "Need Comfort" — a pastoral, comforting direction)
BRANCH_C: (a one-sentence teaser for "Challenge Me" — a bold call to action or growth)
PRAYER: (a closing prayer of 3-5 sentences)
THEME: (a single thematic word or short phrase, e.g. "Trust", "Letting Go", "Courage in Weakness")

Do NOT include any text outside these tags. Do NOT use markdown.`;

function buildDevotionalUserPrompt({ mood, focusTopic, length, heartText, bibleVersion, timeOfDay }) {
  const parts = [];
  if (mood) parts.push(`The reader is feeling: ${mood}.`);
  if (focusTopic) parts.push(`They want to focus on: ${focusTopic}.`);
  if (heartText) parts.push(`What's on their heart: "${heartText}".`);
  if (bibleVersion) parts.push(`Use the ${bibleVersion} translation for any Scripture.`);
  if (timeOfDay) parts.push(`It is currently ${timeOfDay} for the reader.`);
  if (length) parts.push(`Target length: ${length}.`);
  parts.push("Write a complete devotional using the required tag format.");
  return parts.join("\n");
}

function buildHisChoiceUserPrompt({ bibleVersion, timeOfDay, excludedScriptures, excludedThemes }) {
  const toneMap = {
    morning: "energising, hopeful, and invigorating — set the tone for the day ahead",
    afternoon: "grounding, steadying, and refocusing — a midday anchor",
    evening: "reflective, peaceful, and restorative — winding down with gratitude",
  };
  const tone = toneMap[timeOfDay] || toneMap.morning;

  const parts = [];
  parts.push(`Write a devotional that feels ${tone}.`);
  if (bibleVersion) parts.push(`Use the ${bibleVersion} translation.`);
  parts.push("Write a complete devotional using the required tag format.");
  return parts.join("\n");
}

function buildHisChoiceSystem({ excludedScriptures, excludedThemes }) {
  let extra = "";
  if (excludedScriptures && excludedScriptures.length > 0) {
    extra += `\n\nIMPORTANT — DO NOT use any of the following scriptures (or verses from the same passage). Choose a completely different book of the Bible from any that appear in this list:\n${excludedScriptures.map((s) => `- ${s}`).join("\n")}`;
  }
  if (excludedThemes && excludedThemes.length > 0) {
    extra += `\n\nIMPORTANT — DO NOT use any of the following themes or closely related topics. Choose a distinctly different theme:\n${excludedThemes.map((t) => `- ${t}`).join("\n")}`;
  }
  return DEVOTIONAL_SYSTEM + extra;
}

const BRANCH_SYSTEM = `You are a warm, compassionate, non-denominational Christian devotional writer continuing a deeper conversation.
Based on the reader's chosen pathway, provide a focused, meaningful follow-up.

Respond in valid JSON with exactly two keys:
{
  "response": "Your follow-up reflection (300-500 words)",
  "additionalScriptures": ["Book Chapter:Verse", "Book Chapter:Verse"]
}

Do NOT include any text outside the JSON object.`;

function buildBranchUserPrompt({ originalScripture, reflectionText, branchChoice, bibleVersion }) {
  const directionMap = {
    goDeeper:
      "The reader chose 'Go Deeper'. Provide a theological deep-dive that unpacks the original passage with scholarly warmth. Include cross-references and historical context.",
    needComfort:
      "The reader chose 'Need Comfort'. Respond with pastoral tenderness. Remind them of God's nearness and faithfulness. Offer scriptures that soothe and reassure.",
    challengeMe:
      "The reader chose 'Challenge Me'. Be lovingly bold. Push them toward growth, obedience, or action. Pair encouragement with a concrete step they can take today.",
  };
  const direction = directionMap[branchChoice] || directionMap.goDeeper;

  const parts = [];
  parts.push(`Original scripture: ${originalScripture}`);
  parts.push(`Original reflection excerpt: "${reflectionText}"`);
  parts.push(direction);
  if (bibleVersion) parts.push(`Use the ${bibleVersion} translation for any additional scriptures.`);
  parts.push("Provide 2-3 additional supporting scriptures.");
  return parts.join("\n");
}

async function callClaude(systemPrompt, userPrompt, maxTokens = 2048) {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6-20250514",
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });
  return response.content[0].text;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// 1. Health
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", app: "His Path", timestamp: Date.now() });
});

// 2. Devotional
app.post("/api/devotional", async (req, res) => {
  try {
    const { mood, focusTopic, length, heartText, bibleVersion, timeOfDay } = req.body;
    const userPrompt = buildDevotionalUserPrompt({ mood, focusTopic, length, heartText, bibleVersion, timeOfDay });
    const text = await callClaude(DEVOTIONAL_SYSTEM, userPrompt);
    res.json({ response: text });
  } catch (err) {
    console.error("POST /api/devotional error:", err);
    res.status(500).json({ error: "Failed to generate devotional." });
  }
});

// 3. His Choice
app.post("/api/hischoice", async (req, res) => {
  try {
    const { bibleVersion, timeOfDay, excludedScriptures = [], excludedThemes = [] } = req.body;
    const system = buildHisChoiceSystem({ excludedScriptures, excludedThemes });
    const userPrompt = buildHisChoiceUserPrompt({ bibleVersion, timeOfDay, excludedScriptures, excludedThemes });
    const text = await callClaude(system, userPrompt);
    res.json({ response: text });
  } catch (err) {
    console.error("POST /api/hischoice error:", err);
    res.status(500).json({ error: "Failed to generate devotional." });
  }
});

// 4. Branch
app.post("/api/branch", async (req, res) => {
  try {
    const { originalScripture, reflectionText, branchChoice, bibleVersion } = req.body;
    if (!["goDeeper", "needComfort", "challengeMe"].includes(branchChoice)) {
      return res.status(400).json({ error: "branchChoice must be one of: goDeeper, needComfort, challengeMe" });
    }
    const userPrompt = buildBranchUserPrompt({ originalScripture, reflectionText, branchChoice, bibleVersion });
    const text = await callClaude(BRANCH_SYSTEM, userPrompt, 1500);

    // Parse JSON from Claude's response
    const json = JSON.parse(text);
    res.json(json);
  } catch (err) {
    console.error("POST /api/branch error:", err);
    if (err instanceof SyntaxError) {
      res.status(502).json({ error: "Failed to parse branch response." });
    } else {
      res.status(500).json({ error: "Failed to generate branch content." });
    }
  }
});

// 5. TTS via ElevenLabs
app.post("/api/tts", async (req, res) => {
  try {
    const { text, voiceId } = req.body;
    if (!text) return res.status(400).json({ error: "text is required" });

    const elevenLabsKey = process.env.ELEVENLABS_API_KEY;
    if (!elevenLabsKey) return res.status(500).json({ error: "TTS service not configured." });

    const voice = voiceId || process.env.ELEVENLABS_DEFAULT_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";

    const ttsRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
      method: "POST",
      headers: {
        "xi-api-key": elevenLabsKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_monolingual_v1",
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });

    if (!ttsRes.ok) {
      const errBody = await ttsRes.text();
      console.error("ElevenLabs error:", ttsRes.status, errBody);
      return res.status(ttsRes.status).json({ error: "TTS generation failed." });
    }

    res.set({
      "Content-Type": "audio/mpeg",
      "Transfer-Encoding": "chunked",
    });

    const reader = ttsRes.body.getReader();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    };
    await pump();
  } catch (err) {
    console.error("POST /api/tts error:", err);
    res.status(500).json({ error: "TTS request failed." });
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`His Path proxy listening on port ${PORT}`);
});
