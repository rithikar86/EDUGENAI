const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const axios = require("axios");

const { MongoClient, ObjectId } = require("mongodb");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { fetchTranscript } = require("youtube-transcript");

const officeParser = require("officeparser");
const { PDFParse } = require("pdf-parse");

const Groq = require("groq-sdk");
const nodemailer = require("nodemailer");
const crypto = require("crypto");

dotenv.config({ path: path.resolve(__dirname, ".env") });

const app = express();

// ======================================================
// MIDDLEWARE
// ======================================================

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

app.use(
  express.json({
    limit: "30mb",
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: "30mb",
  })
);

// ======================================================
// CONFIG
// ======================================================

const PORT =
  process.env.PORT || 5000;

const MONGODB_URI =
  process.env.MONGODB_URI;

const JWT_SECRET =
  process.env.JWT_SECRET;

const GROQ_API_KEY =
  process.env.GROQ_API_KEY;

const GROQ_MODEL =
  process.env.GROQ_MODEL || "openai/gpt-oss-120b";

// ======================================================
// GROQ
// ======================================================

if (!GROQ_API_KEY) {
  console.warn(
    "WARNING: GROQ_API_KEY is missing in .env"
  );
}

const groq =
  new Groq({
    apiKey: GROQ_API_KEY,
  });

// ======================================================
// MONGODB
// ======================================================

let db;
let mongoClient;

async function connectDatabase() {

  if (!MONGODB_URI) {
    throw new Error(
      "MONGODB_URI is missing in .env"
    );
  }

  if (!JWT_SECRET) {
    throw new Error(
      "JWT_SECRET is missing in .env"
    );
  }

  mongoClient =
    new MongoClient(
      MONGODB_URI,
      {
        family: 4,

        serverSelectionTimeoutMS:
          30000,

        connectTimeoutMS:
          30000,
      }
    );

  await mongoClient.connect();

  db =
    mongoClient.db();

  console.log(
    "MongoDB connected successfully"
  );

  // Ensure partial unique index for standard notes per user and material
  db.collection("notes").createIndex(
    { userId: 1, materialId: 1 },
    {
      unique: true,
      partialFilterExpression: {
        type: { $in: ["smart-notes", "youtube-notes", "standard"] }
      },
      name: "uniq_user_material_standard_note"
    }
  ).catch(err => console.warn("Standard notes unique index notice:", err.message));
}

// ======================================================
// UPLOAD FOLDER
// ======================================================

const uploadsDir =
  path.join(
    __dirname,
    "uploads"
  );

if (
  !fs.existsSync(
    uploadsDir
  )
) {
  fs.mkdirSync(
    uploadsDir,
    {
      recursive: true,
    }
  );
}

// ======================================================
// MULTER STORAGE
// ======================================================

const storage =
  multer.diskStorage({

    destination:
      function (
        req,
        file,
        cb
      ) {
        cb(
          null,
          uploadsDir
        );
      },

    filename:
      function (
        req,
        file,
        cb
      ) {

        const ext =
          path.extname(
            file.originalname
          );

        const safeName =
          path
            .basename(
              file.originalname,
              ext
            )
            .replace(
              /[^a-zA-Z0-9-_]/g,
              "_"
            )
            .substring(
              0,
              80
            ) ||
          "material";

        cb(
          null,
          `${Date.now()}-${safeName}${ext}`
        );
      },
  });

// ======================================================
// MULTER
// ======================================================

const upload =
  multer({

    storage,

    limits: {
      fileSize:
        10 * 1024 * 1024,
    },

    fileFilter:
      function (
        req,
        file,
        cb
      ) {

        const allowed = [
          ".pdf",
          ".doc",
          ".docx",
          ".ppt",
          ".pptx",
          ".txt",
        ];

        const ext =
          path
            .extname(
              file.originalname
            )
            .toLowerCase();

        if (
          allowed.includes(
            ext
          )
        ) {
          cb(
            null,
            true
          );
        } else {
          cb(
            new Error(
              "Only PDF, DOC, DOCX, PPT, PPTX and TXT files are allowed."
            )
          );
        }
      },
  });

// ======================================================
// AUTHENTICATION
// ======================================================

function authenticateToken(
  req,
  res,
  next
) {

  const authHeader =
    req.headers[
      "authorization"
    ];

  const token =
    authHeader &&
    authHeader.split(
      " "
    )[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message:
        "Access denied. Please login.",
    });
  }

  try {

    const decoded =
      jwt.verify(
        token,
        JWT_SECRET
      );

    req.user =
      decoded;

    next();

  } catch (error) {

    return res.status(403).json({
      success: false,
      message:
        "Invalid or expired login session.",
    });
  }
}

// ======================================================
// HOME / HEALTH CHECK
// ======================================================

app.get(
  "/",
  (req, res) => {

    res.json({

      success: true,

      message:
        "AI-Powered Smart Learning Assistant API is running",

      ai:
        GROQ_MODEL,

      provider:
        "Groq",

    });
  }
);
// ======================================================
// FILE TEXT EXTRACTION
// ======================================================

async function extractTextFromFile(filePath, originalName) {

  const ext =
    path
      .extname(originalName)
      .toLowerCase();

  // ----------------------------------------------------
  // TXT
  // ----------------------------------------------------

  if (ext === ".txt") {

    return fs.readFileSync(
      filePath,
      "utf8"
    );
  }

  // ----------------------------------------------------
  // PDF
  // ----------------------------------------------------

  if (ext === ".pdf") {

    const buffer =
      fs.readFileSync(
        filePath
      );

    const parser =
      new PDFParse({
        data: buffer,
      });

    const result =
      await parser.getText();

    try {
      await parser.destroy();
    } catch (e) {
      // ignore cleanup error
    }

    return result.text || "";
  }

  // ----------------------------------------------------
  // HELPER: extract plain text from officeParser result
  // officeParser v7+ returns a rich object with .toText()
  // instead of a plain string. Handle both old and new API.
  // ----------------------------------------------------

  function extractOfficeParserText(result) {
    if (!result) return "";
    // v7+ object with .toText() method
    if (typeof result.toText === "function") {
      return result.toText() || "";
    }
    // Plain string (older versions)
    if (typeof result === "string") return result;
    // Object with a .content string field
    if (result.content && typeof result.content === "string") {
      return result.content;
    }
    // Last resort — but this will likely give [object Object]
    return "";
  }

  // ----------------------------------------------------
  // DOCX / PPTX
  // ----------------------------------------------------

  if (
    ext === ".docx" ||
    ext === ".pptx"
  ) {
    try {
      const result =
        await officeParser.parseOffice(
          filePath
        );

      const text = extractOfficeParserText(result);

      if (text && text.trim().length > 0) {
        return text;
      }

      throw new Error(`officeParser returned empty content for ${ext.toUpperCase()} file.`);
    } catch (e) {
      console.error(`officeParser failed for ${ext}:`, e.message);
      throw new Error(
        `Could not extract text from ${ext.toUpperCase()} file. The file may be corrupted, image-only, or password-protected.`
      );
    }
  }

  // ----------------------------------------------------
  // DOC / PPT
  // ----------------------------------------------------

  if (
    ext === ".doc" ||
    ext === ".ppt"
  ) {
    try {
      const result = await officeParser.parseOffice(filePath);
      const text = extractOfficeParserText(result);
      if (text && text.trim().length > 20) {
        return text;
      }
    } catch (e) {
      console.warn(`officeParser failed for binary ${ext}, attempting string extraction fallback:`, e.message);
    }

    try {
      const buffer = fs.readFileSync(filePath);
      const str = buffer.toString("latin1");
      const matches = str.match(/[\x20-\x7E\t\r\n]{4,}/g);
      if (matches && matches.length > 0) {
        return matches.join(" ").trim();
      }
    } catch (err) {
      console.error(`Binary extraction fallback failed for ${ext}:`, err);
    }

    throw new Error(
      `Could not extract text from ${ext.toUpperCase()} file. Please convert to DOCX or PPTX.`
    );
  }

  throw new Error(
    "Unsupported file format."
  );
}

// ======================================================
// CLEAN EXTRACTED TEXT
// ======================================================

function cleanExtractedText(
  text
) {

  if (!text) {
    return "";
  }

  let cleaned =
    String(text);

  // Remove null characters
  cleaned =
    cleaned.replace(
      /\u0000/g,
      " "
    );

  // Normalize line endings
  cleaned =
    cleaned.replace(
      /\r\n/g,
      "\n"
    );

  cleaned =
    cleaned.replace(
      /\r/g,
      "\n"
    );

  // Remove excessive spaces
  cleaned =
    cleaned.replace(
      /[ \t]+/g,
      " "
    );

  // Remove too many blank lines
  cleaned =
    cleaned.replace(
      /\n{3,}/g,
      "\n\n"
    );

  // Remove repeated page markers
  cleaned =
    cleaned.replace(
      /(?:page\s*)?\d+\s*(?:of\s*\d+)?/gi,
      function (match) {

        if (
          match.length <
          15
        ) {
          return " ";
        }

        return match;
      }
    );

  return cleaned
    .trim();
}

// ======================================================
// SELECT RELEVANT CONTENT FOR QUIZ (PDF, PPT, DOC, YOUTUBE)
// ======================================================

function selectRelevantContentForQuiz(rawText, options = {}) {
  const { topic = "", subtopic = "", maxChars = 3800 } = options;
  if (!rawText || !String(rawText).trim()) return "";

  // 1. Safe text preprocessing: strip timecodes, slide markers, artifacts
  let cleaned = String(rawText)
    .replace(/\u0000/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    // Remove YouTube VTT / SRT timecodes (e.g. 00:01:23.000 --> 00:01:25.000 or 00:15)
    .replace(/\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{3})?\s*-->\s*\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{3})?/g, " ")
    .replace(/\[\d{1,2}:\d{2}(?::\d{2})?\]/g, " ")
    .replace(/^\s*\d{1,2}:\d{2}\s*$/gm, " ")
    // Remove transcript noise like [Music], [Applause], (laughter)
    .replace(/\[(?:music|applause|laughter|inaudible)\]/gi, " ")
    .replace(/\((?:music|applause|laughter|inaudible)\)/gi, " ")
    // Remove PPT slide markers and page numbers
    .replace(/^(?:slide|page)\s*\d+(?:\s*(?:of|\/)\s*\d+)?\s*:?/gim, " ")
    // Collapse excessive whitespace and line breaks
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!cleaned) return "";

  // If already under token budget, return directly
  if (cleaned.length <= maxChars) {
    return cleaned;
  }

  const cleanTopic = String(topic || "").trim().toLowerCase();
  const cleanSubtopic = String(subtopic || "").trim().toLowerCase();
  const hasTargetTopic = Boolean(cleanTopic || cleanSubtopic);

  // Split into coherent logical blocks/paragraphs
  const paragraphs = cleaned
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 25);

  if (paragraphs.length === 0) {
    return cleaned.substring(0, maxChars);
  }

  // CASE 1: Topic or Subtopic specified (Revision Plan Practice Quiz)
  if (hasTargetTopic) {
    const topicKeywords = cleanTopic.split(/\s+/).filter((k) => k.length >= 2);
    const subtopicKeywords = cleanSubtopic.split(/\s+/).filter((k) => k.length >= 2);
    const allKeywords = Array.from(new Set([...topicKeywords, ...subtopicKeywords]));

    const scoredParagraphs = paragraphs.map((para, idx) => {
      const lower = para.toLowerCase();
      let score = 0;

      // Exact phrase match gives highest weight
      if (cleanSubtopic && lower.includes(cleanSubtopic)) score += 15;
      if (cleanTopic && lower.includes(cleanTopic)) score += 10;

      // Keyword matches
      for (const kw of allKeywords) {
        if (lower.includes(kw)) score += 3;
      }

      // Heading boost
      if (/^#{1,4}\s+/m.test(para) && score > 0) score += 4;

      return { para, idx, score };
    });

    const matching = scoredParagraphs.filter((sp) => sp.score > 0);

    if (matching.length > 0) {
      // Sort by score descending to get highest-relevance excerpts
      matching.sort((a, b) => b.score - a.score);

      const chosenIndices = new Set();
      let totalLength = 0;

      for (const item of matching) {
        if (totalLength + item.para.length > maxChars && chosenIndices.size > 0) {
          break;
        }
        chosenIndices.add(item.idx);
        totalLength += item.para.length;

        // Include immediate next paragraph for context continuity if budget allows
        if (item.idx + 1 < paragraphs.length && totalLength + paragraphs[item.idx + 1].length < maxChars) {
          chosenIndices.add(item.idx + 1);
          totalLength += paragraphs[item.idx + 1].length;
        }
      }

      // Re-order chosen paragraphs into sequential reading order
      const ordered = Array.from(chosenIndices)
        .sort((a, b) => a - b)
        .map((i) => paragraphs[i]);

      const result = ordered.join("\n\n");
      return result.substring(0, maxChars);
    }
  }

  // CASE 2: General Quiz (no specific topic) - Intelligently sample across entire document
  // Evenly distribute sampling from beginning, middle, and end so the quiz covers the entire material
  const totalParas = paragraphs.length;
  if (totalParas <= 6) {
    return paragraphs.join("\n\n").substring(0, maxChars);
  }

  const selectedParas = [];
  let currentLen = 0;
  const stride = Math.max(1, Math.floor(totalParas / 10));

  for (let i = 0; i < totalParas; i += stride) {
    const p = paragraphs[i];
    if (currentLen + p.length > maxChars) {
      if (selectedParas.length === 0) {
        selectedParas.push(p.substring(0, maxChars));
      }
      break;
    }
    selectedParas.push(p);
    currentLen += p.length + 2;
  }

  return selectedParas.join("\n\n").substring(0, maxChars);
}

// ======================================================
// PREPARE TEXT FOR AI
// ======================================================

function prepareTextForAI(
  text,
  maxChars = 120000
) {

  const cleaned =
    cleanExtractedText(
      text
    );

  if (
    cleaned.length <=
    maxChars
  ) {
    return cleaned;
  }

  return cleaned.substring(
    0,
    maxChars
  );
}

// ======================================================
// CHUNK TEXT
// ======================================================

function chunkText(
  text,
  chunkSize = 9000,
  overlap = 500
) {

  const cleaned =
    cleanExtractedText(
      text
    );

  if (!cleaned) {
    return [];
  }

  const chunks = [];

  let start = 0;

  while (
    start <
    cleaned.length
  ) {

    const end =
      Math.min(
        start +
          chunkSize,
        cleaned.length
      );

    const chunk =
      cleaned
        .slice(
          start,
          end
        )
        .trim();

    if (chunk) {
      chunks.push(
        chunk
      );
    }

    if (
      end >=
      cleaned.length
    ) {
      break;
    }

    start =
      end - overlap;

    if (
      start < 0
    ) {
      start = 0;
    }
  }

  return chunks;
}

// ======================================================
// GROQ AI FUNCTION
// ======================================================

async function generateWithGroq(
  systemPrompt,
  userPrompt,
  maxTokens = 3500,
  temperature = 0.5,
  useJsonMode = false
) {
  if (!GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is missing in .env");
  }

  // Token Safety Guard: Truncate prompt if text is too large for single request
  const MAX_INPUT_CHARS = 10000;
  let safeUserPrompt = String(userPrompt || "");
  if (safeUserPrompt.length > MAX_INPUT_CHARS) {
    console.warn(`[Groq Safety Guard] Input prompt length (${safeUserPrompt.length} chars) exceeds safety limit. Truncating to ${MAX_INPUT_CHARS} chars.`);
    safeUserPrompt = safeUserPrompt.substring(0, MAX_INPUT_CHARS) + "\n\n[Content truncated for token safety...]";
  }

  // List candidate models in order of priority (ensuring reliable JSON output and high rate limit availability)
  const candidateModels = [
    GROQ_MODEL,
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
    "allam-2-7b",
    "qwen/qwen3.8-27b",
  ].filter((m, idx, arr) => m && arr.indexOf(m) === idx);

  let lastError = null;

  for (const modelName of candidateModels) {
    try {
      let effectiveMaxTokens = Number(maxTokens) || 3500;
      // Model-specific token limit protections:
      // qwen on-demand has a strict 1000 Output Tokens Per Minute (OTPM) limit
      if (modelName.includes("qwen")) {
        effectiveMaxTokens = Math.min(effectiveMaxTokens, 950);
      } else if (modelName.includes("gpt-oss-20b")) {
        // gpt-oss-20b TPM limit protection
        effectiveMaxTokens = Math.min(Math.max(effectiveMaxTokens, 1500), 2500);
      } else {
        effectiveMaxTokens = Math.min(Math.max(effectiveMaxTokens, 1500), 4000);
      }

      const effectiveTemperature = typeof temperature === "number" ? Math.max(0.1, Math.min(temperature, 1.0)) : 0.5;

      const completionParams = {
        model: modelName,
        temperature: effectiveTemperature,
        max_tokens: effectiveMaxTokens,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: safeUserPrompt },
        ],
      };

      if (useJsonMode) {
        completionParams.response_format = { type: "json_object" };
      }

      console.log(`[Groq API] Sending request to model: ${modelName} (maxTokens: ${effectiveMaxTokens}, jsonMode: ${Boolean(useJsonMode)})`);
      const completion = await groq.chat.completions.create(completionParams);

      const choice = completion?.choices?.[0];
      const finishReason = choice?.finish_reason;
      const content = choice?.message?.content;

      // If response was cut off mid-output due to length limit, treat as failure and try next model
      if (finishReason === "length") {
        console.warn(`[Groq Warning] Model ${modelName} output was truncated (finish_reason: length). Trying next candidate model...`);
        lastError = new Error(`Model ${modelName} response truncated due to output length limit.`);
        continue;
      }

      if (content && content.trim().length > 0) {
        console.log(`[Groq API] Success from ${modelName} (Length: ${content.trim().length} chars, Finish: ${finishReason || "stop"})`);
        return content.trim();
      }

      console.warn(`[Groq Warning] Model ${modelName} returned empty content (finish_reason: ${finishReason}). Retrying with next model...`);
    } catch (err) {
      console.warn(`[Groq Warning] Model ${modelName} request failed: ${err.message}. Retrying with next model...`);
      // If error was caused by response_format unsupported or JSON validation rejection, retry without it for this model
      if (useJsonMode && (err.message.includes("response_format") || err.message.includes("json_object") || err.message.includes("json_validate_failed") || err.message.includes("Failed to validate JSON"))) {
        try {
          console.log(`[Groq API] Retrying model ${modelName} without response_format...`);
          const fallbackCompletion = await groq.chat.completions.create({
            model: modelName,
            temperature: 0.4,
            max_tokens: Math.min(maxTokens || 3000, 3000),
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: safeUserPrompt },
            ],
          });
          const fbContent = fallbackCompletion?.choices?.[0]?.message?.content;
          if (fbContent && fbContent.trim().length > 0) {
            return fbContent.trim();
          }
        } catch (fbErr) {
          console.warn(`[Groq Warning] Non-JSON fallback for ${modelName} also failed: ${fbErr.message}`);
        }
      }
      lastError = err;
    }
  }

  throw new Error(lastError ? lastError.message : "Groq returned an empty response across all model attempts.");
}

// ======================================================
// REMOVE MARKDOWN CODE FENCES
// ======================================================

function removeCodeFences(text) {
  if (!text) {
    return "";
  }

  let str = String(text).trim();
  str = str.replace(/^```(?:json|markdown|md|text)?\s*/i, "");
  str = str.replace(/\s*```$/i, "");
  return str.trim();
}

// ======================================================
// PARSE AI JSON
// ======================================================

function parseAIJson(text) {
  if (!text || typeof text !== "string") {
    throw new Error("AI returned empty or non-string response.");
  }

  const cleaned = removeCodeFences(text);

  // 1. Direct JSON.parse
  try {
    return JSON.parse(cleaned);
  } catch (directErr) {
    // 2. Extract outermost JSON object { ... }
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const candidate = cleaned.substring(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(candidate);
      } catch (objErr) {
        // try array extraction
      }
    }

    // 3. Extract outermost JSON array [ ... ]
    const firstBracket = cleaned.indexOf("[");
    const lastBracket = cleaned.lastIndexOf("]");
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      const candidate = cleaned.substring(firstBracket, lastBracket + 1);
      try {
        return JSON.parse(candidate);
      } catch (arrErr) {
        // failed
      }
    }

    console.error(`[parseAIJson Error] JSON parse failure: ${directErr.message}. Content preview: ${cleaned.substring(0, 200)}...`);
    throw new Error(`AI returned invalid JSON: ${directErr.message}`);
  }
}

// ======================================================
// VALIDATE & FORMAT QUIZ QUESTIONS (ROBUST SCHEMA NORMALIZATION)
// ======================================================

