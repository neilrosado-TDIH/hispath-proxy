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

Do NOT include any text outside these tags. Do NOT use markdown.

Every devotional you generate must feel completely fresh and unique. Never repeat the same opening sentence, illustration, metaphor, or story structure. Draw from the full breadth of Scripture - all 66 books. Vary your writing style: sometimes pastoral, sometimes prophetic, sometimes conversational, sometimes poetic. Use different human experiences, seasons of life, and emotional entry points each time. If the user selects the same mood and topic multiple times, approach it from a completely different angle every time.

Important: Do not use em dashes (—) anywhere in your response. Use regular hyphens (-) or restructure sentences instead. Do not use en dashes (–) either.`;

const DEVOTIONAL_ANGLES = [
  "through the lens of a specific Bible character who faced this",
  "using a nature metaphor",
  "through the lens of a parent and child",
  "using a journey/travel metaphor",
  "through the lens of an artist or craftsman",
  "using a farming/harvest metaphor",
  "through the lens of a soldier",
  "using a light and darkness metaphor",
  "through the lens of healing and medicine",
  "using a building/architecture metaphor",
  "through the lens of music",
  "using a weather metaphor",
  "through the lens of a specific Old Testament story",
  "using a New Testament parable",
  "through the lens of community and belonging",
  "through the lens of waiting and patience",
  "using a water/ocean metaphor",
  "through the lens of a shepherd and flock",
  "using a fire/refining metaphor",
  "through the lens of restoration and renewal",
];

function getRandomAngle() {
  return DEVOTIONAL_ANGLES[Math.floor(Math.random() * DEVOTIONAL_ANGLES.length)];
}

function buildDevotionalUserPrompt({ mood, focusTopic, length, heartText, bibleVersion, timeOfDay, excludedScriptures }) {
  const parts = [];
  if (mood) parts.push(`The reader is feeling: ${mood}.`);
  if (focusTopic) parts.push(`They want to focus on: ${focusTopic}.`);
  if (heartText) parts.push(`What's on their heart: "${heartText}".`);
  if (bibleVersion) parts.push(`Use the ${bibleVersion} translation for any Scripture.`);
  if (timeOfDay) parts.push(`It is currently ${timeOfDay} for the reader.`);
  if (length) parts.push(`Target length: ${length}.`);
  if (excludedScriptures && excludedScriptures.length > 0) {
    parts.push(`\nIMPORTANT: Do not use any of these scripture references that have already been used recently: ${excludedScriptures.join(', ')}. Choose a completely different passage.`);
  }
  parts.push(`Unique seed: ${Date.now()}`);
  parts.push(`Approach this devotional ${getRandomAngle()}.`);
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
  parts.push(`Unique seed: ${Date.now()}`);
  parts.push(`Approach this devotional ${getRandomAngle()}.`);
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

Do NOT include any text outside the JSON object.

Important: Do not use em dashes (—) anywhere in your response. Use regular hyphens (-) or restructure sentences instead. Do not use en dashes (–) either.

If you don't have full context about the original devotional, proceed graciously with the scripture reference provided. Never make the user feel like something went wrong. Always respond with warmth, encouragement, and depth. Never reference any technical issues or missing context.`;

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
    model: "claude-sonnet-4-6",
    max_tokens: maxTokens,
    temperature: 1.0,
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
    const { mood, focusTopic, length, heartText, bibleVersion, timeOfDay, excludedScriptures } = req.body;
    const userPrompt = buildDevotionalUserPrompt({ mood, focusTopic, length, heartText, bibleVersion, timeOfDay, excludedScriptures });
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

    console.log("POST /api/branch raw Claude response:", text);

    // Try to extract JSON from the response — Claude may wrap it in markdown fences
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (_e) {
      // Try extracting JSON from markdown code fences
      const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) {
        try {
          parsed = JSON.parse(fenceMatch[1].trim());
        } catch (_e2) {
          console.error("POST /api/branch failed to parse fenced JSON:", fenceMatch[1]);
        }
      }
    }

    // If we successfully parsed JSON, normalise and return it
    if (parsed && typeof parsed === "object") {
      res.json({
        response: parsed.response || "",
        additionalScriptures: Array.isArray(parsed.additionalScriptures) ? parsed.additionalScriptures : [],
      });
    } else {
      // Fallback: return raw text as the response
      console.warn("POST /api/branch returning raw text fallback");
      res.json({ response: text, additionalScriptures: [] });
    }
  } catch (err) {
    console.error("POST /api/branch error:", err.message, err.stack);
    res.status(500).json({ error: "Failed to generate branch content." });
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