function validateAndFormatQuizQuestions(
  parsed,
  targetCount = 10,
  defaultTopic = "Core Concepts",
  difficultyLabel = "Intermediate",
  materialId = ""
) {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("AI response could not be parsed into a valid JSON object.");
  }

  let rawList = Array.isArray(parsed.questions)
    ? parsed.questions
    : Array.isArray(parsed)
    ? parsed
    : null;

  if (!rawList || rawList.length === 0) {
    throw new Error("AI response JSON does not contain a 'questions' array.");
  }

  const validated = [];
  const seenNormalized = new Set();

  for (let i = 0; i < rawList.length; i++) {
    const q = rawList[i];
    if (!q || typeof q !== "object") continue;

    // 1. Question text validation
    const rawQuestionText = String(q.question || q.questionText || q.text || "").trim();
    if (!rawQuestionText || rawQuestionText.length < 8) {
      continue;
    }

    const normQ = rawQuestionText.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (seenNormalized.has(normQ)) {
      continue;
    }

    // 2. Options validation (supports both object { A: "...", B: "...", C: "...", D: "..." } and array ["...", "...", "...", "..."])
    let cleanedOptions = [];
    if (Array.isArray(q.options)) {
      cleanedOptions = q.options.map((opt) => String(opt || "").trim()).filter(Boolean);
    } else if (q.options && typeof q.options === "object") {
      const keys = ["A", "B", "C", "D"];
      const hasLetterKeys = keys.some((k) => q.options[k] !== undefined || q.options[k.toLowerCase()] !== undefined);
      if (hasLetterKeys) {
        cleanedOptions = keys.map((k) => String(q.options[k] || q.options[k.toLowerCase()] || "").trim()).filter(Boolean);
      } else {
        cleanedOptions = Object.values(q.options).map((opt) => String(opt || "").trim()).filter(Boolean);
      }
    }

    if (cleanedOptions.length < 4) {
      continue;
    }
    if (cleanedOptions.length > 4) {
      cleanedOptions = cleanedOptions.slice(0, 4);
    }

    // 3. Answer index and correctAnswer letter validation
    let answerIndex = -1;
    const rawAns = q.correctAnswer ?? q.answer ?? q.correctOption ?? q.correct;

    if (typeof rawAns === "string") {
      const cleanAns = rawAns.trim().toUpperCase();
      if (cleanAns === "A") answerIndex = 0;
      else if (cleanAns === "B") answerIndex = 1;
      else if (cleanAns === "C") answerIndex = 2;
      else if (cleanAns === "D") answerIndex = 3;
      else if (!isNaN(Number(cleanAns))) answerIndex = Number(cleanAns);
      else {
        const foundIdx = cleanedOptions.findIndex(
          (opt) => opt.toLowerCase() === rawAns.trim().toLowerCase()
        );
        if (foundIdx >= 0) answerIndex = foundIdx;
      }
    } else if (Number.isInteger(rawAns)) {
      answerIndex = rawAns;
    }

    if (answerIndex < 0 || answerIndex > 3 || !Number.isInteger(answerIndex)) {
      answerIndex = 0; // safe default fallback
    }

    // 4. Topic and Subtopic resolution
    let rawTopic = String(q.topic || defaultTopic || "Core Concepts").trim();
    let rawSubtopic = String(q.subtopic || "").trim();

    // 5. Explanation
    let explanation = String(q.explanation || "").trim();
    if (!explanation) {
      explanation = `The correct answer is "${cleanedOptions[answerIndex]}" based on the study material.`;
    }

    seenNormalized.add(normQ);

    validated.push({
      question: rawQuestionText,
      options: cleanedOptions,
      answer: answerIndex,
      correctAnswer: ["A", "B", "C", "D"][answerIndex],
      topic: rawTopic,
      subtopic: rawSubtopic,
      difficulty: difficultyLabel,
      explanation,
      materialId: materialId || "",
    });

    if (validated.length >= targetCount) {
      break;
    }
  }

  return validated;
}

// ======================================================
// SMART NOTES SYSTEM PROMPT
// ======================================================

const SMART_NOTES_SYSTEM_PROMPT = `
You are an AI teacher and study assistant.

Your job is to convert the provided study material into
clear, useful, student-friendly study notes.

LANGUAGE RULE — CRITICAL:
- Generate ALL output in ENGLISH ONLY.
- The source material may contain Arabic, Tamil, Hindi, Malayalam, Telugu, or any other non-English language.
- You MUST understand the source content regardless of its language and write the entire Smart Note in English.
- Translate all non-English natural-language sentences into clear English.
- Do NOT reproduce any Arabic, Tamil, Hindi, or other non-English natural-language text in the output.
- Preserve all programming code exactly as-is (do not translate code syntax or keywords such as function, return, const, let, if, else, for, while, class, import, etc.).
- Keep technical identifiers, programming terms, formulas, and standard symbols unchanged (e.g. Python, JavaScript, HTML, CSS, SQL, API, HTTP, OpenCV, Variables, Functions, Parameters).
- Code comments that are in a non-English language should be translated into English comments.
- All headings must be in English (e.g. ## Functions, ## Definition, ## Example, ## Important Points, ## Exam Points).

CONTENT RULES:

1. Use ONLY the information available in the provided material.
2. Do not invent facts.
3. Do not add unrelated outside information.
4. Identify the actual topics and subtopics from the material.
5. Preserve the important technical terminology used in the material.
6. Explain difficult concepts in simple English.
7. Include definitions when they are available.
8. Include examples when they are available.
9. Include important points useful for exams.
10. Avoid unnecessary repetition.
11. Do NOT create headings such as:
   - Part 1
   - Part 2
   - Chunk 1
   - Chunk 2
   - Section 1
   - Section 2
12. Do NOT use Markdown tables.
13. Use proper Markdown headings and bullet points.
14. Keep the notes organized topic-wise and subtopic-wise.
15. Do not mention that you are an AI.
16. Do not mention the extraction process.
17. Do not mention chunks.
18. Make the notes easy for a college student to revise.
`;

// ======================================================
// CLEAN FINAL SMART NOTES
// ======================================================

function cleanFinalSmartNotes(
  notes
) {

  if (!notes) {
    return "";
  }

  let result =
    String(notes);

  // Remove code fences
  result =
    removeCodeFences(
      result
    );

  // Remove unwanted Part / Chunk headings
  result =
    result.replace(
      /^#+\s*(Part|Chunk|Section)\s*\d+.*$/gim,
      ""
    );

  // Remove markdown tables if accidentally generated
  const lines =
    result.split("\n");

  const cleanedLines = [];

  let insideTable =
    false;

  for (
    const line of lines
  ) {

    const trimmed =
      line.trim();

    if (
      trimmed.startsWith("|")
    ) {

      insideTable =
        true;

      continue;
    }

    if (
      insideTable &&
      trimmed === ""
    ) {

      insideTable =
        false;

      continue;
    }

    if (
      insideTable
    ) {
      continue;
    }

    cleanedLines.push(
      line
    );
  }

  result =
    cleanedLines.join(
      "\n"
    );

  // Remove excessive blank lines
  result =
    result.replace(
      /\n{3,}/g,
      "\n\n"
    );

  return result.trim();
}

// ======================================================
// ENFORCE ENGLISH OUTPUT (LANGUAGE VALIDATION)
// ======================================================

/**
 * Detects significant non-English natural-language content in AI-generated notes
 * and makes one silent corrective AI call to translate it into English.
 * Preserves code blocks, technical identifiers, and standard symbols unchanged.
 */
async function enforceEnglishOutput(notes) {
  if (!notes || !notes.trim()) return notes;

  // Count non-ASCII word characters (covers Arabic, Hindi, Tamil, etc.)
  // Code blocks are inside ``` fences — we skip those for the count
  const withoutCodeBlocks = notes.replace(/```[\s\S]*?```/g, "");
  const totalWordChars = (withoutCodeBlocks.match(/\w/g) || []).length;
  const nonAsciiChars = (withoutCodeBlocks.match(/[^\x00-\x7F]/g) || []).length;

  // If non-ASCII chars are >= 8% of all word chars, trigger correction
  const ratio = totalWordChars > 0 ? nonAsciiChars / totalWordChars : 0;

  if (ratio < 0.08) {
    return notes; // Already mostly English — skip correction
  }

  console.log(`[Language Validator] Non-ASCII ratio: ${(ratio * 100).toFixed(1)}% — triggering English correction pass.`);

  try {
    const correctionSystemPrompt = `You are a language correction assistant.
Your ONLY job is to translate any non-English natural-language text in the provided notes into English.

STRICT RULES:
- Translate all Arabic, Tamil, Hindi, Malayalam, Telugu, or any other non-English natural-language sentences into clear English.
- Do NOT change or translate programming code. Preserve all code blocks exactly as-is.
- Do NOT change technical identifiers, programming keywords, or standard symbols.
- Do NOT add, remove, or invent new information.
- Preserve all Markdown headings, bullet points, and structure exactly.
- Return the corrected notes and nothing else.`;

    const correctionPrompt = `Translate all non-English natural-language text in the notes below into English. Keep all code blocks and technical terms unchanged.

NOTES TO CORRECT:
${notes}`;

    const corrected = await generateWithGroq(correctionSystemPrompt, correctionPrompt, 3000);
    if (corrected && corrected.trim()) {
      console.log("[Language Validator] English correction applied successfully.");
      return cleanFinalSmartNotes(corrected);
    }
  } catch (err) {
    console.warn("[Language Validator] Correction pass failed, returning original:", err.message);
  }

  return notes;
}

// ======================================================
// GENERATE SMART NOTES FROM MATERIAL
// ======================================================

async function generateSmartNotes(materialText) {
  const cleanedText = cleanExtractedText(materialText);

  if (!cleanedText) {
    throw new Error(
      "No readable text was found in the uploaded material."
    );
  }

  // If short text (<= 4500 chars), process directly in a single request
  if (cleanedText.length <= 4500) {
    const prompt = `Create complete study notes from the following educational material.

LANGUAGE INSTRUCTION: Generate the final notes in English only. The source material may contain multiple languages (e.g. Arabic, Tamil, Hindi). Translate all non-English natural-language content into English while preserving the original meaning. Do not output Arabic, Tamil, Hindi, or other non-English natural-language sentences. Keep programming code and technical syntax unchanged.

Requirements:
- Identify the actual topics and subtopics
- Explain concepts simply for students
- Include definitions, key concepts, examples, and exam points
- Avoid Part 1, Part 2, Chunk 1, Chunk 2 headings
- Avoid "General Topic" when source contains real topics
- Avoid Markdown tables

MATERIAL:
${cleanedText}`;

    const notes = await generateWithGroq(
      SMART_NOTES_SYSTEM_PROMPT,
      prompt,
      2000
    );

    return enforceEnglishOutput(cleanFinalSmartNotes(notes));
  }

  // Chunked Generation for larger materials to safely stay below 8000 TPM limit
  // Chunk size = 3500 chars (~900 tokens) per chunk
  const chunks = chunkText(cleanedText, 3500, 300);
  const MAX_CHUNKS = Math.min(chunks.length, 10);
  const selectedChunks = chunks.slice(0, MAX_CHUNKS);

  console.log(`[Token Safe Smart Notes] Split ${cleanedText.length} chars into ${selectedChunks.length} safe chunks.`);

  const chunkNotes = [];

  for (let i = 0; i < selectedChunks.length; i++) {
    const chunkContent = selectedChunks[i];
    const chunkPrompt = `Generate study notes from this section of educational material.

LANGUAGE INSTRUCTION: Generate the final notes in English only. The source material may contain multiple languages (e.g. Arabic, Tamil, Hindi). Translate all non-English natural-language content into English. Do not output Arabic, Tamil, Hindi, or other non-English natural-language sentences. Keep programming code and technical syntax unchanged.

Rules:
- Identify real topics and subtopics from this section
- Explain concepts simply
- Include key definitions, examples, and exam points
- Do NOT use headings like Part ${i + 1}, Chunk ${i + 1}, or Section ${i + 1}
- Avoid Markdown tables

SECTION TEXT:
${chunkContent}`;

    try {
      const notesPart = await generateWithGroq(
        SMART_NOTES_SYSTEM_PROMPT,
        chunkPrompt,
        1500
      );

      if (notesPart && notesPart.trim()) {
        chunkNotes.push(notesPart.trim());
      }
    } catch (err) {
      console.warn(`[Token Safe Smart Notes] Chunk ${i + 1} processing warning:`, err.message);
    }
  }

  if (chunkNotes.length === 0) {
    throw new Error("Unable to generate notes from text chunks.");
  }

  const rawCombined = chunkNotes.join("\n\n---\n\n");

  // If combined notes length is manageable (< 6500 chars), consolidate cleanly
  if (rawCombined.length <= 6500) {
    try {
      const mergePrompt = `Combine these section notes into one clean, well-structured Smart Notes document.

LANGUAGE INSTRUCTION: The final output must be in English only. If any section notes contain non-English natural-language text, translate it into English. Keep programming code and technical syntax unchanged.

Rules:
- Merge duplicate topics and remove repeated points
- Preserve all definitions, examples, and exam points
- Do NOT create Part 1, Part 2, Chunk 1, Chunk 2 headings
- Avoid Markdown tables

SECTION NOTES:
${rawCombined}`;

      const consolidated = await generateWithGroq(
        SMART_NOTES_SYSTEM_PROMPT,
        mergePrompt,
        2500
      );

      return enforceEnglishOutput(cleanFinalSmartNotes(consolidated));
    } catch (err) {
      console.log("[Token Safe Smart Notes] Consolidation pass skipped, returning combined notes.");
    }
  }

  return enforceEnglishOutput(cleanFinalSmartNotes(rawCombined));
}

async function generateNotesFromFullMaterial(materialText) {
  return generateSmartNotes(materialText);
}

async function generateNotesFromChunks(chunksOrText) {
  if (Array.isArray(chunksOrText)) {
    return generateSmartNotes(chunksOrText.join("\n\n"));
  }
  return generateSmartNotes(chunksOrText);
}
// ======================================================
// FLASHCARD GENERATION
// ======================================================

async function generateFlashcardsFromNotes(
  notes,
  count = 10
) {

  const preparedNotes =
    prepareTextForAI(
      notes,
      6000
    );

  if (!preparedNotes) {
    throw new Error(
      "No notes available for flashcard generation."
    );
  }

  const systemPrompt = `
You are an AI study assistant.

Create useful flashcards from the provided study notes.

Rules:
1. Use ONLY the provided notes.
2. Use actual topics and subtopics from the notes.
3. Do not invent information.
4. Questions must be clear and useful for revision.
5. Answers must be short and accurate.
6. Avoid duplicate questions.
7. Return ONLY valid JSON.
`;

  const prompt = `
Create ${count} flashcards.

Return exactly this JSON format:

{
  "flashcards": [
    {
      "question": "Question",
      "answer": "Answer",
      "topic": "Actual topic",
      "subtopic": "Actual subtopic"
    }
  ]
}

STUDY NOTES:

${preparedNotes}
`;

  const response =
    await generateWithGroq(
      systemPrompt,
      prompt,
      4000
    );

  const parsed =
    parseAIJson(
      response
    );

  if (
    !parsed ||
    !Array.isArray(
      parsed.flashcards
    )
  ) {

    throw new Error(
      "Invalid flashcard response from AI."
    );
  }

  return parsed.flashcards;
}

function extractHeadingsFromSmartNotes(notesText) {
  if (!notesText) return { topics: [], mainTopic: "", headingTreeText: "" };
  const lines = String(notesText).split("\n");
  const topicsMap = [];
  let currentTopicObj = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase().startsWith("source:") || trimmed.toLowerCase().startsWith("title:")) {
      continue;
    }
    const h1Match = trimmed.match(/^#\s+(.+)$/);
    const h2Match = trimmed.match(/^##\s+(.+)$/);
    const h3Match = trimmed.match(/^###\s+(.+)$/);

    if (h1Match || h2Match) {
      const headingText = (h1Match ? h1Match[1] : h2Match[1])
        .replace(/^(Part|Chunk|Section|Chapter)\s*\d+[:\s-]*/i, "")
        .trim();
      if (headingText && !headingText.toLowerCase().includes("smart notes")) {
        currentTopicObj = { topic: headingText, subtopics: [] };
        topicsMap.push(currentTopicObj);
      }
    } else if (h3Match && currentTopicObj) {
      const subtopicText = h3Match[1].trim();
      if (subtopicText && !currentTopicObj.subtopics.includes(subtopicText)) {
        currentTopicObj.subtopics.push(subtopicText);
      }
    }
  }

  const mainTopic = topicsMap.length > 0 ? topicsMap[0].topic : "";
  const headingTreeText = topicsMap
    .map(t => `- Topic: "${t.topic}"${t.subtopics.length > 0 ? ` (Subtopics: ${t.subtopics.map(s => `"${s}"`).join(", ")})` : ""}`)
    .join("\n");

  return { topics: topicsMap, mainTopic, headingTreeText };
}

// ======================================================
// QUIZ QUESTION HISTORY & REPETITION PREVENTION HELPERS
// ======================================================

function escapeRegex(string) {
  return String(string || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Fetch recent previously used questions for a user + material (and optional topic).
 * Returns array of question text strings.
 */
async function getPreviousQuestionsHistory(userId, materialId = null, topic = null, limit = 60) {
  try {
    if (!db || !userId) return [];
    const query = { userId: new ObjectId(userId) };
    if (materialId && ObjectId.isValid(materialId)) {
      query.materialId = new ObjectId(materialId);
    }
    if (topic && String(topic).trim()) {
      const cleanT = String(topic).trim();
      query.topic = new RegExp(`^${escapeRegex(cleanT)}$`, "i");
    }

    const docs = await db.collection("quizQuestionHistory")
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    return docs.map((d) => d.questionText).filter(Boolean);
  } catch (err) {
    console.warn("[Question History] Failed to load previous questions:", err.message);
    return [];
  }
}

/**
 * Record newly generated questions into MongoDB to prevent future repetitions.
 */
async function recordQuizQuestionsHistory(userId, materialId, questions, quizType = "normal", difficulty = "intermediate") {
  try {
    if (!db || !userId || !Array.isArray(questions) || questions.length === 0) return;

    const entries = questions.map((q) => {
      const qText = String(q.question || "").trim();
      return {
        userId: new ObjectId(userId),
        materialId: materialId && ObjectId.isValid(materialId) ? new ObjectId(materialId) : null,
        topic: String(q.topic || "").trim(),
        subtopic: String(q.subtopic || "").trim(),
        difficulty: String(q.difficulty || difficulty || "intermediate").toLowerCase(),
        questionText: qText,
        normalizedQuestion: qText.toLowerCase().replace(/[^a-z0-9]/g, ""),
        quizType,
        createdAt: new Date(),
      };
    }).filter((entry) => entry.questionText.length >= 10);

    if (entries.length > 0) {
      await db.collection("quizQuestionHistory").insertMany(entries);
    }
  } catch (err) {
    console.warn("[Question History] Failed to save questions to history:", err.message);
  }
}

// ======================================================
// NORMAL QUIZ GENERATION FROM SMART NOTES
// ======================================================

async function generateQuizFromNotes(
  notes,
  count = 10,
  materialId = "",
  materialTitle = "",
  difficulty = "intermediate",
  previousQuestions = []
) {
  // Intelligently select and preprocess relevant content without blowing token limits (max 3800 chars ~ 900 tokens)
  const preparedNotes = selectRelevantContentForQuiz(notes, { maxChars: 3800 });

  if (!preparedNotes || !preparedNotes.trim()) {
    throw new Error("No notes or study material available for quiz generation.");
  }

  const extractedStructure = extractHeadingsFromSmartNotes(preparedNotes);
  const cleanDiff = String(difficulty || "intermediate").trim().toLowerCase();
  const validDifficulty = (cleanDiff === "easy" || cleanDiff === "difficult") ? cleanDiff : "intermediate";
  const difficultyLabel = validDifficulty === "easy" ? "Easy" : validDifficulty === "difficult" ? "Difficult" : "Intermediate";

  const targetQuestionCount = Math.max(Number(count) || 10, 10);
  const fallbackTopic = extractedStructure.mainTopic || (materialTitle ? materialTitle.replace(/\.[^/.]+$/, "") : "Core Concepts");

  // Filter and prepare previous questions list (top 10 most recent) to avoid repetition
  const cleanPreviousList = (Array.isArray(previousQuestions) ? previousQuestions : [])
    .map((q) => String(q || "").trim())
    .filter((q) => q.length >= 10)
    .slice(0, 10);

  let previousExclusionPrompt = "";
  if (cleanPreviousList.length > 0) {
    previousExclusionPrompt = `
PREVIOUS QUESTIONS (DO NOT DUPLICATE):
${cleanPreviousList.map((pq, idx) => `${idx + 1}. ${pq}`).join("\n")}
`;
  }

  // ----------------------------------------------------
  // DIFFICULTY-SPECIFIC INSTRUCTIONS
  // ----------------------------------------------------
  let difficultyRules = "";
  if (validDifficulty === "easy") {
    difficultyRules = `DIFFICULTY: EASY (DIRECT RECALL & BASIC CONCEPTS)
- Test basic definitions, terminology, and direct facts explicitly stated in the notes.
- Simple, straightforward phrasing with clear, distinct distractors. Avoid multi-step logic.`;
  } else if (validDifficulty === "difficult") {
    difficultyRules = `DIFFICULTY: DIFFICULT (DEEP ANALYSIS & ADVANCED REASONING)
- Test deep conceptual understanding, multi-step deduction, trade-offs, and complex scenarios.
- Plausible, sophisticated distractors that require strong mastery of the material to distinguish.`;
  } else {
    difficultyRules = `DIFFICULTY: INTERMEDIATE (CONCEPTUAL COMPREHENSION & APPLICATION)
- Test conceptual understanding and practical application rather than simple word-for-word recall.
- Include cause-and-effect, compare-and-contrast, and realistic scenario reasoning.`;
  }

  const strictSeparationBlock = `ALL questions must be strictly ${difficultyLabel.toUpperCase()} level.`;

  const systemPrompt = `You are an expert AI Quiz Generator for a Smart Learning Assistant.
Your task is to generate exactly ${targetQuestionCount} multiple-choice questions strictly derived ONLY from the provided study material at ${difficultyLabel.toUpperCase()} level.
You MUST output valid JSON ONLY, without markdown formatting, code fences, or any text outside the JSON object.

${difficultyRules}
${strictSeparationBlock}
${previousExclusionPrompt}

RULES:
1. Every question MUST be derived directly from the provided Smart Notes excerpt.
2. Do NOT use outside knowledge or unmentioned facts.
3. Do NOT repeat or closely paraphrase any of the previously asked questions.
4. Each question MUST have exactly 4 distinct options (Option A, Option B, Option C, Option D).
5. Only ONE option must be correct. Set "correctAnswer" to "A", "B", "C", or "D".
6. Include a clear, informative explanation citing why the answer is correct based on the Smart Notes.
7. Return ONLY valid JSON matching this schema:
{
  "questions": [
    {
      "question": "Question text testing ${difficultyLabel} level",
      "options": {
        "A": "Option A text",
        "B": "Option B text",
        "C": "Option C text",
        "D": "Option D text"
      },
      "correctAnswer": "A",
      "topic": "${fallbackTopic}",
      "subtopic": "",
      "explanation": "Clear explanation citing the material."
    }
  ]
}`;

  const prompt = `Generate exactly ${targetQuestionCount} ${difficultyLabel.toUpperCase()} multiple-choice questions based ONLY on these Smart Notes:

TOPICS & SUBTOPICS STRUCTURE:
${extractedStructure.headingTreeText || (materialTitle ? `- Topic: "${materialTitle}"` : "- Core Concepts")}

CURRENT SMART NOTES EXCERPT:
${preparedNotes}`;

  let parsed = null;
  let validatedQuestions = [];

  // Attempt 1: Generate with JSON mode and robust parsing
  try {
    console.log(`[Quiz Gen] Generating ${targetQuestionCount} questions (${difficultyLabel}) using AI...`);
    const response = await generateWithGroq(systemPrompt, prompt, 3500, 0.5, true);
    parsed = parseAIJson(response);
    validatedQuestions = validateAndFormatQuizQuestions(
      parsed,
      targetQuestionCount,
      fallbackTopic,
      difficultyLabel,
      materialId
    );
  } catch (firstErr) {
    console.warn(`[Quiz Gen] Initial AI response failed validation: ${firstErr.message}. Retrying once with correction prompt...`);

    // Attempt 2: Retry with explicit correction prompt
    const correctionPrompt = `Your previous output had an issue: ${firstErr.message}.
Please generate exactly ${targetQuestionCount} ${difficultyLabel.toUpperCase()} multiple-choice questions from the notes below.
You MUST output a valid JSON object ONLY, strictly matching this schema:
{
  "questions": [
    {
      "question": "Question text",
      "options": {
        "A": "Option A text",
        "B": "Option B text",
        "C": "Option C text",
        "D": "Option D text"
      },
      "correctAnswer": "A",
      "topic": "${fallbackTopic}",
      "subtopic": "",
      "explanation": "Explanation citing the notes."
    }
  ]
}

NOTES EXCERPT:
${preparedNotes}`;

    try {
      const retryResponse = await generateWithGroq(systemPrompt, correctionPrompt, 3500, 0.4, true);
      parsed = parseAIJson(retryResponse);
      validatedQuestions = validateAndFormatQuizQuestions(
        parsed,
        targetQuestionCount,
        fallbackTopic,
        difficultyLabel,
        materialId
      );
    } catch (retryErr) {
      console.error(`[Quiz Gen] Retry correction attempt failed: ${retryErr.message}`);
      throw new Error(`AI generation error: ${retryErr.message}`);
    }
  }

  // Supplementary generation if we got fewer than targetQuestionCount
  if (validatedQuestions.length < targetQuestionCount) {
    console.warn(`[Quiz Gen] Initial batch yielded ${validatedQuestions.length}/${targetQuestionCount} valid questions. Generating supplementary questions...`);
    try {
      const remainingCount = targetQuestionCount - validatedQuestions.length;
      const supplementPrompt = `Generate exactly ${remainingCount + 2} MORE ${difficultyLabel.toUpperCase()} multiple-choice questions from the Smart Notes.
Do NOT duplicate any of these questions:
${[...cleanPreviousList.slice(0, 10), ...validatedQuestions.map((q) => q.question)].map((q, idx) => `${idx + 1}. ${q}`).join("\n")}

${strictSeparationBlock}
${difficultyRules}

CURRENT SMART NOTES:
${preparedNotes}
`;
      const suppResponse = await generateWithGroq(systemPrompt, supplementPrompt, 2500, 0.6, true);
      const suppParsed = parseAIJson(suppResponse);
      const moreValidated = validateAndFormatQuizQuestions(
        suppParsed,
        remainingCount + 2,
        fallbackTopic,
        difficultyLabel,
        materialId
      );

      for (const mq of moreValidated) {
        const norm = mq.question.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (!validatedQuestions.some((fq) => fq.question.toLowerCase().replace(/[^a-z0-9]/g, "") === norm)) {
          validatedQuestions.push(mq);
          if (validatedQuestions.length >= targetQuestionCount) break;
        }
      }
    } catch (suppErr) {
      console.warn("[Quiz Gen] Supplementary generation warning:", suppErr.message);
    }
  }

  if (validatedQuestions.length === 0) {
    throw new Error("Unable to generate valid quiz questions from the selected notes. Please try again.");
  }

  console.log(`[Quiz Gen] Successfully generated and validated ${validatedQuestions.length} questions.`);
  return validatedQuestions.slice(0, targetQuestionCount);
}

// ======================================================
// WEAK TOPIC REVISION NOTES
// ======================================================

async function generateWeakTopicRevisionNotes(
  materialText,
  topic,
  subtopic
) {

  const preparedText =
    prepareTextForAI(
      materialText,
      120000
    );

  if (!preparedText) {

    throw new Error(
      "No original material is available."
    );
  }

  const cleanTopic =
    String(
      topic || ""
    ).trim();

  const cleanSubtopic =
    String(
      subtopic || ""
    ).trim();

  if (!cleanTopic) {

    throw new Error(
      "Weak topic is required."
    );
  }

  const systemPrompt = `
You are an AI teacher helping a student improve a weak topic.

Your task is to create TARGETED REVISION NOTES.

LANGUAGE RULE — CRITICAL:
- Generate ALL output in ENGLISH ONLY.
- The source material may contain Arabic, Tamil, Hindi, Malayalam, Telugu, or any other non-English language.
- You MUST understand the source content regardless of its language and write the entire revision note in English.
- Translate all non-English natural-language sentences into clear English.
- Do NOT reproduce any Arabic, Tamil, Hindi, or other non-English natural-language text in the output.
- Preserve all programming code exactly as-is. Do not translate code syntax or keywords.
- Keep technical identifiers and programming terms unchanged.
- All headings must be in English (e.g. ## Simple Explanation, ## Important Points, ## Example, ## Exam Points).

CONTENT RULES:

1. Use ONLY the original material provided.
2. Focus ONLY on the requested weak topic.
3. If a subtopic is provided, focus ONLY on that subtopic.
4. Do NOT create notes for unrelated topics.
5. Do NOT add outside information.
6. Do NOT invent examples.
7. Use simple English.
8. Explain the concept like a teacher.
9. Include important definitions if available.
10. Include important points from the original material.
11. Include examples only if the original material contains them.
12. Highlight exam-important information.
13. Do NOT create Part 1, Part 2, Chunk 1, Chunk 2 headings.
14. Do NOT create Markdown tables.
15. Avoid repeated content.
16. Return useful revision notes, not a general summary.
`;

  const focus =
    cleanSubtopic
      ? `
Weak Topic:
${cleanTopic}

Weak Subtopic:
${cleanSubtopic}
`
      : `
Weak Topic:
${cleanTopic}
`;

  const prompt = `
Create targeted revision notes for the student's weak area.

${focus}

Use the original study material below as the ONLY source.

The notes should follow this structure:

# ${cleanSubtopic || cleanTopic}

## Simple Explanation

Explain the weak concept in simple English.

## Important Points

Give the most important points.

## Key Concepts

Explain the important concepts related to this weak area.

## Example

Give an example ONLY if one is present in the original material.

## Exam Points

Give the points the student should remember for an exam.

ORIGINAL STUDY MATERIAL:

${preparedText}
`;

  const notes =
    await generateWithGroq(
      systemPrompt,
      prompt,
      4000
    );

  return enforceEnglishOutput(cleanFinalSmartNotes(notes));
}

// ======================================================
// WEAK TOPIC PRACTICE QUIZ
// ======================================================

async function generateWeakTopicQuiz(
  materialText,
  topic,
  subtopic,
  count = 10,
  previousQuestions = []
) {
  const cleanTopic = String(topic || "").trim();
  const cleanSubtopic = String(subtopic || "").trim();

  if (!cleanTopic) {
    throw new Error("Weak topic is required.");
  }

  // Intelligently select and preprocess relevant content for this weak topic/subtopic (max 3800 chars ~ 900 tokens)
  const preparedText = selectRelevantContentForQuiz(materialText, {
    topic: cleanTopic,
    subtopic: cleanSubtopic,
    maxChars: 3800,
  });

  if (!preparedText) {
    throw new Error("Original study material is not available or contains no relevant text.");
  }

  const cleanPreviousList = (Array.isArray(previousQuestions) ? previousQuestions : [])
    .map((q) => String(q || "").trim())
    .filter((q) => q.length >= 10)
    .slice(0, 10);

  let previousText = "";
  if (cleanPreviousList.length > 0) {
    previousText = cleanPreviousList
      .map((q, index) => `${index + 1}. ${q}`)
      .join("\n");
  }

  const targetCount = Math.max(Number(count) || 10, 10);
  const promptCount = targetCount + 2;

  const systemPrompt = `You are an expert AI assessment creator for a Smart Learning Assistant.
Your task is to generate a targeted practice quiz of exactly ${promptCount} multiple-choice questions for a student who struggled with a specific weak area.
You MUST output a valid JSON object ONLY, without markdown formatting, code fences, or any commentary outside the JSON object.

VERY IMPORTANT RULES:
1. All questions MUST be created based strictly and ONLY on the provided study material excerpt.
2. Every question MUST test exclusively:
   Topic: "${cleanTopic}"
   Subtopic: "${cleanSubtopic || cleanTopic}"
3. Do NOT ask questions from unrelated topics or general knowledge.
4. Create exactly 4 distinct multiple-choice options per question.
5. Only ONE option must be correct.
6. "answer" MUST be the 0-based integer index (0, 1, 2, or 3) of the correct option.
7. Include a clear, helpful 1-2 sentence explanation citing the concept from the material.
8. Avoid repeating any of the previous questions listed below.
9. Return ONLY a JSON object matching this schema:
{
  "questions": [
    {
      "question": "Question text testing ${cleanSubtopic || cleanTopic}",
      "options": [
        "Option A",
        "Option B",
        "Option C",
        "Option D"
      ],
      "answer": 0,
      "topic": "${cleanTopic}",
      "subtopic": "${cleanSubtopic || cleanTopic}",
      "explanation": "Short explanation based on the material."
    }
  ]
}`;

  const prompt = `Generate exactly ${promptCount} multiple-choice practice questions in valid JSON format based ONLY on the following study material excerpt:

TARGET WEAK TOPIC:
${cleanTopic}

TARGET WEAK SUBTOPIC:
${cleanSubtopic || cleanTopic}

${previousText ? `PREVIOUS QUESTIONS ALREADY SEEN (DO NOT REPEAT):\n${previousText}\n` : ""}

ORIGINAL STUDY MATERIAL (TARGETED EXCERPT):
"""
${preparedText}
"""`;

  let parsed = null;
  try {
    const response = await generateWithGroq(systemPrompt, prompt, 2500, 0.6, true);
    parsed = parseAIJson(response);
  } catch (aiErr) {
    console.warn(`[Weak Topic Quiz Gen] Initial AI call failed: ${aiErr.message}. Retrying once with correction prompt...`);
    try {
      const retryPrompt = `Your previous output had an issue: ${aiErr.message}.
Please generate exactly ${promptCount} targeted practice questions for:
Topic: "${cleanTopic}"
Subtopic: "${cleanSubtopic || cleanTopic}"

Return ONLY a valid JSON object matching:
{
  "questions": [
    {
      "question": "Question text testing ${cleanSubtopic || cleanTopic}",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "answer": 0,
      "topic": "${cleanTopic}",
      "subtopic": "${cleanSubtopic || cleanTopic}",
      "explanation": "Short explanation based on the material."
    }
  ]
}

ORIGINAL STUDY MATERIAL:
"""
${preparedText}
"""`;
      const retryResp = await generateWithGroq(systemPrompt, retryPrompt, 2500, 0.4, true);
      parsed = parseAIJson(retryResp);
    } catch (retryErr) {
      console.error(`[Weak Topic Quiz Gen] Retry also failed: ${retryErr.message}`);
      throw new Error(`AI generation error: ${retryErr.message || aiErr.message}`);
    }
  }

  if (!parsed || !Array.isArray(parsed.questions)) {
    throw new Error("Invalid weak-topic quiz response from AI.");
  }

  const seenPreviousNormalized = new Set(
    cleanPreviousList.map((q) => q.toLowerCase().replace(/[^a-z0-9]/g, ""))
  );

  function validatePracticeQuestions(rawList, allowPreviousFallback = false) {
    if (!Array.isArray(rawList)) return [];

    const seenInBatch = new Set();
    const result = [];

    for (const q of rawList) {
      if (!q || typeof q !== "object") continue;

      const rawQText = String(q.question || q.questionText || "").trim();
      if (rawQText.length < 10) continue;

      const norm = rawQText.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (seenInBatch.has(norm)) continue;
      if (!allowPreviousFallback && seenPreviousNormalized.has(norm)) continue;

      let rawOptions = [];
      if (Array.isArray(q.options)) {
        rawOptions = q.options;
      } else if (q.options && typeof q.options === "object") {
        const keys = ["A", "B", "C", "D"];
        const hasLetterKeys = keys.some((k) => q.options[k] !== undefined || q.options[k.toLowerCase()] !== undefined);
        if (hasLetterKeys) {
          rawOptions = keys.map((k) => q.options[k] || q.options[k.toLowerCase()] || "");
        } else {
          rawOptions = Object.values(q.options);
        }
      }

      let cleanedOptions = rawOptions
        .map((opt) => String(opt || "").trim())
        .filter((opt) => opt.length > 0);

      const uniqueSet = new Set(cleanedOptions.map((o) => o.toLowerCase()));
      if (uniqueSet.size < cleanedOptions.length) {
        cleanedOptions = Array.from(new Set(cleanedOptions));
      }

      if (cleanedOptions.length < 4) continue;
      if (cleanedOptions.length > 4) cleanedOptions = cleanedOptions.slice(0, 4);

      let ansIdx = 0;
      const rawAns = q.correctAnswer ?? q.answer ?? q.correctOption ?? q.correct;
      if (typeof rawAns === "string") {
        const cleanAns = rawAns.trim().toUpperCase();
        if (cleanAns === "A") ansIdx = 0;
        else if (cleanAns === "B") ansIdx = 1;
        else if (cleanAns === "C") ansIdx = 2;
        else if (cleanAns === "D") ansIdx = 3;
        else {
          const num = parseInt(cleanAns, 10);
          if (!isNaN(num) && num >= 0 && num <= 3) ansIdx = num;
        }
      } else if (typeof rawAns === "number" && Number.isInteger(rawAns) && rawAns >= 0 && rawAns <= 3) {
        ansIdx = rawAns;
      }
      if (ansIdx < 0 || ansIdx >= cleanedOptions.length) ansIdx = 0;

      seenInBatch.add(norm);

      result.push({
        question: rawQText,
        options: cleanedOptions,
        answer: ansIdx,
        correctAnswer: ["A", "B", "C", "D"][ansIdx] || "A",
        topic: cleanTopic,
        subtopic: cleanSubtopic || cleanTopic,
        explanation: String(q.explanation || "").trim() || `The correct answer is "${cleanedOptions[ansIdx]}".`,
        isWeakTopicPractice: true,
      });

      if (result.length >= targetCount) break;
    }

    return result;
  }

  let finalQuestions = validatePracticeQuestions(parsed.questions, false);
  let limitedSourceWarning = null;

  // Supplementary generation if needed
  if (finalQuestions.length < targetCount) {
    console.warn(`[Weak Topic Quiz] Initial batch yielded ${finalQuestions.length}/${targetCount} questions. Fetching supplementary...`);
    try {
      const remainingCount = targetCount - finalQuestions.length;
      const suppPrompt = `Create exactly ${remainingCount + 2} MORE targeted practice questions for Topic: "${cleanTopic}", Subtopic: "${cleanSubtopic || cleanTopic}".
Do NOT repeat any of these questions:
${[...cleanPreviousList.slice(0, 15), ...finalQuestions.map((q) => q.question)].map((q, idx) => `${idx + 1}. ${q}`).join("\n")}

ORIGINAL STUDY MATERIAL:
"""
${preparedText}
"""`;
      const suppResp = await generateWithGroq(systemPrompt, suppPrompt, 2500, 0.7, true);
      const suppParsed = parseAIJson(suppResp);
      if (suppParsed && Array.isArray(suppParsed.questions)) {
        const suppValid = validatePracticeQuestions(suppParsed.questions, false);
        for (const sv of suppValid) {
          const norm = sv.question.toLowerCase().replace(/[^a-z0-9]/g, "");
          if (!finalQuestions.some((fq) => fq.question.toLowerCase().replace(/[^a-z0-9]/g, "") === norm)) {
            finalQuestions.push(sv);
            if (finalQuestions.length >= targetCount) break;
          }
        }
      }
    } catch (suppErr) {
      console.warn("[Weak Topic Quiz] Supplementary generation warning:", suppErr.message);
    }
  }

  // Graceful fallback for limited text materials if needed
  if (finalQuestions.length < targetCount && cleanPreviousList.length > 0) {
    const fallbackList = validatePracticeQuestions(parsed.questions, true);
    for (const fq of fallbackList) {
      const norm = fq.question.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!finalQuestions.some((q) => q.question.toLowerCase().replace(/[^a-z0-9]/g, "") === norm)) {
        finalQuestions.push(fq);
        if (finalQuestions.length >= targetCount) break;
      }
    }
    limitedSourceWarning = "Source material has limited text for this topic. Some questions explore different aspects of the same concept.";
  }

  if (finalQuestions.length === 0) {
    throw new Error("Unable to generate valid weak-topic quiz questions. Please try again.");
  }

  const resultList = finalQuestions.slice(0, targetCount);
  if (limitedSourceWarning) {
    resultList.limitedSourceWarning = limitedSourceWarning;
  }
  return resultList;
}

// ======================================================
// WEAK TOPIC AI ANALYSIS
// ======================================================

async function analyzeWeakTopicsWithAI(
  mistakes
) {

  if (
    !Array.isArray(
      mistakes
    ) ||
    mistakes.length ===
      0
  ) {

    return {
      weakTopics: [],
      overallAdvice:
        "No mistakes found. Keep practicing to maintain your progress.",
    };
  }

  const mistakeText =
    mistakes
      .map(
        (item, index) => {

          return `
Mistake ${index + 1}

Question:
${item.question || ""}

Topic:
${item.topic || ""}

Subtopic:
${item.subtopic || ""}

Student Answer:
${item.studentAnswer || ""}

Correct Answer:
${item.correctAnswer || ""}

Explanation:
${item.explanation || ""}
`;
        }
      )
      .join(
        "\n--------------------\n"
      );

  const systemPrompt = `
You are an AI learning analyst.

Analyze the student's quiz mistakes.

Your job is to identify the actual weak topics and subtopics.

Rules:

1. Use the topic and subtopic from the mistakes.
2. Group related mistakes together.
3. Do not invent topic names when actual names are available.
4. Calculate mistakeCount for each weak area.
5. Severity:
   - High: 3 or more mistakes
   - Medium: 2 mistakes
   - Low: 1 mistake
6. Give a simple reason.
7. Give practical revision advice.
8. Return ONLY valid JSON.
`;

  const prompt = `
Analyze these quiz mistakes:

${mistakeText}

Return exactly:

{
  "weakTopics": [
    {
      "topic": "Actual topic",
      "subtopic": "Actual subtopic",
      "mistakeCount": 2,
      "severity": "Medium",
      "reason": "Why the student is weak",
      "revisionAdvice": "What the student should revise"
    }
  ],
  "overallAdvice": "Overall study advice"
}
`;

  const response =
    await generateWithGroq(
      systemPrompt,
      prompt,
      3000
    );

  const parsed =
    parseAIJson(
      response
    );

  return {

    weakTopics:
      Array.isArray(
        parsed.weakTopics
      )
        ? parsed.weakTopics
        : [],

    overallAdvice:
      String(
        parsed.overallAdvice ||
          ""
      ),
  };
}
// ======================================================
// REGISTER
// ======================================================

const handleRegister = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    const cleanName = (name || "").trim();
    const cleanEmail = (email || "").trim().toLowerCase();
    const cleanPassword = password || "";

    if (!cleanName || !cleanEmail || !cleanPassword) {
      return res.status(400).json({
        success: false,
        message: "Name, email and password are required.",
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address.",
      });
    }

    if (cleanPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters long.",
      });
    }

    const existingUser = await db.collection("users").findOne({
      email: cleanEmail,
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "Email is already registered. Please log in.",
      });
    }

    const hashedPassword = await bcrypt.hash(cleanPassword, 10);

    const result = await db.collection("users").insertOne({
      name: cleanName,
      email: cleanEmail,
      password: hashedPassword,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return res.status(201).json({
      success: true,
      message: "Registration successful. Please log in with your credentials.",
      user: {
        id: result.insertedId,
        name: cleanName,
        email: cleanEmail,
      },
    });
  } catch (error) {
    console.error("Register error:", error);
    return res.status(500).json({
      success: false,
      message: "Registration failed due to a server error. Please try again.",
    });
  }
};

app.post("/api/register", handleRegister);
app.post("/api/auth/register", handleRegister);
app.post("/api/auth/signup", handleRegister);

// ======================================================
// LOGIN
// ======================================================

const handleLogin = async (req, res) => {
  try {
    const { email, password, rememberMe } = req.body;

    const cleanEmail = (email || "").trim().toLowerCase();
    const cleanPassword = password || "";

    if (!cleanEmail || !cleanPassword) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    const user = await db.collection("users").findOne({
      email: cleanEmail,
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    const passwordMatch = await bcrypt.compare(cleanPassword, user.password);

    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password.",
      });
    }

    const isRemember = Boolean(rememberMe);
    const expiresIn = isRemember ? "30d" : "1d";

    const token = jwt.sign(
      {
        userId: user._id.toString(),
        email: user.email,
        rememberMe: isRemember,
      },
      JWT_SECRET,
      { expiresIn }
    );

    return res.json({
      success: true,
      message: "Login successful.",
      token,
      expiresIn,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({
      success: false,
      message: "Login failed due to a server error.",
    });
  }
};

app.post("/api/login", handleLogin);
app.post("/api/auth/login", handleLogin);

// ======================================================
// FORGOT & RESET PASSWORD
// ======================================================

const handleForgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const cleanEmail = (email || "").trim().toLowerCase();

    if (!cleanEmail) {
      return res.status(400).json({
        success: false,
        message: "Email address is required.",
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid email address.",
      });
    }

    const user = await db.collection("users").findOne({
      email: cleanEmail,
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No registered account found with that email address.",
      });
    }

    // 1. Generate secure random 32-byte token
    const resetToken = crypto.randomBytes(32).toString("hex");

    // 2. Hash token with SHA-256 before storing in DB (prevents plain-text token exposure if DB compromised)
    const hashedToken = crypto.createHash("sha256").update(resetToken).digest("hex");
    const resetExpires = new Date(Date.now() + 3600000); // 1 hour expiration

    await db.collection("users").updateOne(
      { _id: user._id },
      {
        $set: {
          resetPasswordToken: hashedToken,
          resetPasswordExpires: resetExpires,
          updatedAt: new Date(),
        },
      }
    );

    // 3. SMTP configuration check
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = (process.env.SMTP_APP_PASSWORD || "").trim().replace(/\s+/g, "");

    if (!smtpUser || !smtpPass) {
      console.error("Forgot Password error: SMTP_USER or SMTP_APP_PASSWORD missing in backend .env");
      return res.status(500).json({
        success: false,
        message: "Email delivery service is not configured on the server. Please check SMTP settings.",
      });
    }

    const clientOrigin = req.headers.origin || "http://localhost:5173";
    const resetUrl = `${clientOrigin}/reset-password/${resetToken}`;

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    const registeredEmail = user.email;

    const mailOptions = {
      from: `"EduGenAI Support" <${smtpUser}>`,
      to: registeredEmail,
      subject: "EduGenAI - Password Reset Request",
      text: `Hello ${user.name || "Student"},\n\nWe received a request to reset your password for your EduGenAI account.\n\nPlease click the following link to reset your password (valid for 1 hour):\n${resetUrl}\n\nIf you did not request a password reset, please ignore this email and your password will remain unchanged.\n\nBest regards,\nEduGenAI Support Team`,
      html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8f7ff; margin: 0; padding: 24px; color: #1e1b4b; }
    .card { max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 14px; border: 1px solid #ede9fe; overflow: hidden; box-shadow: 0 4px 18px rgba(109, 40, 217, 0.07); }
    .header { background: linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%); color: #ffffff; padding: 26px 28px; }
    .header h1 { margin: 0; font-size: 20px; font-weight: 800; }
    .content { padding: 28px; line-height: 1.6; }
    .btn { display: inline-block; background-color: #7c3aed; color: #ffffff !important; text-decoration: none; padding: 13px 26px; border-radius: 10px; font-weight: 700; font-size: 14px; margin: 20px 0; }
    .footer { background: #f8fafc; padding: 16px 28px; font-size: 12px; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>Password Reset Request</h1>
    </div>
    <div class="content">
      <p>Hello <strong>${user.name || "Student"}</strong>,</p>
      <p>We received a request to reset the password for your EduGenAI account associated with <strong>${registeredEmail}</strong>.</p>
      <p>Click the button below to choose a new password. For security reasons, this link is valid for <strong>1 hour</strong>:</p>
      <div style="text-align: center;">
        <a href="${resetUrl}" class="btn">Reset Your Password →</a>
      </div>
      <p style="font-size: 13px; color: #64748b;">If the button does not work, copy and paste this URL into your browser:<br><a href="${resetUrl}" style="color: #7c3aed; word-break: break-all;">${resetUrl}</a></p>
      <p style="font-size: 13px; color: #64748b; margin-top: 24px;">If you did not request this, you can safely ignore this email. Your password will remain unchanged.</p>
    </div>
    <div class="footer">
      EduGenAI &bull; AI-Powered Smart Learning Assistant
    </div>
  </div>
</body>
</html>`,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[Forgot Password] Reset email sent to registered user ${registeredEmail}. MessageId: ${info.messageId}`);

    return res.json({
      success: true,
      message: "A password reset link has been sent to your email address. Please check your inbox and spam folder.",
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    return res.status(500).json({
      success: false,
      message: `Failed to send password reset email: ${error.message || "Server error"}`,
    });
  }
};

const handleVerifyResetToken = async (req, res) => {
  try {
    const { token } = req.params;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: "Reset token is required.",
      });
    }

    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

    const user = await db.collection("users").findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Password reset link is invalid or has expired. Please request a new link.",
      });
    }

    return res.json({
      success: true,
      message: "Reset token is valid.",
      email: user.email,
    });
  } catch (error) {
    console.error("Verify reset token error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to verify reset token.",
    });
  }
};

const handleResetPassword = async (req, res) => {
  try {
    const { token, password, confirmPassword } = req.body;

    const cleanToken = (token || "").trim();
    const cleanPassword = password || "";
    const cleanConfirm = confirmPassword || "";

    if (!cleanToken || !cleanPassword) {
      return res.status(400).json({
        success: false,
        message: "Token and new password are required.",
      });
    }

    if (confirmPassword !== undefined && cleanPassword !== cleanConfirm) {
      return res.status(400).json({
        success: false,
        message: "Passwords do not match.",
      });
    }

    if (cleanPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters long.",
      });
    }

    const hashedToken = crypto.createHash("sha256").update(cleanToken).digest("hex");

    const user = await db.collection("users").findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "Password reset link is invalid or has expired. Please request a new link.",
      });
    }

    const hashedPassword = await bcrypt.hash(cleanPassword, 10);

    // Atomically update password and immediately unset token/expiry to prevent replay attacks
    await db.collection("users").updateOne(
      { _id: user._id },
      {
        $set: {
          password: hashedPassword,
          updatedAt: new Date(),
        },
        $unset: {
          resetPasswordToken: "",
          resetPasswordExpires: "",
        },
      }
    );

    console.log(`[Reset Password] Password successfully reset for user ${user.email}`);

    return res.json({
      success: true,
      message: "Password has been reset successfully. You can now log in with your new password.",
    });
  } catch (error) {
    console.error("Reset password error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to reset password due to a server error.",
    });
  }
};

app.post("/api/forgot-password", handleForgotPassword);
app.post("/api/auth/forgot-password", handleForgotPassword);

app.get("/api/reset-password/:token", handleVerifyResetToken);
app.get("/api/auth/reset-password/:token", handleVerifyResetToken);

app.post("/api/reset-password", handleResetPassword);
app.post("/api/auth/reset-password", handleResetPassword);

// ======================================================
// CURRENT USER
// ======================================================

app.get(
  "/api/me",
  authenticateToken,
  async (req, res) => {

    try {

      const user =
        await db
          .collection("users")
          .findOne(
            {
              _id:
                new ObjectId(
                  req.user.userId
                ),
            },
            {
              projection: {
                password: 0,
              },
            }
          );

      if (!user) {

        return res.status(404).json({
          success: false,
          message:
            "User not found.",
        });
      }

      return res.json({

        success: true,

        user,
      });

    } catch (error) {

      console.error(
        "Get user error:",
        error
      );

      return res.status(500).json({
        success: false,
        message:
          "Unable to get user.",
      });
    }
  }
);

// ======================================================
// PROCESS UPLOADED MATERIAL
// ======================================================

app.post(
  "/api/process",
  authenticateToken,
  upload.single("file"),
  async (req, res) => {

    let uploadedPath =
      null;

    try {

      if (!req.file) {

        return res.status(400).json({
          success: false,
          message:
            "Please upload a file.",
        });
      }

      uploadedPath =
        req.file.path;

      console.log(
        `Processing file: ${req.file.originalname}`
      );

      // Check if an existing material with identical fileName and fileSize already exists for this user
      const existingMaterial = await db.collection("materials").findOne({
        userId: new ObjectId(req.user.userId),
        fileName: req.file.originalname,
        fileSize: req.file.size,
      });

      if (existingMaterial) {
        // Check if a standard note already exists for this material
        const existingNote = await db.collection("notes").findOne({
          userId: new ObjectId(req.user.userId),
          materialId: existingMaterial._id,
          type: { $in: ["smart-notes", "standard", null] },
        });

        if (existingNote && existingNote.content) {
          console.log(`Reusing existing standard note for material ${existingMaterial._id}`);
          return res.json({
            success: true,
            message: "Material already processed. Retrieved existing Smart Notes.",
            materialId: existingMaterial._id.toString(),
            notesId: existingNote._id.toString(),
            fileName: existingMaterial.fileName,
            notes: existingNote.content,
            chunkCount: existingMaterial.chunkCount || 1,
            createdAt: existingNote.createdAt ? existingNote.createdAt.toISOString() : existingMaterial.createdAt.toISOString(),
            isExisting: true,
          });
        }
      }

      const extractedText =
        await extractTextFromFile(
          req.file.path,
          req.file.originalname
        );

      const cleanedText =
        cleanExtractedText(
          extractedText
        );

      if (
        !cleanedText ||
        cleanedText.length < 20
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Could not extract enough readable text from this file.",
        });
      }

      const chunks =
        chunkText(
          cleanedText,
          9000,
          500
        );

      console.log(
        `Extracted ${cleanedText.length} characters`
      );

      console.log(
        `Created ${chunks.length} chunks`
      );

      const notes =
        await generateSmartNotes(
          cleanedText
        );

      const createdAt =
        new Date();

      // ------------------------------------------------
      // SAVE OR REUSE MATERIAL
      // ------------------------------------------------
      let materialId;
      let chunkCount = chunks.length;

      if (existingMaterial) {
        materialId = existingMaterial._id;
        chunkCount = existingMaterial.chunkCount || chunks.length;
        await db.collection("materials").updateOne(
          { _id: existingMaterial._id },
          { $set: { notes, extractedText: cleanedText, updatedAt: createdAt } }
        );
      } else {
        const materialResult =
          await db
            .collection("materials")
            .insertOne({
              userId:
                new ObjectId(
                  req.user.userId
                ),
              fileName:
                req.file.originalname,
              storedFileName:
                req.file.filename,
              fileType:
                path
                  .extname(
                    req.file.originalname
                  )
                  .toLowerCase(),
              fileSize:
                req.file.size,
              extractedText:
                cleanedText,
              notes,
              chunkCount:
                chunks.length,
              createdAt,
              updatedAt:
                createdAt,
            });
        materialId = materialResult.insertedId;
      }

      // ------------------------------------------------
      // SAVE OR REUSE NOTES (PROTECTED AGAINST DUPLICATES)
      // ------------------------------------------------
      let notesId;
      const existingNoteAfter = await db.collection("notes").findOne({
        userId: new ObjectId(req.user.userId),
        materialId: materialId,
        type: { $in: ["smart-notes", "standard", null] },
      });

      if (existingNoteAfter) {
        notesId = existingNoteAfter._id;
        await db.collection("notes").updateOne(
          { _id: existingNoteAfter._id },
          {
            $set: {
              title: videoTitle,
              content: notes,
              type: "youtube-notes",
              sourceType: "youtube",
              youtubeUrl: url,
              youtubeVideoId: videoId,
              sourceFileName: videoTitle,
              updatedAt: createdAt,
            },
          }
        );
      } else {
        try {
          const notesResult =
            await db
              .collection("notes")
              .insertOne({
                userId:
                  new ObjectId(
                    req.user.userId
                  ),
                materialId,
                title:
                  req.file.originalname,
                content:
                  notes,
                type:
                  "smart-notes",
                createdAt,
                updatedAt:
                  createdAt,
              });
          notesId = notesResult.insertedId;
        } catch (insertErr) {
          if (insertErr.code === 11000) {
            // Concurrently inserted note safely caught
            const concurrentNote = await db.collection("notes").findOne({
              userId: new ObjectId(req.user.userId),
              materialId,
              type: { $in: ["smart-notes", "standard", null] },
            });
            notesId = concurrentNote ? concurrentNote._id : materialId;
          } else {
            throw insertErr;
          }
        }
      }

      return res.json({
        success: true,
        message:
          "Material processed successfully.",
        materialId:
          materialId.toString(),
        notesId:
          notesId.toString(),
        fileName:
          req.file.originalname,
        notes,
        chunkCount,
        createdAt:
          createdAt.toISOString(),
      });

    } catch (error) {

      console.error(
        "Process material error:",
        error
      );

      return res.status(500).json({

        success: false,

        message:
          error.message ||
          "Failed to process material.",
      });

    } finally {

      // Keep uploaded file for future
      // weak-topic revision generation.
      //
      // So we intentionally do not
      // delete the uploaded file here.
    }
  }
);

// ======================================================
// GENERATE FLASHCARDS
// ======================================================

app.post(
  "/api/generate-flashcards",
  authenticateToken,
  async (req, res) => {

    try {

      const {
        notes,
        count,
        materialId,
        title,
      } = req.body;

      if (!notes) {

        return res.status(400).json({
          success: false,
          message:
            "Notes are required.",
        });
      }

      const flashcards =
        await generateFlashcardsFromNotes(
          notes,
          Number(count) || 10
        );

      const cardsWithMaterial = (flashcards || []).map((card) => ({
        ...card,
        materialId: materialId || card.materialId || null,
      }));

      // Persist generated flashcard deck to MongoDB for the authenticated user
      if (db && req.user && req.user.userId && cardsWithMaterial.length > 0) {
        try {
          const userObjId = new ObjectId(req.user.userId);
          const matObjId = materialId && ObjectId.isValid(materialId) ? new ObjectId(materialId) : null;
          const deckTitle = String(title || "Study Material").trim();

          const filter = { userId: userObjId };
          if (matObjId) {
            filter.materialId = matObjId;
          } else if (deckTitle) {
            filter.materialTitle = deckTitle;
          }

          const updateDoc = {
            $set: {
              userId: userObjId,
              materialId: matObjId,
              materialTitle: deckTitle,
              cards: cardsWithMaterial,
              cardCount: cardsWithMaterial.length,
              updatedAt: new Date(),
            },
            $setOnInsert: {
              createdAt: new Date(),
            },
          };

          await db.collection("flashcards").updateOne(filter, updateDoc, { upsert: true });
        } catch (dbErr) {
          console.warn("[Flashcards] DB save error:", dbErr.message);
        }
      }

      return res.json({

        success: true,

        materialId: materialId || null,

        flashcards: cardsWithMaterial,

        cardCount: cardsWithMaterial.length,
      });

    } catch (error) {

      console.error(
        "Flashcard error:",
        error
      );

      return res.status(500).json({

        success: false,

        message:
          error.message ||
          "Failed to generate flashcards.",
      });
    }
  }
);

// ======================================================
// GET FLASHCARDS / STATS
// ======================================================

app.get(
  "/api/flashcards",
  authenticateToken,
  async (req, res) => {
    try {
      if (!db || !req.user || !req.user.userId) {
        return res.json({
          success: true,
          totalCards: 0,
          totalDecks: 0,
          decks: [],
        });
      }

      const userObjId = new ObjectId(req.user.userId);
      const query = { userId: userObjId };

      if (req.query.materialId) {
        const matIdStr = String(req.query.materialId).trim();
        if (ObjectId.isValid(matIdStr)) {
          query.$or = [
            { materialId: new ObjectId(matIdStr) },
            { materialTitle: matIdStr },
          ];
        } else {
          query.materialTitle = matIdStr;
        }
      }

      const rawDecks = await db
        .collection("flashcards")
        .find(query)
        .sort({ updatedAt: -1 })
        .toArray();

      // Filter out failed generations (decks with 0 cards)
      const validDecks = rawDecks.filter((deck) => {
        if (Array.isArray(deck.cards)) {
          return deck.cards.length > 0;
        }
        if (deck.cardCount) {
          return Number(deck.cardCount) > 0;
        }
        return Boolean(deck.question && deck.answer);
      });

      // Deduplicate sets if multiple records point to the same material
      const seenMaterialIds = new Set();
      const uniqueValidDecks = [];
      let totalCards = 0;

      for (const deck of validDecks) {
        const mId = deck.materialId ? deck.materialId.toString() : null;
        if (mId) {
          if (seenMaterialIds.has(mId)) continue;
          seenMaterialIds.add(mId);
        }
        uniqueValidDecks.push(deck);

        if (Array.isArray(deck.cards)) {
          totalCards += deck.cards.length;
        } else if (deck.cardCount) {
          totalCards += Number(deck.cardCount);
        } else if (deck.question && deck.answer) {
          totalCards += 1;
        }
      }

      return res.json({
        success: true,
        totalSets: uniqueValidDecks.length,
        totalDecks: uniqueValidDecks.length,
        totalCards,
        decks: uniqueValidDecks,
      });
    } catch (error) {
      console.error("Fetch flashcards error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to retrieve flashcards.",
      });
    }
  }
);

// ======================================================
// SAVE FLASHCARDS (DIRECT SAVE)
// ======================================================

app.post(
  "/api/flashcards",
  authenticateToken,
  async (req, res) => {
    try {
      if (!db || !req.user || !req.user.userId) {
        return res.status(401).json({
          success: false,
          message: "User not authenticated.",
        });
      }

      const { cards, materialId, title } = req.body;
      if (!Array.isArray(cards) || cards.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Cards array is required.",
        });
      }

      const userObjId = new ObjectId(req.user.userId);
      const matObjId = materialId && ObjectId.isValid(materialId) ? new ObjectId(materialId) : null;
      const deckTitle = String(title || "Study Material").trim();

      const filter = { userId: userObjId };
      if (matObjId) {
        filter.materialId = matObjId;
      } else if (deckTitle) {
        filter.materialTitle = deckTitle;
      }

      await db.collection("flashcards").updateOne(
        filter,
        {
          $set: {
            userId: userObjId,
            materialId: matObjId,
            materialTitle: deckTitle,
            cards,
            cardCount: cards.length,
            updatedAt: new Date(),
          },
          $setOnInsert: {
            createdAt: new Date(),
          },
        },
        { upsert: true }
      );

      const userDecks = await db
        .collection("flashcards")
        .find({ userId: userObjId })
        .toArray();

      let totalCards = 0;
      userDecks.forEach((d) => {
        if (Array.isArray(d.cards)) totalCards += d.cards.length;
        else if (d.cardCount) totalCards += Number(d.cardCount);
      });

      return res.json({
        success: true,
        message: "Flashcards saved successfully.",
        totalCards,
        totalDecks: userDecks.length,
      });
    } catch (err) {
      console.error("Save flashcards error:", err);
      return res.status(500).json({
        success: false,
        message: "Failed to save flashcards.",
      });
    }
  }
);

// ======================================================
// GENERATE NORMAL QUIZ
// ======================================================

app.post(
  "/api/generate-quiz",
  authenticateToken,
  async (req, res) => {
    try {
      const {
        notes,
        count,
        materialId,
        materialTitle: clientMaterialTitle,
        difficulty,
        previousQuestions,
      } = req.body;

      let targetMaterial = null;
      let quizContent = notes || "";
      let targetMaterialId = materialId || "";
      let materialTitle = clientMaterialTitle || "";

      // If materialId is provided and is a valid ObjectId, look up the specific material from MongoDB
      if (materialId && ObjectId.isValid(materialId)) {
        targetMaterial = await db.collection("materials").findOne({
          _id: new ObjectId(materialId),
          userId: new ObjectId(req.user.userId),
        });

        if (targetMaterial) {
          targetMaterialId = targetMaterial._id.toString();
          materialTitle = targetMaterial.fileName || materialTitle;
          quizContent = targetMaterial.notes || targetMaterial.extractedText || quizContent;
        }
      }

      if (!quizContent || !quizContent.trim()) {
        return res.status(400).json({
          success: false,
          message: "No study notes or material content found to generate quiz.",
        });
      }

      const requestedDifficulty = String(difficulty || "intermediate").trim().toLowerCase();
      console.log(`[Quiz API] Request received - User: ${req.user.userId}, MaterialId: ${targetMaterialId || "none"}, MaterialTitle: "${materialTitle}", Difficulty: ${requestedDifficulty}`);

      // Fetch previously generated questions from MongoDB to prevent repetitions across attempts
      const dbPrevious = await getPreviousQuestionsHistory(
        req.user.userId,
        targetMaterialId,
        null,
        60
      );
      const clientPrevious = Array.isArray(previousQuestions) ? previousQuestions : [];
      const combinedPrevious = Array.from(new Set([...clientPrevious, ...dbPrevious]));

      const questions =
        await generateQuizFromNotes(
          quizContent,
          Number(count) || 10,
          targetMaterialId,
          materialTitle,
          requestedDifficulty,
          combinedPrevious
        );

      const questionsWithMaterial = (questions || []).map((q) => ({
        ...q,
        materialId: targetMaterialId || q.materialId || "",
      }));

      // Record newly generated questions into MongoDB history
      await recordQuizQuestionsHistory(
        req.user.userId,
        targetMaterialId,
        questionsWithMaterial,
        "normal",
        requestedDifficulty
      );

      console.log(`[Quiz API] Successfully generated ${questionsWithMaterial.length} questions for user ${req.user.userId}`);

      return res.json({
        success: true,
        materialId: targetMaterialId || null,
        difficulty: requestedDifficulty,
        questions: questionsWithMaterial,
        limitedSourceWarning: questions.limitedSourceWarning || null,
      });

    } catch (error) {
      console.error(
        "Quiz generation error:",
        error
      );

      let userMessage = error.message || "Failed to generate quiz.";
      if (error.message && (error.message.includes("413") || error.message.includes("too large"))) {
        userMessage = "The study material is very lengthy. Content has been optimized; please retry generating the quiz.";
      } else if (error.message && (error.message.includes("429") || error.message.includes("rate limit") || error.message.includes("TPM"))) {
        userMessage = "AI rate limit reached. Please wait a few seconds and try again.";
      }

      return res.status(500).json({
        success: false,
        message: userMessage,
      });
    }
  }
);

// ======================================================
// ANALYZE WEAK TOPICS
// ======================================================

app.post(
  "/api/analyze-weak-topics",
  authenticateToken,
  async (req, res) => {

    try {

      const {
        mistakes,
        materialId,
        quizId,
      } = req.body;

      if (
        !Array.isArray(
          mistakes
        ) ||
        mistakes.length === 0
      ) {

        return res.json({

          success: true,

          quizId: quizId || null,

          weakTopics: [],

          overallAdvice:
            "No mistakes found.",

          mistakeCount:
            0,

          materialId: materialId || null,
        });
      }

      const analysis =
        await analyzeWeakTopicsWithAI(
          mistakes
        );

      const weakTopicsWithMaterial = (analysis.weakTopics || []).map((wt) => ({
        ...wt,
        quizId: quizId || null,
        materialId: materialId || wt.materialId || mistakes[0]?.materialId || null,
      }));

      return res.json({

        success: true,

        quizId: quizId || null,

        materialId: materialId || mistakes[0]?.materialId || null,

        weakTopics:
          weakTopicsWithMaterial,

        overallAdvice:
          analysis.overallAdvice,

        mistakeCount:
          mistakes.length,
      });

    } catch (error) {

      console.error(
        "Weak topic analysis error:",
        error
      );

      return res.status(500).json({

        success: false,

        message:
          error.message ||
          "Failed to analyze weak topics.",
      });
    }
  }
);

// ======================================================
// GENERATE WEAK TOPIC REVISION NOTES
// ======================================================

app.post(
  "/api/generate-weak-topic-notes",
  authenticateToken,
  async (req, res) => {
    try {
      const {
        topic,
        subtopic,
        materialId,
      } = req.body;

      if (!topic || !String(topic).trim()) {
        return res.status(400).json({
          success: false,
          message: "Weak topic is required.",
        });
      }

      const cleanTopic =
        String(topic).trim();

      const cleanSubtopic =
        String(subtopic || "").trim();

      // --------------------------------------------------
      // GET TARGETED MATERIAL (BY ID OR LATEST)
      // --------------------------------------------------

      let material = null;

      if (materialId && ObjectId.isValid(materialId)) {
        material = await db.collection("materials").findOne({
          _id: new ObjectId(materialId),
          userId: new ObjectId(req.user.userId),
        });
      }

      if (!material) {
        material = await db
          .collection("materials")
          .find({
            userId: new ObjectId(req.user.userId),
          })
          .sort({
            createdAt: -1,
          })
          .limit(1)
          .next();
      }

      if (!material) {
        return res.status(404).json({
          success: false,
          message:
            "No uploaded study material found.",
        });
      }

      if (
        !material.extractedText ||
        !material.extractedText.trim()
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Uploaded material text is not available.",
        });
      }

      const materialName =
        material.fileName ||
        "Uploaded Study Material";

      console.log(
        "===================================="
      );

      console.log(
        "GENERATING WEAK TOPIC REVISION NOTES"
      );

      console.log(
        "Source Material:",
        materialName
      );

      console.log(
        "Weak Topic:",
        cleanTopic
      );

      console.log(
        "Subtopic:",
        cleanSubtopic || "Not specified"
      );

      // --------------------------------------------------
      // CLEAN & EXCERPT SOURCE MATERIAL FOR TOKEN SAFETY
      // --------------------------------------------------

      const materialText =
        cleanExtractedText(
          material.extractedText
        );

      let targetedExcerpt = materialText;
      if (materialText.length > 5000) {
        const paragraphs = materialText.split(/\n\s*\n/);
        const keywords = [cleanTopic, cleanSubtopic].filter(Boolean).map(k => k.toLowerCase());
        const matchingParagraphs = paragraphs.filter(p => {
          const lowerP = p.toLowerCase();
          return keywords.some(kw => lowerP.includes(kw));
        });

        if (matchingParagraphs.length > 0) {
          targetedExcerpt = matchingParagraphs.join("\n\n").substring(0, 5000);
        } else {
          targetedExcerpt = materialText.substring(0, 5000);
        }
      }

      // --------------------------------------------------
      // AI REVISION PROMPT
      // --------------------------------------------------

      const revisionSystemPrompt = `
You are the AI Revision Notes Generator of an
AI-Powered Smart Learning Assistant.

Your job is to create focused revision notes for
ONLY the weak topic identified from the student's quiz.

SOURCE MATERIAL IS THE ONLY SOURCE OF TRUTH.

IMPORTANT RULES:

- Use ONLY the provided source material.
- Do NOT use outside knowledge.
- Do NOT invent information.
- Focus ONLY on the requested weak topic.
- Focus on the requested subtopic when available.
- Do NOT explain unrelated topics.
- Use the actual terminology from the source.
- Keep the notes useful for exam revision.
- Use simple college-level English.
- Explain difficult concepts clearly.
- Include definitions when present.
- Include important concepts.
- Include examples when present.
- Include steps or procedures when present.
- Include important points for exams.
- Do not create Markdown tables.
- Do not use Part 1, Part 2, Chunk 1, Chunk 2.
- Do not mention AI processing.
- Do not mention this prompt.
- Do not mention token limits.

The output must clearly represent a REVISION NOTE.

Use this structure:

# Weak Topic Revision

## Topic
Actual topic name

## Subtopic
Actual subtopic name, if available

## Simple Explanation
Explain the weak topic clearly using the source.

## Important Points
List the most important points from the source.

## Key Concepts
Explain the important concepts related ONLY to this topic.

## Example
Include an example only if the source contains one.

## Exam Points
Give the important points the student should remember for an exam.

Return ONLY the revision notes.
`;

      const revisionPrompt = `
==================================================
SOURCE MATERIAL (TARGETED EXCERPT)
==================================================

${targetedExcerpt}

==================================================
WEAK TOPIC
==================================================

Topic:
${cleanTopic}

Subtopic:
${cleanSubtopic || "Not specified"}

==================================================

TASK
==================================================

Create focused revision notes ONLY for:

Topic:
${cleanTopic}

Subtopic:
${cleanSubtopic || "Not specified"}

Do not discuss unrelated topics.

Return ONLY the revision notes.
`;

      // --------------------------------------------------
      // GENERATE NOTES
      // --------------------------------------------------

      const rawNotes =
        await generateWithGroq(
          revisionSystemPrompt,
          revisionPrompt,
          4000
        );

      const notes =
        cleanFinalSmartNotes(
          rawNotes
        );

      if (
        !notes ||
        !notes.trim()
      ) {
        throw new Error(
          "AI could not generate revision notes."
        );
      }

      // --------------------------------------------------
      // SAVE TO MONGODB
      // --------------------------------------------------

      const createdAt =
        new Date();

      const noteTitle =
        `${materialName} - Weak Topic - ${cleanTopic}`;

      const noteDocument = {
        userId:
          new ObjectId(
            req.user.userId
          ),

        materialId:
          material._id,

        title:
          noteTitle,

        content:
          notes,

        type:
          "weak-topic-revision",

        sourceFileName:
          materialName,

        weakTopic:
          cleanTopic,

        weakSubtopic:
          cleanSubtopic,

        createdAt,

        updatedAt:
          createdAt,
      };

      // --- DUPLICATE PREVENTION (30-second debounce for repeated clicks) ---
      const recentWindow = new Date(Date.now() - 30 * 1000);
      const recentDuplicate = await db.collection("notes").findOne({
        userId: new ObjectId(req.user.userId),
        materialId: material._id,
        type: "weak-topic-revision",
        weakTopic: cleanTopic,
        weakSubtopic: cleanSubtopic,
        createdAt: { $gte: recentWindow },
      });

      if (recentDuplicate) {
        console.log("Duplicate targeted revision note detected within 30s — returning existing record.");
        return res.json({
          success: true,
          id: recentDuplicate._id.toString(),
          noteId: recentDuplicate._id.toString(),
          notes: recentDuplicate.content,
          title: recentDuplicate.title,
          sourceFileName: recentDuplicate.sourceFileName || materialName,
          topic: cleanTopic,
          subtopic: cleanSubtopic,
          materialId: material._id.toString(),
          createdAt: recentDuplicate.createdAt.toISOString(),
          isDuplicate: true,
        });
      }

      const insertResult = await db
        .collection("notes")
        .insertOne(
          noteDocument
        );

      // --------------------------------------------------
      // RESPONSE
      // --------------------------------------------------

      res.json({
        success: true,

        id: insertResult.insertedId.toString(),
        noteId: insertResult.insertedId.toString(),

        notes,

        title:
          noteTitle,

        sourceFileName:
          materialName,

        topic:
          cleanTopic,

        subtopic:
          cleanSubtopic,

        materialId:
          material._id.toString(),

        createdAt:
          createdAt.toISOString(),
      });

    } catch (error) {
      console.error(
        "Weak topic revision notes error:",
        error
      );

      res.status(500).json({
        success: false,

        message:
          error.message ||
          "Failed to generate weak topic revision notes.",
      });
    }
  }
);

// ======================================================
// GENERATE COMPLETE WEAK TOPIC SMART NOTES (ALL TOPICS COMBINED)
// ======================================================

app.post(
  "/api/generate-complete-weak-notes",
  authenticateToken,
  async (req, res) => {
    try {
      const { topics, materialId } = req.body;

      if (!Array.isArray(topics) || topics.length === 0) {
        return res.status(400).json({
          success: false,
          message: "A list of weak topics is required.",
        });
      }

      // Filter and sanitize topics
      const cleanTopics = topics
        .filter((t) => t && (t.topic || typeof t === "string"))
        .map((t) => {
          if (typeof t === "string") {
            return { topic: t.trim(), subtopic: "" };
          }
          return {
            topic: String(t.topic || "").trim(),
            subtopic: String(t.subtopic || "").trim(),
          };
        })
        .filter((t) => t.topic.length > 0 && t.topic !== "General Topic");

      if (cleanTopics.length === 0) {
        return res.status(400).json({
          success: false,
          message: "No specific weak topics found to generate notes.",
        });
      }

      // --------------------------------------------------
      // GET TARGETED MATERIAL (BY ID OR LATEST)
      // --------------------------------------------------

      let material = null;

      if (materialId && ObjectId.isValid(materialId)) {
        material = await db.collection("materials").findOne({
          _id: new ObjectId(materialId),
          userId: new ObjectId(req.user.userId),
        });
      }

      if (!material) {
        material = await db
          .collection("materials")
          .find({
            userId: new ObjectId(req.user.userId),
          })
          .sort({
            createdAt: -1,
          })
          .limit(1)
          .next();
      }

      if (!material) {
        return res.status(404).json({
          success: false,
          message: "No uploaded study material found.",
        });
      }

      if (!material.extractedText || !material.extractedText.trim()) {
        return res.status(400).json({
          success: false,
          message: "Uploaded material text is not available.",
        });
      }

      const materialName = material.fileName || "Uploaded Study Material";

      console.log("====================================");
      console.log("GENERATING COMPLETE WEAK TOPICS REVISION NOTE");
      console.log("Source Material:", materialName);
      console.log("Total Weak Topics:", cleanTopics.length);

      // Clean source text and extract relevant parts
      const materialText = cleanExtractedText(material.extractedText);

      // Collect keywords for all topics to prioritize relevant excerpts if text is large
      let targetedExcerpt = materialText;
      if (materialText.length > 10000) {
        const paragraphs = materialText.split(/\n\s*\n/);
        const keywords = cleanTopics.flatMap((t) => [t.topic, t.subtopic]).filter(Boolean).map((k) => k.toLowerCase());
        const matchingParagraphs = paragraphs.filter((p) => {
          const lowerP = p.toLowerCase();
          return keywords.some((kw) => lowerP.includes(kw));
        });

        if (matchingParagraphs.length > 0) {
          targetedExcerpt = matchingParagraphs.join("\n\n").substring(0, 10000);
        } else {
          targetedExcerpt = materialText.substring(0, 10000);
        }
      }

      const topicsListFormatted = cleanTopics
        .map((t, idx) => `${idx + 1}. Topic: "${t.topic}"${t.subtopic ? ` (Subtopic: "${t.subtopic}")` : ""}`)
        .join("\n");

      const systemPrompt = `You are an expert academic tutor and revision guide creator for an AI-Powered Smart Learning Assistant.
Your mission is to generate a comprehensive, highly structured AI REVISION NOTE that covers ALL weak topics identified from the student's quiz.

LANGUAGE RULE — CRITICAL:
- Generate ALL output in ENGLISH ONLY.
- The source material may contain Arabic, Tamil, Hindi, Malayalam, Telugu, or any other non-English language.
- You MUST understand the source content regardless of its language and write the entire revision note in English.
- Translate all non-English natural-language sentences into clear English.
- Do NOT reproduce any Arabic, Tamil, Hindi, or other non-English natural-language text in the output.
- Preserve all programming code exactly as-is. Do not translate code syntax or keywords.
- Keep technical identifiers and programming terms unchanged.
- All headings must be in English.

STRICT CONSTRAINTS & RULES:
1. SOURCE MATERIAL IS THE ONLY SOURCE OF TRUTH.
2. Use ONLY facts, definitions, principles, and concepts present in the provided source material.
3. Do NOT invent, assume, or extrapolate outside knowledge.
4. Cover EVERY weak topic and its subtopic listed in the request.
5. Do NOT skip any requested weak topic.
6. Write in clear, structured, student-friendly Markdown.
7. Do NOT include markdown tables.
8. Do NOT mention AI, system prompts, or tokens.

REQUIRED OUTPUT STRUCTURE:

# AI REVISION NOTE
## Weak Topics Revision Guide
A concise overview explaining that this targeted revision guide reviews the key weak areas identified from the recent assessment based on ${materialName}.

${cleanTopics.map((t, idx) => `## ${idx + 1}. ${t.topic}${t.subtopic ? ` - ${t.subtopic}` : ""}
### Key Concepts
[Explain the core definitions, formulas, or concepts for this topic using the source material]
### Important Points
[Bullet points of critical facts and rules directly from the material]
### Example
[A clear practical example, case, or problem step from the material if present, or concrete application of the concept]
### Quick Revision
[A 1-2 sentence quick recap for rapid memory recall]`).join("\n\n")}

## Final Quick Revision
- [Bulleted high-yield checklist summarizing the most essential takeaways across all ${cleanTopics.length} weak topics for last-minute exam prep]
`;

      const userPrompt = `SOURCE STUDY MATERIAL:
"""
${targetedExcerpt}
"""

IDENTIFIED WEAK TOPICS TO COVER TOGETHER:
${topicsListFormatted}

Generate the complete, unified AI Revision Note covering all the above topics using the exact structure specified.`;

      const rawNotes = await generateWithGroq(systemPrompt, userPrompt, 6000);
      const notes = await enforceEnglishOutput(cleanFinalSmartNotes(rawNotes));

      if (!notes || !notes.trim()) {
        throw new Error("AI could not generate complete revision notes.");
      }

      const createdAt = new Date();
      const noteTitle = `${materialName} - AI Revision Note (Complete Weak Topics)`;

      const noteDocument = {
        userId: new ObjectId(req.user.userId),
        materialId: material._id,
        title: noteTitle,
        content: notes,
        type: "weak-topic-complete",
        sourceFileName: materialName,
        topics: cleanTopics,
        createdAt,
        updatedAt: createdAt,
      };

      // --- DUPLICATE PREVENTION ---
      // Check if a complete weak-topic note for this user+material already exists
      // within the last 1 minute (prevents accidental double-clicks creating duplicate records)
      const oneMinuteAgo = new Date(Date.now() - 60 * 1000);

      const existingNote = await db.collection("notes").findOne({
        userId: new ObjectId(req.user.userId),
        materialId: material._id,
        type: "weak-topic-complete",
        createdAt: { $gte: oneMinuteAgo },
      });

      if (existingNote) {
        console.log("Duplicate revision note detected within 1m — returning existing record.");
        return res.json({
          success: true,
          id: existingNote._id.toString(),
          noteId: existingNote._id.toString(),
          notes: existingNote.content,
          title: existingNote.title,
          sourceFileName: existingNote.sourceFileName || materialName,
          topics: existingNote.topics || cleanTopics,
          materialId: existingNote.materialId.toString(),
          createdAt: existingNote.createdAt.toISOString(),
          isDuplicate: true,
        });
      }

      const insertResult = await db.collection("notes").insertOne(noteDocument);

      return res.json({
        success: true,
        id: insertResult.insertedId.toString(),
        noteId: insertResult.insertedId.toString(),
        notes,
        title: noteTitle,
        sourceFileName: materialName,
        topics: cleanTopics,
        materialId: material._id.toString(),
        createdAt: createdAt.toISOString(),
      });
    } catch (error) {
      console.error("Complete weak topic revision error:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to generate complete weak topic revision notes.",
      });
    }
  }
);

// ======================================================
// GENERATE WEAK TOPIC PRACTICE QUIZ
// ======================================================

app.post(
  "/api/generate-weak-topic-quiz",
  authenticateToken,
  async (req, res) => {

    try {

      const {
        taskId,
        topic,
        subtopic,
        count,
        previousQuestions,
        materialId,
      } = req.body;

      // If taskId is provided, fetch task metadata to guarantee exact task-specific alignment
      let taskDoc = null;
      if (taskId && ObjectId.isValid(taskId)) {
        taskDoc = await db.collection("revisionTasks").findOne({
          _id: new ObjectId(taskId),
          userId: new ObjectId(req.user.userId),
        });
      }

      const cleanTopic =
        String(
          topic || (taskDoc ? taskDoc.topic : "") || ""
        ).trim();

      const cleanSubtopic =
        String(
          subtopic || (taskDoc ? (taskDoc.subtopic || taskDoc.topic) : "") || ""
        ).trim();

      console.log(`[Weak Topic Quiz API] Request received - User: ${req.user.userId}, TaskId: ${taskId || "none"}, Topic: "${cleanTopic}", Subtopic: "${cleanSubtopic}"`);

      if (!cleanTopic) {

        return res.status(400).json({
          success: false,
          message:
            "Weak topic is required.",
        });
      }

      // ------------------------------------------------
      // Get targeted material (by Task ID, Material ID, or name)
      // ------------------------------------------------

      const targetMaterialId =
        materialId ||
        (taskDoc && taskDoc.materialId ? taskDoc.materialId.toString() : null);

      let material = null;

      if (targetMaterialId && ObjectId.isValid(targetMaterialId)) {
        material = await db.collection("materials").findOne({
          _id: new ObjectId(targetMaterialId),
          userId: new ObjectId(req.user.userId),
        });

        // Also check if material belongs to system or was created during testing
        if (!material) {
          material = await db.collection("materials").findOne({
            _id: new ObjectId(targetMaterialId),
          });
        }
      }

      // If material not found by ID but taskDoc has materialName, find by fileName
      if (!material && taskDoc && taskDoc.materialName && taskDoc.materialName !== "Study Material") {
        material = await db.collection("materials").findOne({
          userId: new ObjectId(req.user.userId),
          fileName: taskDoc.materialName,
        });
      }

      // Check notes collection as fallback for note-based materials
      if (!material && targetMaterialId && ObjectId.isValid(targetMaterialId)) {
        const noteDoc = await db.collection("notes").findOne({
          $or: [
            { materialId: new ObjectId(targetMaterialId) },
            { _id: new ObjectId(targetMaterialId) },
          ],
        });
        if (noteDoc && noteDoc.content) {
          material = {
            _id: noteDoc.materialId || noteDoc._id,
            fileName: noteDoc.title || (taskDoc ? taskDoc.materialName : "Study Material"),
            extractedText: noteDoc.content,
          };
        }
      }

      if (!material) {
        material = await db
          .collection("materials")
          .findOne(
            {
              userId:
                new ObjectId(
                  req.user.userId
                ),
            },
            {
              sort: {
                createdAt: -1,
              },
            }
          );
      }

      if (!material) {

        return res.status(404).json({
          success: false,
          message:
            "No uploaded study material found for this revision task.",
        });
      }

      const rawText =
        material.extractedText ||
        material.notes ||
        "";

      const materialText =
        cleanExtractedText(rawText);

      if (!materialText) {
        return res.status(400).json({
          success: false,
          message: "Original study material is empty.",
        });
      }

      // Fetch previously asked questions from MongoDB for this topic to avoid repeating them
      const dbPrevious = await getPreviousQuestionsHistory(
        req.user.userId,
        material._id.toString(),
        cleanTopic,
        60
      );
      const clientPrevious = Array.isArray(previousQuestions) ? previousQuestions : [];
      const combinedPrevious = Array.from(new Set([...clientPrevious, ...dbPrevious]));

      const questions =
        await generateWeakTopicQuiz(
          materialText,
          cleanTopic,
          cleanSubtopic,
          Number(count) || 10,
          combinedPrevious
        );

      const questionsWithMeta = (questions || []).map((q) => ({
        ...q,
        topic: cleanTopic,
        subtopic: cleanSubtopic || cleanTopic,
        materialId: material._id.toString(),
      }));

      // Record newly generated practice questions into MongoDB history
      await recordQuizQuestionsHistory(
        req.user.userId,
        material._id.toString(),
        questionsWithMeta,
        "practice",
        "intermediate"
      );

      console.log(`[Weak Topic Quiz API] Successfully generated ${questionsWithMeta.length} questions for user ${req.user.userId}`);

      return res.json({
        success: true,
        topic: cleanTopic,
        subtopic: cleanSubtopic || cleanTopic,
        materialId: material._id.toString(),
        sourceFileName: material.fileName || "Uploaded Study Material",
        questions: questionsWithMeta,
        isWeakTopicPractice: true,
        limitedSourceWarning: questions.limitedSourceWarning || null,
      });

    } catch (error) {
      console.error(
        "Weak topic quiz error:",
        error
      );

      let userMessage = error.message || "Failed to generate weak-topic quiz.";
      if (error.message && (error.message.includes("413") || error.message.includes("too large"))) {
        userMessage = "The study material is very lengthy. Content has been optimized; please retry generating the practice quiz.";
      } else if (error.message && (error.message.includes("429") || error.message.includes("rate limit") || error.message.includes("TPM"))) {
        userMessage = "AI rate limit reached. Please wait a few seconds and try again.";
      }

      return res.status(500).json({
        success: false,
        message: userMessage,
      });
    }
  }
);

// ======================================================
// QUIZ RESULTS — SAVE & RETRIEVE LATEST
// ======================================================

// Save a completed quiz result (accuracy + metadata + full questions review)
app.post(
  "/api/quiz-results",
  authenticateToken,
  async (req, res) => {
    try {
      const {
        quizId,
        materialId,
        accuracy,
        score,
        totalQuestions,
        correctCount,
        incorrectCount,
        unansweredCount,
        questions,
        answers,
        reviewQuestions,
        difficulty,
        topic,
        completedAt,
      } = req.body;

      if (accuracy === undefined || accuracy === null) {
        return res.status(400).json({ success: false, message: "accuracy is required." });
      }
      const userId = new ObjectId(req.user.userId);
      const cleanQuizId = String(quizId || `quiz-${Date.now()}`);

      const doc = {
        userId,
        quizId: cleanQuizId,
        materialId: materialId && ObjectId.isValid(materialId) ? new ObjectId(materialId) : null,
        topic: String(topic || "Study Material").trim(),
        difficulty: String(difficulty || "Intermediate").trim(),
        accuracy: Number(accuracy),
        score: Number(score !== undefined ? score : (correctCount || 0)),
        totalQuestions: Number(totalQuestions || 0),
        correctCount: Number(correctCount || 0),
        incorrectCount: Number(incorrectCount || 0),
        unansweredCount: Number(unansweredCount || 0),
        questions: Array.isArray(questions) ? questions : [],
        answers: answers && typeof answers === "object" ? answers : {},
        reviewQuestions: Array.isArray(reviewQuestions) ? reviewQuestions : [],
        completedAt: completedAt ? new Date(completedAt) : new Date(),
        updatedAt: new Date(),
      };

      // Prevent duplicate records for the same quiz attempt
      await db.collection("quizResults").updateOne(
        { userId, quizId: cleanQuizId },
        { $set: doc },
        { upsert: true }
      );

      return res.json({ success: true, message: "Quiz result saved.", quizId: cleanQuizId });
    } catch (error) {
      console.error("Save quiz result error:", error);
      return res.status(500).json({ success: false, message: "Failed to save quiz result." });
    }
  }
);

// Get the latest completed quiz result for the user (including full questions review)
app.get(
  "/api/quiz-results/latest",
  authenticateToken,
  async (req, res) => {
    try {
      const userId = new ObjectId(req.user.userId);
      const { quizId } = req.query;

      const query = { userId };
      if (quizId) {
        query.quizId = String(quizId);
      }

      const latest = await db.collection("quizResults")
        .find(query)
        .sort({ completedAt: -1 })
        .limit(1)
        .toArray();

      if (latest.length === 0) {
        return res.json({ success: true, result: null });
      }

      const r = latest[0];
      return res.json({
        success: true,
        result: {
          quizId: r.quizId,
          materialId: r.materialId ? r.materialId.toString() : "",
          topic: r.topic || "Study Material",
          difficulty: r.difficulty || "Intermediate",
          accuracy: r.accuracy,
          score: r.score,
          totalQuestions: r.totalQuestions,
          correctCount: r.correctCount,
          incorrectCount: r.incorrectCount,
          unansweredCount: r.unansweredCount || 0,
          questions: r.questions || [],
          answers: r.answers || {},
          reviewQuestions: r.reviewQuestions || [],
          completedAt: r.completedAt,
        },
      });
    } catch (error) {
      console.error("Get quiz results error:", error);
      return res.status(500).json({ success: false, message: "Failed to load quiz results." });
    }
  }
);

// Get latest practice attempts for a user (or by taskId)
app.get(
  "/api/practice-attempts/latest",
  authenticateToken,
  async (req, res) => {
    try {
      const userId = new ObjectId(req.user.userId);
      const { taskId, quizId } = req.query;

      const query = { userId };
      if (taskId && ObjectId.isValid(taskId)) {
        query.taskId = new ObjectId(taskId);
      }
      if (quizId) {
        query.quizId = String(quizId);
      }

      const latest = await db.collection("practiceAttempts")
        .find(query)
        .sort({ completedAt: -1 })
        .limit(1)
        .toArray();

      if (latest.length === 0) {
        return res.json({ success: true, attempt: null });
      }

      const a = latest[0];

      let requiredScore = 70;
      let materialName = "Study Material";
      if (a.taskId) {
        const task = await db.collection("revisionTasks").findOne({ _id: a.taskId, userId });
        if (task) {
          requiredScore = task.requiredScore || 70;
          materialName = task.materialName || materialName;
        }
      }

      return res.json({
        success: true,
        attempt: {
          taskId: a.taskId ? a.taskId.toString() : "",
          materialId: a.materialId ? a.materialId.toString() : "",
          materialName,
          topic: a.topic,
          subtopic: a.subtopic || "",
          quizId: a.quizId || "",
          score: a.score || 0,
          totalQuestions: a.totalQuestions || 10,
          correctCount: a.correctCount || 0,
          incorrectCount: a.incorrectCount || 0,
          accuracy: a.accuracy || 0,
          previousAccuracy: a.previousAccuracy || 0,
          improvement: a.improvement || 0,
          requiredScore,
          reviewQuestions: a.reviewQuestions || [],
          completedAt: a.completedAt,
        },
      });
    } catch (error) {
      console.error("Get latest practice attempt error:", error);
      return res.status(500).json({ success: false, message: "Failed to fetch practice attempt." });
    }
  }
);

// ======================================================
// PRACTICE ATTEMPTS — SAVE & RETRIEVE
// ======================================================

// Save a completed practice quiz attempt
app.post(
  "/api/practice-attempts",
  authenticateToken,
  async (req, res) => {
    try {
      const {
        taskId,
        materialId,
        topic,
        subtopic,
        quizId,
        score,
        totalQuestions,
        correctCount,
        incorrectCount,
        accuracy,
        previousAccuracy,
        improvement,
        reviewQuestions,
      } = req.body;

      if (!topic) {
        return res.status(400).json({ success: false, message: "Topic is required." });
      }

      const attempt = {
        userId: new ObjectId(req.user.userId),
        taskId: taskId && ObjectId.isValid(taskId) ? new ObjectId(taskId) : null,
        materialId: materialId && ObjectId.isValid(materialId) ? new ObjectId(materialId) : null,
        topic: String(topic).trim(),
        subtopic: String(subtopic || "").trim(),
        quizId: String(quizId || ""),
        score: Number(score) || 0,
        totalQuestions: Number(totalQuestions) || 0,
        correctCount: Number(correctCount) || 0,
        incorrectCount: Number(incorrectCount) || 0,
        accuracy: Number(accuracy) || 0,
        previousAccuracy: Number(previousAccuracy) || 0,
        improvement: Number(improvement) || 0,
        reviewQuestions: Array.isArray(reviewQuestions)
          ? reviewQuestions.map((q) => ({
              questionNumber: Number(q.questionNumber || 0),
              question: String(q.question || ""),
              options: Array.isArray(q.options) ? q.options.map(String) : [],
              selectedAnswer: String(q.selectedAnswer || "Not Answered"),
              selectedIndex: q.selectedIndex !== null && q.selectedIndex !== undefined ? Number(q.selectedIndex) : null,
              correctAnswer: String(q.correctAnswer || ""),
              correctIndex: Number(q.correctIndex || 0),
              isCorrect: Boolean(q.isCorrect),
              isUnanswered: Boolean(q.isUnanswered),
              explanation: String(q.explanation || ""),
            }))
          : [],
        completedAt: new Date(),
      };

      if (quizId) {
        await db.collection("practiceAttempts").updateOne(
          { userId: new ObjectId(req.user.userId), quizId: String(quizId) },
          { $set: attempt },
          { upsert: true }
        );
      } else {
        await db.collection("practiceAttempts").insertOne(attempt);
      }

      // --- INTELLIGENT REVISION UPDATES ---
      // When a student completes a practice quiz:
      // Recalculate topic performance, reduce priority if improved, or increase if weak.
      const newAcc = Number(accuracy) || 0;
      let newPriority = "Medium";
      let updatedDuration = "30 min";
      let updatedActivity = "Review Notes + Practice Quiz";

      if (newAcc >= 70) {
        newPriority = "Low";
        updatedDuration = "15 min";
        updatedActivity = "Light Review + Flashcards";
      } else if (newAcc < 40) {
        newPriority = "High";
        updatedDuration = "45 min";
        updatedActivity = "Re-read Notes + Practice Quiz";
      }

      let taskFilter;
      if (taskId && ObjectId.isValid(taskId)) {
        taskFilter = {
          _id: new ObjectId(taskId),
          userId: new ObjectId(req.user.userId),
        };
      } else {
        taskFilter = {
          userId: new ObjectId(req.user.userId),
          topic: String(topic).trim(),
        };
        if (subtopic && String(subtopic).trim()) {
          taskFilter.subtopic = String(subtopic).trim();
        }
      }

      // Check current task and its configured requiredScore
      let currentTaskStatus = "Pending";
      let requiredThreshold = 70;
      let existingCompletedAt = null;
      try {
        const existingTask = await db.collection("revisionTasks").findOne(taskFilter);
        if (existingTask) {
          currentTaskStatus = existingTask.status || "Pending";
          existingCompletedAt = existingTask.completedAt || null;
          if (existingTask.requiredScore !== undefined && !isNaN(Number(existingTask.requiredScore))) {
            requiredThreshold = Number(existingTask.requiredScore);
          } else if (req.body.requiredScore !== undefined && !isNaN(Number(req.body.requiredScore))) {
            requiredThreshold = Number(req.body.requiredScore);
          }
        }
      } catch (e) {
        // ignore lookup errors — fall through with safe default
      }

      const isCompleted = newAcc >= requiredThreshold;

      // Status logic:
      // Minimum Required Practice Score: 70%
      // 1. If student scores >= 70% -> Completed
      // 2. If student scores < 70% -> In Progress
      // 3. Unattempted -> Pending
      const newStatus = isCompleted ? "Completed" : "In Progress";

      await db.collection("revisionTasks").updateMany(
        taskFilter,
        {
          $set: {
            latestPracticeAccuracy: newAcc,
            latestPracticeAt: new Date(),
            priority: newPriority,
            duration: updatedDuration,
            activityType: updatedActivity,
            status: newStatus,
            requiredScore: requiredThreshold,
            completedAt: isCompleted ? (existingCompletedAt || new Date()) : null,
            updatedAt: new Date(),
          }
        }
      );

      return res.json({
        success: true,
        message: isCompleted
          ? "Task completed successfully!"
          : `Scored ${newAcc}%. Score must be ${requiredThreshold}% or above to complete. Task marked as In Progress.`,
        isCompleted,
        status: newStatus,
        requiredScore: requiredThreshold,
      });
    } catch (error) {
      console.error("Save practice attempt error:", error);
      return res.status(500).json({ success: false, message: "Failed to save practice attempt." });
    }
  }
);

// Get latest practice attempts for a user (grouped by topic+subtopic)
app.get(
  "/api/practice-attempts",
  authenticateToken,
  async (req, res) => {
    try {
      const { materialId } = req.query;
      const filter = { userId: new ObjectId(req.user.userId) };
      if (materialId && ObjectId.isValid(materialId)) {
        filter.materialId = new ObjectId(materialId);
      }

      // Get all attempts sorted newest first, then deduplicate by topic+subtopic keeping latest
      const attempts = await db.collection("practiceAttempts")
        .find(filter)
        .sort({ completedAt: -1 })
        .toArray();

      const latestByKey = {};
      attempts.forEach((a) => {
        const key = `${String(a.topic || "").trim().toLowerCase()}|||${String(a.subtopic || "").trim().toLowerCase()}`;
        if (!latestByKey[key]) {
          latestByKey[key] = {
            topic: a.topic,
            subtopic: a.subtopic || "",
            accuracy: a.accuracy,
            previousAccuracy: a.previousAccuracy,
            improvement: a.improvement,
            correctCount: a.correctCount,
            incorrectCount: a.incorrectCount,
            totalQuestions: a.totalQuestions,
            completedAt: a.completedAt,
          };
        }
      });

      return res.json({ success: true, attempts: Object.values(latestByKey) });
    } catch (error) {
      console.error("Get practice attempts error:", error);
      return res.status(500).json({ success: false, message: "Failed to load practice attempts." });
    }
  }
);

// ======================================================
// YOUTUBE TRANSCRIPT
// ======================================================

app.post(
  "/api/youtube-transcript",
  authenticateToken,
  async (req, res) => {

    try {

      const { url } = req.body;

      if (!url) {
        return res.status(400).json({
          success: false,
          message: "YouTube URL is required.",
        });
      }

      const match =
        String(url).match(
          /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([^&?/]+)/
        );

      if (!match) {
        return res.status(400).json({
          success: false,
          message: "Invalid YouTube URL.",
        });
      }

      const videoId = match[1];

      let videoTitle = `YouTube - ${videoId}`;
      try {
        const oembedRes = await axios.get(
          `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
          { timeout: 5000 }
        );
        if (oembedRes?.data?.title) {
          videoTitle = `YouTube: ${oembedRes.data.title}`;
        }
      } catch (e) {
        console.log("Could not fetch YouTube oEmbed title, using default title.");
      }

      console.log(
        `Fetching YouTube transcript: ${videoId} (${videoTitle})`
      );

      const transcript =
        await fetchTranscript(
          videoId
        );

      if (
        !Array.isArray(transcript) ||
        transcript.length === 0
      ) {
        return res.status(404).json({
          success: false,
          message:
            "No transcript available for this video.",
        });
      }

      const transcriptText =
        transcript
          .map(
            (item) =>
              item.text || ""
          )
          .join(" ")
          .replace(
            /\s+/g,
            " "
          )
          .trim();

      if (!transcriptText) {
        return res.status(404).json({
          success: false,
          message:
            "Could not extract readable transcript.",
        });
      }

      const notes =
        await generateSmartNotes(
          transcriptText
        );

      const createdAt =
        new Date();

      // Check if YouTube video was already processed for this user
      const existingMaterial = await db.collection("materials").findOne({
        userId: new ObjectId(req.user.userId),
        $or: [
          { youtubeUrl: url },
          { youtubeVideoId: videoId },
        ]
      });

      if (existingMaterial) {
        const existingNote = await db.collection("notes").findOne({
          userId: new ObjectId(req.user.userId),
          materialId: existingMaterial._id,
          type: { $in: ["youtube-notes", "smart-notes", "standard", null] },
        });

        if (existingNote && existingNote.content) {
          console.log(`Reusing existing YouTube note for video ${videoId}`);
          return res.json({
            success: true,
            videoId,
            fileName: existingMaterial.fileName,
            transcript: existingMaterial.extractedText || transcriptText,
            notes: existingNote.content,
            materialId: existingMaterial._id.toString(),
            notesId: existingNote._id.toString(),
            createdAt: existingNote.createdAt ? existingNote.createdAt.toISOString() : existingMaterial.createdAt.toISOString(),
            isExisting: true,
            youtubeUrl: url,
            sourceType: "youtube",
            sourceFileName: existingMaterial.fileName,
          });
        }
      }

      // ------------------------------------------------
      // SAVE OR REUSE YOUTUBE MATERIAL
      // ------------------------------------------------
      let materialId;
      if (existingMaterial) {
        materialId = existingMaterial._id;
        await db.collection("materials").updateOne(
          { _id: existingMaterial._id },
          {
            $set: {
              notes,
              extractedText: transcriptText,
              youtubeUrl: url,
              youtubeVideoId: videoId,
              fileType: "youtube",
              sourceType: "youtube",
              updatedAt: createdAt,
            },
          }
        );
      } else {
        const materialResult =
          await db
            .collection("materials")
            .insertOne({
              userId:
                new ObjectId(
                  req.user.userId
                ),
              fileName:
                videoTitle,
              storedFileName:
                null,
              fileType:
                "youtube",
              sourceType:
                "youtube",
              fileSize:
                transcriptText.length,
              extractedText:
                transcriptText,
              notes,
              chunkCount:
                chunkText(
                  transcriptText
                ).length,
              youtubeUrl:
                url,
              youtubeVideoId:
                videoId,
              createdAt,
              updatedAt:
                createdAt,
            });
        materialId = materialResult.insertedId;
      }

      // ------------------------------------------------
      // SAVE OR REUSE NOTES (PROTECTED AGAINST DUPLICATES)
      // ------------------------------------------------
      let notesId;
      const existingNoteAfter = await db.collection("notes").findOne({
        userId: new ObjectId(req.user.userId),
        materialId,
        type: { $in: ["youtube-notes", "smart-notes", "standard", null] },
      });

      if (existingNoteAfter) {
        notesId = existingNoteAfter._id;
        await db.collection("notes").updateOne(
          { _id: existingNoteAfter._id },
          {
            $set: {
              title: videoTitle,
              content: notes,
              type: "youtube-notes",
              sourceType: "youtube",
              youtubeUrl: url,
              youtubeVideoId: videoId,
              sourceFileName: videoTitle,
              updatedAt: createdAt,
            },
          }
        );
      } else {
        try {
          const insertRes = await db
            .collection("notes")
            .insertOne({
              userId:
                new ObjectId(
                  req.user.userId
                ),
              materialId,
              title:
                videoTitle,
              content:
                notes,
              type:
                "youtube-notes",
              sourceType:
                "youtube",
              youtubeUrl:
                url,
              youtubeVideoId:
                videoId,
              sourceFileName:
                videoTitle,
              createdAt,
              updatedAt:
                createdAt,
            });
          notesId = insertRes.insertedId;
        } catch (insertErr) {
          if (insertErr.code === 11000) {
            const concurrentNote = await db.collection("notes").findOne({
              userId: new ObjectId(req.user.userId),
              materialId,
              type: { $in: ["youtube-notes", "smart-notes", "standard", null] },
            });
            notesId = concurrentNote ? concurrentNote._id : materialId;
          } else {
            throw insertErr;
          }
        }
      }

      return res.json({
        success: true,
        videoId,
        fileName:
          videoTitle,
        transcript:
          transcriptText,
        notes,
        materialId:
          materialId.toString(),
        notesId:
          notesId.toString(),
        createdAt:
          createdAt.toISOString(),
        youtubeUrl:
          url,
        sourceType:
          "youtube",
        sourceFileName:
          videoTitle,
      });

    } catch (error) {

      console.error(
        "YouTube transcript error:",
        error
      );

      return res.status(500).json({

        success: false,

        message:
          error.message ||
          "Failed to process YouTube video.",
      });
    }
  }
);

// ======================================================
// GET ALL MATERIALS
// ======================================================

app.get(
  "/api/materials",
  authenticateToken,
  async (req, res) => {

    try {

      const materials =
        await db
          .collection("materials")
          .find({
            userId:
              new ObjectId(
                req.user.userId
              ),
          })
          .sort({
            createdAt:
              -1,
          })
          .toArray();

      return res.json({

        success: true,

        materials:
          materials.map(
            (material) => ({

              id:
                material._id.toString(),

              fileName:
                material.fileName,

              fileType:
                material.fileType,

              fileSize:
                material.fileSize,

              chunkCount:
                material.chunkCount,

              youtubeUrl:
                material.youtubeUrl ||
                null,

              createdAt:
                material.createdAt,

              updatedAt:
                material.updatedAt,
            })
          ),
      });

    } catch (error) {

      console.error(
        "Materials error:",
        error
      );

      return res.status(500).json({

        success: false,

        message:
          "Failed to load materials.",
      });
    }
  }
);

// ======================================================
// GET ALL NOTES
// ======================================================

app.get(
  "/api/notes",
  authenticateToken,
  async (req, res) => {

    try {

      const notes =
        await db
          .collection("notes")
          .find({
            userId:
              new ObjectId(
                req.user.userId
              ),
          })
          .sort({
            createdAt:
              -1,
          })
          .toArray();

      return res.json({

        success: true,

        notes:
          notes.map(
            (note) => ({

              id:
                note._id.toString(),

              materialId:
                note.materialId
                  ? note.materialId.toString()
                  : null,

              title:
                note.title,

              content:
                note.content,

              type:
                note.type ||
                "smart-notes",

              weakTopic:
                note.weakTopic ||
                null,

              weakSubtopic:
                note.weakSubtopic ||
                null,

              sourceFileName:
                note.sourceFileName ||
                note.title ||
                null,

              youtubeUrl:
                note.youtubeUrl ||
                null,

              sourceType:
                note.sourceType ||
                (note.type === "youtube-notes" ? "youtube" : null),

              topics:
                note.topics ||
                [],

              createdAt:
                note.createdAt,

              updatedAt:
                note.updatedAt,
            })
          ),
      });

    } catch (error) {

      console.error(
        "Notes error:",
        error
      );

      return res.status(500).json({

        success: false,

        message:
          "Failed to load notes.",
      });
    }
  }
);


// ======================================================
// GET NOTES FOR A REVISION TASK (by materialId + optional topic)
// ======================================================

app.get(
  "/api/notes/for-task",
  authenticateToken,
  async (req, res) => {
    try {
      const { materialId, topic, subtopic } = req.query;
      if (!materialId || !ObjectId.isValid(materialId)) {
        return res.status(400).json({ success: false, message: "Valid materialId is required." });
      }
      const userId = new ObjectId(req.user.userId);
      const matObjId = new ObjectId(materialId);

      // First try: find a revision note matching topic + subtopic
      let note = null;
      if (topic) {
        const topicLower = String(topic).trim().toLowerCase();
        const subtopicLower = subtopic ? String(subtopic).trim().toLowerCase() : null;
        const candidates = await db.collection("notes").find({
          userId,
          materialId: matObjId,
          type: { $in: ["weak-topic-revision", "weak-topic-complete", "weak-topic"] },
        }).sort({ createdAt: -1 }).toArray();

        for (const c of candidates) {
          const wt = String(c.weakTopic || "").toLowerCase();
          const ws = String(c.weakSubtopic || "").toLowerCase();
          const topicsArr = Array.isArray(c.topics) ? c.topics.map(t =>
            (typeof t === "string" ? t : (t.topic || "")).toLowerCase()
          ) : [];
          const topicMatch = wt === topicLower || topicsArr.includes(topicLower);
          const subtopicMatch = !subtopicLower || ws === subtopicLower || ws.includes(subtopicLower) || subtopicLower.includes(ws);
          if (topicMatch && subtopicMatch) { note = c; break; }
          if (topicMatch) { note = c; } // fallback without subtopic match
        }
      }

      // Second try: find any standard/youtube note for the material
      if (!note) {
        note = await db.collection("notes").findOne({
          userId,
          materialId: matObjId,
          type: { $in: ["smart-notes", "youtube-notes", "standard"] },
        }, { sort: { createdAt: -1 } });
      }

      // Third try: any note for the material
      if (!note) {
        note = await db.collection("notes").findOne(
          { userId, materialId: matObjId },
          { sort: { createdAt: -1 } }
        );
      }

      if (!note) {
        return res.status(404).json({ success: false, message: "No note found for this material." });
      }

      return res.json({
        success: true,
        note: {
          id: note._id.toString(),
          materialId: note.materialId ? note.materialId.toString() : null,
          title: note.title,
          content: note.content,
          type: note.type || "smart-notes",
          weakTopic: note.weakTopic || null,
          weakSubtopic: note.weakSubtopic || null,
          sourceFileName: note.sourceFileName || note.title || null,
          youtubeUrl: note.youtubeUrl || null,
          sourceType: note.sourceType || null,
          topics: note.topics || [],
          createdAt: note.createdAt,
          updatedAt: note.updatedAt,
        },
      });
    } catch (err) {
      console.error("Notes for-task error:", err);
      return res.status(500).json({ success: false, message: "Failed to find note." });
    }
  }
);

// ======================================================
// GET SINGLE NOTE BY ID
// ======================================================

app.get(
  "/api/notes/:id",
  authenticateToken,
  async (req, res) => {
    try {
      const noteId = req.params.id;
      if (!ObjectId.isValid(noteId)) {
        return res.status(400).json({ success: false, message: "Invalid note ID." });
      }
      const note = await db.collection("notes").findOne({
        _id: new ObjectId(noteId),
        userId: new ObjectId(req.user.userId),
      });
      if (!note) {
        return res.status(404).json({ success: false, message: "Note not found." });
      }
      return res.json({
        success: true,
        note: {
          id: note._id.toString(),
          materialId: note.materialId ? note.materialId.toString() : null,
          title: note.title,
          content: note.content,
          type: note.type || "smart-notes",
          weakTopic: note.weakTopic || null,
          weakSubtopic: note.weakSubtopic || null,
          sourceFileName: note.sourceFileName || note.title || null,
          youtubeUrl: note.youtubeUrl || null,
          sourceType: note.sourceType || null,
          topics: note.topics || [],
          createdAt: note.createdAt,
          updatedAt: note.updatedAt,
        },
      });
    } catch (err) {
      console.error("Get single note error:", err);
      return res.status(500).json({ success: false, message: "Failed to load note." });
    }
  }
);

// ======================================================
// GET SINGLE MATERIAL
// ======================================================

app.get(
  "/api/materials/:id",
  authenticateToken,
  async (req, res) => {

    try {

      const materialId =
        req.params.id;

      if (
        !ObjectId.isValid(
          materialId
        )
      ) {

        return res.status(400).json({
          success: false,
          message:
            "Invalid material ID.",
        });
      }

      const material =
        await db
          .collection("materials")
          .findOne({
            _id:
              new ObjectId(
                materialId
              ),

            userId:
              new ObjectId(
                req.user.userId
              ),
          });

      if (!material) {

        return res.status(404).json({
          success: false,
          message:
            "Material not found.",
        });
      }

      return res.json({

        success: true,

        material: {

          id:
            material._id.toString(),

          fileName:
            material.fileName,

          fileType:
            material.fileType,

          fileSize:
            material.fileSize,

          extractedText:
            material.extractedText,

          notes:
            material.notes,

          chunkCount:
            material.chunkCount,

          youtubeUrl:
            material.youtubeUrl ||
            null,

          createdAt:
            material.createdAt,

          updatedAt:
            material.updatedAt,
        },
      });

    } catch (error) {

      console.error(
        "Single material error:",
        error
      );

      return res.status(500).json({

        success: false,

        message:
          "Failed to load material.",
      });
    }
  }
);

// ======================================================
// DELETE MATERIAL
// ======================================================

app.delete(
  "/api/materials/:id",
  authenticateToken,
  async (req, res) => {

    try {

      const materialId =
        req.params.id;

      if (
        !ObjectId.isValid(
          materialId
        )
      ) {

        return res.status(400).json({
          success: false,
          message:
            "Invalid material ID.",
        });
      }

      const objectId =
        new ObjectId(
          materialId
        );

      const material =
        await db
          .collection("materials")
          .findOne({
            _id:
              objectId,

            userId:
              new ObjectId(
                req.user.userId
              ),
          });

      if (!material) {

        return res.status(404).json({
          success: false,
          message:
            "Material not found.",
        });
      }

      // Delete related notes
      await db
        .collection("notes")
        .deleteMany({
          materialId: objectId,
          userId: new ObjectId(req.user.userId),
        });

      // Delete related flashcard decks
      await db
        .collection("flashcards")
        .deleteMany({
          materialId: objectId,
          userId: new ObjectId(req.user.userId),
        });

      // Delete material
      await db
        .collection("materials")
        .deleteOne({

          _id:
            objectId,

          userId:
            new ObjectId(
              req.user.userId
            ),
        });

      // Delete physical uploaded file
      if (
        material.storedFileName
      ) {

        const filePath =
          path.join(
            uploadsDir,
            material.storedFileName
          );

        if (
          fs.existsSync(
            filePath
          )
        ) {

          try {
            fs.unlinkSync(
              filePath
            );
          } catch (e) {
            console.warn(
              "Could not delete file:",
              e.message
            );
          }
        }
      }

      return res.json({

        success: true,

        message:
          "Material deleted successfully.",
      });

    } catch (error) {

      console.error(
        "Delete material error:",
        error
      );

      return res.status(500).json({

        success: false,

        message:
          "Failed to delete material.",
      });
    }
  }
);

// ======================================================
// DELETE NOTE
// ======================================================

app.delete(
  "/api/notes/:id",
  authenticateToken,
  async (req, res) => {

    try {

      const noteId =
        req.params.id;

      if (
        !ObjectId.isValid(
          noteId
        )
      ) {

        return res.status(400).json({
          success: false,
          message:
            "Invalid note ID.",
        });
      }

      const result =
        await db
          .collection("notes")
          .deleteOne({

            _id:
              new ObjectId(
                noteId
              ),

            userId:
              new ObjectId(
                req.user.userId
              ),
          });

      if (
        result.deletedCount ===
        0
      ) {

        return res.status(404).json({
          success: false,
          message:
            "Note not found.",
        });
      }

      return res.json({

        success: true,

        message:
          "Note deleted successfully.",
      });

    } catch (error) {

      console.error(
        "Delete note error:",
        error
      );

      return res.status(500).json({

        success: false,

        message:
          "Failed to delete note.",
      });
    }
  }
);

// ======================================================
// ERROR HANDLER
// ======================================================

app.use(
  (
    error,
    req,
    res,
    next
  ) => {

    console.error(
      "Server error:",
      error
    );

    if (
      error instanceof
      multer.MulterError
    ) {

      if (
        error.code ===
        "LIMIT_FILE_SIZE"
      ) {

        return res.status(400).json({
          success: false,
          message:
            "File size must be less than 10 MB.",
        });
      }

      return res.status(400).json({
        success: false,
        message:
          error.message,
      });
    }

    return res.status(500).json({

      success: false,

      message:
        error.message ||
        "Internal server error.",
    });
  }
);

// ======================================================
// SMART REVISION SCHEDULER
// ======================================================

/**
 * POST /api/revision-plan
 * Generate (or regenerate) a personalised revision plan from the
 * user's latest quiz result and weak topics.
 *
 * PRESERVATION & SEQUENTIAL DATING RULES:
 * 1. Existing tasks and their assigned dates must NEVER be changed, overwritten, or rescheduled.
 * 2. Only genuinely NEW weak topics (not already present in the Revision Scheduler for this user)
 *    are created as new tasks.
 * 3. Newly created tasks are assigned to the next available date strictly AFTER the latest date
 *    already allocated in the existing revision plan (and never on an already allocated date).
 * 4. All tasks in a single regeneration batch are assigned to that same sequential new date.
 * 5. If no new weak topics are identified, zero tasks are created and existing tasks remain untouched.
 */
app.post("/api/revision-plan", authenticateToken, async (req, res) => {
  try {
    const {
      quizId,
      materialId,
      weakTopics,
      score,
      correctCount,
      totalQuestions,
      accuracy,
    } = req.body;
    const userId = new ObjectId(req.user.userId);

    // Fetch all existing revision tasks for this user from MongoDB to preserve them
    const existingTasks = await db.collection("revisionTasks")
      .find({ $or: [{ userId }, { userId: req.user.userId }] })
      .toArray();

    // 1. Identify the exact quiz result associated with this task-generation request
    const cleanQuizId = String(quizId || "").trim();
    let targetQuiz = null;

    if (cleanQuizId) {
      targetQuiz = await db.collection("quizResults").findOne({
        $or: [{ userId }, { userId: req.user.userId }],
        quizId: cleanQuizId,
      });
    }

    // If quizId was not provided or not found, locate the specific quiz by materialId or most recent completed quiz
    if (!targetQuiz) {
      const query = { $or: [{ userId }, { userId: req.user.userId }] };
      if (materialId && ObjectId.isValid(materialId)) {
        query.materialId = new ObjectId(materialId);
      }
      targetQuiz = await db.collection("quizResults")
        .find(query)
        .sort({ completedAt: -1 })
        .limit(1)
        .next();
    }

    // 2. Check that quiz's actual score using correctAnswers / totalQuestions
    let totalQuestionsCount = 0;
    let correctAnswersCount = 0;
    let quizAccuracy = 0;
    let hasQuizStats = false;

    if (targetQuiz) {
      hasQuizStats = true;
      totalQuestionsCount = Number(
        targetQuiz.totalQuestions ||
        (Array.isArray(targetQuiz.questions) ? targetQuiz.questions.length : 0)
      );
      correctAnswersCount = Number(
        targetQuiz.correctCount !== undefined
          ? targetQuiz.correctCount
          : targetQuiz.score !== undefined
          ? targetQuiz.score
          : 0
      );
      quizAccuracy = Number(
        targetQuiz.accuracy !== undefined
          ? targetQuiz.accuracy
          : totalQuestionsCount > 0
          ? (correctAnswersCount / totalQuestionsCount) * 100
          : 0
      );
    } else if (totalQuestions !== undefined && (correctCount !== undefined || score !== undefined)) {
      hasQuizStats = true;
      totalQuestionsCount = Number(totalQuestions || 0);
      correctAnswersCount = Number(correctCount !== undefined ? correctCount : (score || 0));
      quizAccuracy = Number(
        accuracy !== undefined
          ? accuracy
          : totalQuestionsCount > 0
          ? (correctAnswersCount / totalQuestionsCount) * 100
          : 0
      );
    }

    // 3. Exactly 100% check: all questions answered correctly
    const isExact100Percent =
      hasQuizStats &&
      totalQuestionsCount > 0 &&
      (correctAnswersCount === totalQuestionsCount ||
       (correctAnswersCount / totalQuestionsCount) >= 1 ||
       Math.round(quizAccuracy) >= 100);

    if (isExact100Percent) {
      const identifiedQuizId = targetQuiz?.quizId || cleanQuizId || "current";
      console.log(
        `[Revision Plan] Quiz "${identifiedQuizId}" scored 100% (${correctAnswersCount}/${totalQuestionsCount}, accuracy: ${quizAccuracy}%). ZERO tasks generated.`
      );

      return res.json({
        success: true,
        message: "Great job! You scored 100% on this quiz. All questions answered correctly — no revision tasks needed for this quiz.",
        isPerfectScore: true,
        quizId: identifiedQuizId,
        tasksCreated: [],
        existingTasksCount: existingTasks.length,
        lastUpdated: new Date().toISOString(),
      });
    }

    // 4. If the quiz score is below 100%, retain the existing weak-topic-based task generation behaviour
    let cleanWeakTopics = Array.isArray(weakTopics) ? weakTopics.filter(t => t && t.topic) : [];

    // If cleanWeakTopics is empty but we have targetQuiz with incorrect questions, extract weak topics from mistakes
    if (cleanWeakTopics.length === 0 && targetQuiz) {
      if (Array.isArray(targetQuiz.reviewQuestions) && targetQuiz.reviewQuestions.length > 0) {
        const mistakesReview = targetQuiz.reviewQuestions.filter((rq) => !rq.isCorrect && !rq.correct);
        if (mistakesReview.length > 0) {
          const topicStats = {};
          mistakesReview.forEach((rq) => {
            const t = (rq.topic || targetQuiz.topic || "Core Concepts").trim();
            const s = (rq.subtopic || t).trim();
            const k = `${t}|||${s}`;
            if (!topicStats[k]) topicStats[k] = { topic: t, subtopic: s, incorrect: 0 };
            topicStats[k].incorrect += 1;
          });
          cleanWeakTopics = Object.values(topicStats).map((ts) => ({
            topic: ts.topic,
            subtopic: ts.subtopic,
            accuracy: 50,
          }));
        }
      }
    }

    // Fallback: If no weak topics provided, extract topics from user's latest notes or materials ONLY for sub-100% quizzes
    if (cleanWeakTopics.length === 0) {
      const recentNote = await db.collection("notes").findOne(
        { $or: [{ userId }, { userId: req.user.userId }] },
        { sort: { createdAt: -1 } }
      );
      if (recentNote && Array.isArray(recentNote.topics) && recentNote.topics.length > 0) {
        cleanWeakTopics = recentNote.topics.map((t) => ({
          topic: typeof t === "string" ? t : t.topic,
          subtopic: typeof t === "string" ? "" : (t.subtopic || ""),
          accuracy: t.accuracy ?? 60,
        }));
      } else if (recentNote && recentNote.topic) {
        cleanWeakTopics = [{
          topic: recentNote.topic,
          subtopic: recentNote.subtopic || "",
          accuracy: 60,
        }];
      }
    }

    if (cleanWeakTopics.length === 0) {
      return res.json({
        success: true,
        message: "No weak topics identified. Your revision plan is up to date.",
        tasksCreated: [],
        existingTasksCount: existingTasks.length,
        lastUpdated: new Date().toISOString(),
      });
    }

    const cleanQuizIdForNewTasks = targetQuiz?.quizId || cleanQuizId || `quiz-${Date.now()}`;

    // Resolve materialId and materialName
    let cleanMaterialId = null;
    let materialName = "Study Material";
    if (materialId && ObjectId.isValid(materialId)) {
      cleanMaterialId = new ObjectId(materialId);
      const mat = await db.collection("materials").findOne({
        _id: cleanMaterialId,
        $or: [{ userId }, { userId: req.user.userId }],
      });
      if (mat) materialName = mat.fileName || mat.title || "Study Material";
    }

    if (!cleanMaterialId && targetQuiz?.materialId && ObjectId.isValid(targetQuiz.materialId)) {
      cleanMaterialId = new ObjectId(targetQuiz.materialId);
      const mat = await db.collection("materials").findOne({
        _id: cleanMaterialId,
        $or: [{ userId }, { userId: req.user.userId }],
      });
      if (mat) materialName = mat.fileName || mat.title || "Study Material";
    }

    if (!cleanMaterialId) {
      const recentMat = await db.collection("materials").findOne(
        { $or: [{ userId }, { userId: req.user.userId }] },
        { sort: { createdAt: -1 } }
      );
      if (recentMat) {
        cleanMaterialId = recentMat._id;
        materialName = recentMat.fileName || recentMat.title || "Study Material";
      }
    }

    // Helper: format a Date object to YYYY-MM-DD
    const formatDateToYYYYMMDD = (dt) => {
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, "0");
      const d = String(dt.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    };

    // Helper: normalize any date value to YYYY-MM-DD string
    const normalizeDateToYYYYMMDD = (val) => {
      if (!val) return "";
      if (typeof val === "string") {
        const trimmed = val.trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
        if (/^\d{4}-\d{2}-\d{2}T00:00:00/.test(trimmed)) return trimmed.slice(0, 10);
        const dt = new Date(trimmed);
        if (!isNaN(dt.getTime())) return formatDateToYYYYMMDD(dt);
        return trimmed.slice(0, 10);
      }
      if (val instanceof Date && !isNaN(val.getTime())) {
        return formatDateToYYYYMMDD(val);
      }
      return "";
    };

    // Helper: normalize topic and subtopic for consistent deduplication
    const normalizeTopicKey = (topic, subtopic) => {
      const t = String(topic || "").trim().toLowerCase();
      const s = String(subtopic || "").trim().toLowerCase();
      if (s && s !== t && s !== "general topic") {
        return `${t}|||${s}`;
      }
      return t;
    };


    // 2. Identify genuinely NEW weak topics that do not already have a corresponding revision task
    const newWeakTopics = [];
    const seenBatchKeys = new Set();

    for (const wt of cleanWeakTopics) {
      const topic = String(wt.topic || "").trim();
      const subtopic = String(wt.subtopic || "").trim();
      if (!topic) continue;

      const candKey = normalizeTopicKey(topic, subtopic);
      if (seenBatchKeys.has(candKey)) continue;
      seenBatchKeys.add(candKey);

      // Check if already present in the user's Revision Scheduler
      const alreadyExists = existingTasks.some((et) => {
        const etKey = normalizeTopicKey(et.topic, et.subtopic);
        if (etKey !== candKey) return false;
        // If materialId is provided on both, ensure they match as well
        if (et.materialId && cleanMaterialId) {
          return String(et.materialId) === String(cleanMaterialId);
        }
        return true;
      });

      if (!alreadyExists) {
        newWeakTopics.push({
          topic,
          subtopic,
          accuracy: Number(wt.accuracy ?? 0),
        });
      }
    }

    // If no new weak topics, preserve all existing tasks completely untouched
    if (newWeakTopics.length === 0) {
      return res.json({
        success: true,
        message: "Your revision plan is already up to date. No new weak topics to add.",
        tasksCreated: [],
        existingTasksCount: existingTasks.length,
        lastUpdated: new Date().toISOString(),
      });
    }

    // 3. Determine the sequential new date for this batch of new tasks
    // - Must be the next available date strictly AFTER the latest date already allocated
    // - Must never place tasks on dates that already contain existing revision tasks
    // - If plan was completely empty, starts from tomorrow
    const allocatedDateKeys = new Set();
    let maxDateKey = "";

    existingTasks.forEach((t) => {
      const key = t.scheduledDateKey || normalizeDateToYYYYMMDD(t.scheduledDate);
      if (key && /^\d{4}-\d{2}-\d{2}$/.test(key)) {
        allocatedDateKeys.add(key);
        if (!maxDateKey || key > maxDateKey) {
          maxDateKey = key;
        }
      }
    });

    const now = new Date();
    // Tomorrow at noon (12:00:00) to prevent any timezone shifting
    const tomorrowDt = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 12, 0, 0);

    let nextDt;
    if (maxDateKey) {
      const [y, m, d] = maxDateKey.split("-").map(Number);
      nextDt = new Date(y, m - 1, d, 12, 0, 0);
      nextDt.setDate(nextDt.getDate() + 1); // Strictly after latest allocated date
      // If the latest allocated date is in the past, start from tomorrow
      if (nextDt.getTime() < tomorrowDt.getTime()) {
        nextDt = new Date(tomorrowDt);
      }
    } else {
      nextDt = new Date(tomorrowDt);
    }

    // Ensure nextDt does not collide with any already allocated date in the user's plan
    while (allocatedDateKeys.has(formatDateToYYYYMMDD(nextDt))) {
      nextDt.setDate(nextDt.getDate() + 1);
    }

    const assignedDateKey = formatDateToYYYYMMDD(nextDt);
    const assignedScheduledDate = new Date(nextDt);

    // 4. Create new tasks only for the newly identified weak topics
    const tasksCreated = [];

    for (let i = 0; i < newWeakTopics.length; i++) {
      const wt = newWeakTopics[i];
      const { topic, subtopic, accuracy } = wt;

      // Determine priority based on accuracy
      let priority = "Medium";
      if (accuracy < 40) priority = "High";
      else if (accuracy >= 70) priority = "Low";

      // Suggested duration & activity
      const duration = priority === "High" ? "45 min" : priority === "Low" ? "15 min" : "30 min";
      const activityType = accuracy < 40
        ? "Re-read Notes + Practice Quiz"
        : accuracy < 70
        ? "Review Notes + Practice Quiz"
        : "Quick Review + Flashcards";

      const newTaskDoc = {
        userId,
        materialId: cleanMaterialId,
        materialName,
        quizId: cleanQuizIdForNewTasks,
        topic,
        subtopic,
        accuracy,
        priority,
        duration,
        activityType,
        scheduledDate: assignedScheduledDate,
        scheduledDateKey: assignedDateKey,
        status: "Pending",
        requiredScore: 70,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      };

      const result = await db.collection("revisionTasks").insertOne(newTaskDoc);
      tasksCreated.push({
        id: result.insertedId.toString(),
        topic,
        subtopic,
        priority,
        status: "Pending",
        scheduledDate: assignedScheduledDate,
        scheduledDateKey: assignedDateKey,
      });
    }

    return res.json({
      success: true,
      message: `Revision plan updated: Added ${tasksCreated.length} new task(s) for ${assignedDateKey}.`,
      tasksCreated,
      assignedDate: assignedDateKey,
      lastUpdated: now.toISOString(),
    });
  } catch (error) {
    console.error("Generate revision plan error:", error);
    return res.status(500).json({ success: false, message: "Failed to generate revision plan." });
  }
});

/**
 * GET /api/revision-plan
 * Load the authenticated user's saved revision tasks.
 */
app.get("/api/revision-plan", authenticateToken, async (req, res) => {
  try {
    const userId = new ObjectId(req.user.userId);
    const { date } = req.query;

    const normalizeDateToYYYYMMDD = (val) => {
      if (!val) return "";
      if (typeof val === "string") {
        const trimmed = val.trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
        if (/^\d{4}-\d{2}-\d{2}T00:00:00/.test(trimmed)) return trimmed.slice(0, 10);
        const dt = new Date(trimmed);
        if (!isNaN(dt.getTime())) {
          const y = dt.getFullYear();
          const m = String(dt.getMonth() + 1).padStart(2, "0");
          const d = String(dt.getDate()).padStart(2, "0");
          return `${y}-${m}-${d}`;
        }
        return trimmed.slice(0, 10);
      }
      if (val instanceof Date && !isNaN(val.getTime())) {
        const y = val.getFullYear();
        const m = String(val.getMonth() + 1).padStart(2, "0");
        const d = String(val.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
      }
      return "";
    };

    const tasks = await db.collection("revisionTasks")
      .find({ $or: [{ userId }, { userId: req.user.userId }] })
      .sort({ scheduledDate: 1, createdAt: 1, priority: -1 })
      .toArray();

    let filtered = tasks;
    if (date && typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date.trim())) {
      const target = date.trim();
      filtered = tasks.filter((t) => (t.scheduledDateKey || normalizeDateToYYYYMMDD(t.scheduledDate)) === target);
    }

    const mapped = filtered.map((t) => {
      const reqScore = t.requiredScore ?? 70;
      const hasScore =
        t.latestPracticeAccuracy !== null &&
        t.latestPracticeAccuracy !== undefined &&
        !isNaN(Number(t.latestPracticeAccuracy));
      
      // Strict 70% threshold status logic:
      // 1. If attempted and score >= 70% -> Completed
      // 2. If attempted and score < 70% -> In Progress
      // 3. If unattempted -> Pending
      let accurateStatus = "Pending";
      if (hasScore) {
        accurateStatus = Number(t.latestPracticeAccuracy) >= reqScore ? "Completed" : "In Progress";
      } else if (t.status === "In Progress") {
        accurateStatus = "In Progress";
      } else if (t.status === "Completed") {
        accurateStatus = "Pending";
      } else {
        accurateStatus = t.status || "Pending";
      }

      return {
        id: t._id.toString(),
        materialId: t.materialId ? t.materialId.toString() : null,
        materialName: t.materialName || "Study Material",
        quizId: t.quizId || "",
        topic: t.topic,
        subtopic: t.subtopic || "",
        accuracy: t.accuracy ?? 0,
        latestPracticeAccuracy: hasScore ? Number(t.latestPracticeAccuracy) : null,
        priority: t.priority || "Medium",
        duration: t.duration || "30 min",
        activityType: t.activityType || "Review Notes",
        scheduledDate: t.scheduledDate,
        scheduledDateKey: t.scheduledDateKey || normalizeDateToYYYYMMDD(t.scheduledDate),
        status: accurateStatus,
        requiredScore: reqScore,
        completedAt: accurateStatus === "Completed" ? (t.completedAt || new Date()) : null,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt || t.createdAt,
      };
    });

    return res.json({ success: true, tasks: mapped });
  } catch (error) {
    console.error("Load revision plan error:", error);
    return res.status(500).json({ success: false, message: "Failed to load revision plan." });
  }
});

/**
 * GET /api/revision-tasks/:taskId
 * Load a single revision task by ID with verified material metadata.
 */
app.get("/api/revision-tasks/:taskId", authenticateToken, async (req, res) => {
  try {
    const { taskId } = req.params;
    if (!taskId || !ObjectId.isValid(taskId)) {
      return res.status(400).json({ success: false, message: "Invalid taskId." });
    }
    const userId = new ObjectId(req.user.userId);
    const task = await db.collection("revisionTasks").findOne({
      _id: new ObjectId(taskId),
      $or: [{ userId }, { userId: req.user.userId }],
    });
    if (!task) {
      return res.status(404).json({ success: false, message: "Revision task not found." });
    }

    let materialName = task.materialName || "Study Material";
    if (task.materialId && ObjectId.isValid(task.materialId)) {
      const mat = await db.collection("materials").findOne({ _id: new ObjectId(task.materialId) });
      if (mat && mat.fileName) {
        materialName = mat.fileName;
      }
    }

    const reqScore = task.requiredScore ?? 70;
    const hasScore =
      task.latestPracticeAccuracy !== null &&
      task.latestPracticeAccuracy !== undefined &&
      !isNaN(Number(task.latestPracticeAccuracy));
    let accurateStatus = "Pending";
    if (hasScore) {
      accurateStatus = Number(task.latestPracticeAccuracy) >= reqScore ? "Completed" : "In Progress";
    } else {
      accurateStatus = task.status || "Pending";
    }

    return res.json({
      success: true,
      task: {
        id: task._id.toString(),
        taskId: task._id.toString(),
        materialId: task.materialId ? task.materialId.toString() : null,
        materialName,
        quizId: task.quizId || "",
        topic: task.topic,
        subtopic: task.subtopic || "",
        accuracy: task.accuracy ?? 0,
        latestPracticeAccuracy: hasScore ? Number(task.latestPracticeAccuracy) : null,
        priority: task.priority || "Medium",
        duration: task.duration || "30 min",
        activityType: task.activityType || "Review Notes",
        scheduledDate: task.scheduledDate,
        status: accurateStatus,
        requiredScore: reqScore,
      },
    });
  } catch (err) {
    console.error("Get revision task error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch revision task." });
  }
});

/**
 * PATCH /api/revision-plan/:taskId
 * Mark a task as Completed or Pending (toggle).
 */
app.patch("/api/revision-plan/:taskId", authenticateToken, async (req, res) => {
  try {
    const { taskId } = req.params;
    const { status } = req.body;
    const userId = new ObjectId(req.user.userId);

    if (!ObjectId.isValid(taskId)) {
      return res.status(400).json({ success: false, message: "Invalid task ID." });
    }
    if (!["Pending", "Completed", "In Progress"].includes(status)) {
      return res.status(400).json({ success: false, message: "Status must be Pending, In Progress, or Completed." });
    }

    const task = await db.collection("revisionTasks").findOne({
      _id: new ObjectId(taskId),
      $or: [{ userId }, { userId: req.user.userId }],
    });

    if (!task) {
      return res.status(404).json({ success: false, message: "Task not found." });
    }

    if (status === "Completed") {
      // Validate a qualifying Practice Quiz score of 70% or above
      const taskTopic = String(task.topic || "").trim();
      const taskSubtopic = String(task.subtopic || "").trim();

      const attemptQuery = {
        userId,
        topic: taskTopic,
        accuracy: { $gte: 70 },
      };
      if (taskSubtopic) {
        attemptQuery.subtopic = taskSubtopic;
      }

      const qualifyingAttempt = await db.collection("practiceAttempts").findOne(
        attemptQuery,
        { sort: { completedAt: -1 } }
      );

      const hasQualifyingScore =
        qualifyingAttempt ||
        (task.latestPracticeAccuracy !== undefined &&
          task.latestPracticeAccuracy !== null &&
          Number(task.latestPracticeAccuracy) >= 70);

      if (!hasQualifyingScore) {
        return res.status(400).json({
          success: false,
          message: "Cannot mark task as Completed without a qualifying Practice Quiz score of 70% or above. Please complete the Practice Quiz first.",
          requiresQuiz: true,
        });
      }
    }

    const update = {
      $set: {
        status,
        updatedAt: new Date(),
        completedAt: status === "Completed" ? new Date() : null,
      },
    };

    await db.collection("revisionTasks").updateOne(
      { _id: new ObjectId(taskId), userId },
      update
    );

    return res.json({ success: true, message: `Task marked as ${status}.` });
  } catch (error) {
    console.error("Update revision task error:", error);
    return res.status(500).json({ success: false, message: "Failed to update task." });
  }
});

// ======================================================
// CONTACT FORM EMAIL SUBMISSION (NODEMAILER GMAIL SMTP)
// ======================================================

app.post("/api/contact", async (req, res) => {
  try {
    const { name, email, subject, message } = req.body || {};

    const cleanName = typeof name === "string" ? name.trim() : "";
    const cleanEmail = typeof email === "string" ? email.trim() : "";
    const cleanSubject = typeof subject === "string" && subject.trim() ? subject.trim() : "EduGenAI General Inquiry";
    const cleanMessage = typeof message === "string" ? message.trim() : "";

    // 1. Validation
    if (!cleanName) {
      return res.status(400).json({ success: false, message: "Please provide your name." });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!cleanEmail || !emailRegex.test(cleanEmail)) {
      return res.status(400).json({ success: false, message: "Please provide a valid email address." });
    }

    if (!cleanMessage) {
      return res.status(400).json({ success: false, message: "Please provide a message." });
    }

    // 2. Read SMTP credentials securely from environment
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = (process.env.SMTP_APP_PASSWORD || "").trim().replace(/\s+/g, "");
    const receiverEmail = process.env.CONTACT_RECEIVER_EMAIL || "sivaranjani8807@gmail.com";

    if (!smtpUser || !smtpPass) {
      console.warn("Contact form submission received, but SMTP credentials are not fully set in .env.");
      return res.status(500).json({
        success: false,
        message: "Email service is not configured on the server. Please ensure SMTP_USER and SMTP_APP_PASSWORD are set in server/.env.",
      });
    }

    // 3. Create Gmail SMTP Transporter
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    // 4. Format Submission Date & Time
    const submissionTime = new Date().toLocaleString("en-US", {
      dateStyle: "full",
      timeStyle: "long",
      timeZone: "Asia/Kolkata",
    }) + " (IST)";

    // 5. Construct Email
    const mailOptions = {
      from: `"EduGenAI Contact Form" <${smtpUser}>`,
      to: receiverEmail,
      replyTo: cleanEmail,
      subject: `[EduGenAI Contact] ${cleanSubject} - from ${cleanName}`,
      text: `=========================================
EDUGENAI CONTACT FORM SUBMISSION
=========================================

Sender Name:
${cleanName}

Sender Email Address:
${cleanEmail}

Subject:
${cleanSubject}

Submission Date and Time:
${submissionTime}

Message:
${cleanMessage}

=========================================
Sent via EduGenAI Contact Us Form
=========================================`,
      html: `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8f7ff; margin: 0; padding: 24px; color: #1e1b4b; }
    .email-card { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 14px; border: 1px solid #ede9fe; overflow: hidden; box-shadow: 0 4px 18px rgba(109, 40, 217, 0.07); }
    .email-header { background: linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%); color: #ffffff; padding: 26px 28px; text-align: left; }
    .email-header h1 { margin: 0 0 6px; font-size: 20px; font-weight: 800; }
    .email-header p { margin: 0; font-size: 13px; opacity: 0.9; }
    .email-content { padding: 28px; }
    .field-row { margin-bottom: 18px; }
    .field-label { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b; letter-spacing: 0.05em; margin-bottom: 5px; }
    .field-value { font-size: 15px; color: #0f172a; font-weight: 600; }
    .field-value a { color: #7c3aed; text-decoration: none; }
    .message-card { background: #faf8ff; border: 1px solid #e9e3ff; border-radius: 10px; padding: 18px; margin-top: 6px; white-space: pre-wrap; font-size: 14px; line-height: 1.6; color: #334155; }
    .email-footer { background: #f8fafc; padding: 16px 28px; font-size: 12px; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; }
  </style>
</head>
<body>
  <div class="email-card">
    <div class="email-header">
      <h1>New Contact Form Submission</h1>
      <p>A visitor has sent a message via the EduGenAI Contact Us form</p>
    </div>
    <div class="email-content">
      <div class="field-row">
        <div class="field-label">Sender Name</div>
        <div class="field-value">${cleanName}</div>
      </div>
      <div class="field-row">
        <div class="field-label">Sender Email Address</div>
        <div class="field-value"><a href="mailto:${cleanEmail}">${cleanEmail}</a></div>
      </div>
      <div class="field-row">
        <div class="field-label">Subject</div>
        <div class="field-value">${cleanSubject}</div>
      </div>
      <div class="field-row">
        <div class="field-label">Submission Date and Time</div>
        <div class="field-value">${submissionTime}</div>
      </div>
      <div class="field-row">
        <div class="field-label">Message</div>
        <div class="message-card">${cleanMessage}</div>
      </div>
    </div>
    <div class="email-footer">
      EduGenAI Learning Assistant &bull; Sent automatically from Contact Us form
    </div>
  </div>
</body>
</html>`,
    };

    // 6. Deliver Mail
    const info = await transporter.sendMail(mailOptions);
    console.log(`[Contact Form] Email successfully delivered to ${receiverEmail}. MessageId: ${info.messageId}`);

    return res.status(200).json({
      success: true,
      message: "Your message has been sent successfully! We will contact you soon.",
      messageId: info.messageId,
    });
  } catch (err) {
    console.error("[Contact Form] Email send error:", err);
    return res.status(500).json({
      success: false,
      message: `Failed to send email: ${err.message || "Internal server error"}`,
    });
  }
});

// ======================================================
// START SERVER
// ======================================================

async function startServer() {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`AI Model: ${GROQ_MODEL}`);
    console.log("--------------------------------------------------");
    console.log("EduGenAI Configuration & SMTP Status:");
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = (process.env.SMTP_APP_PASSWORD || "").trim().replace(/\s+/g, "");
    const receiver = process.env.CONTACT_RECEIVER_EMAIL || smtpUser;

    console.log(`- SMTP_USER:              ${smtpUser ? "Present (" + smtpUser.replace(/(?<=.).(?=.*@)/g, "*") + ")" : "MISSING"}`);
    console.log(`- SMTP_APP_PASSWORD:      ${smtpPass ? "Present (" + smtpPass.length + " chars)" : "MISSING"}`);
    console.log(`- CONTACT_RECEIVER_EMAIL: ${receiver ? "Present (" + receiver.replace(/(?<=.).(?=.*@)/g, "*") + ")" : "MISSING"}`);
    console.log("--------------------------------------------------");
  });

  const tryConnect = async (retries = 10) => {
    try {
      await connectDatabase();
    } catch (err) {
      console.warn(`MongoDB connection attempt failed (${err.message}). Retrying in 3s...`);
      if (retries > 0) {
        setTimeout(() => tryConnect(retries - 1), 3000);
      }
    }
  };

  await tryConnect();
}

startServer();
