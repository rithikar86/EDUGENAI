import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import Navbar from "../components/Navbar";
import "../styles/Quiz.css";

function Quiz() {
  const navigate = useNavigate();
  const location = useLocation();

  // Guard against React StrictMode double-invocation of useEffect
  const initializingRef = useRef(false);

  const [selectedNote, setSelectedNote] = useState(null);
  const [selectedDifficulty, setSelectedDifficulty] = useState(null);

  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [answers, setAnswers] = useState({});

  const [quizCompleted, setQuizCompleted] = useState(false);
  const [quizResult, setQuizResult] = useState(null);
  const [analyzingWeakTopics, setAnalyzingWeakTopics] = useState(false);
  const [analysisError, setAnalysisError] = useState("");

  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [showExplanation, setShowExplanation] = useState(false);

  const [practiceMode, setPracticeMode] = useState(false);
  const [practiceInitializing, setPracticeInitializing] = useState(false); // true while weakTopicQuiz is being set up
  const [practiceResult, setPracticeResult] = useState(null); // stores result data for practice quiz result view
  const [practiceTopic, setPracticeTopic] = useState("");
  const [practiceSubtopic, setPracticeSubtopic] = useState("");
  const [practiceMaterialId, setPracticeMaterialId] = useState("");
  const [practiceMaterialName, setPracticeMaterialName] = useState("");
  const [practiceRequiredScore, setPracticeRequiredScore] = useState(70);
  const [practiceHasPreviousAttempt, setPracticeHasPreviousAttempt] = useState(false);
  const [practicePreviousAccuracy, setPracticePreviousAccuracy] = useState(0);
  const [practicePreviousCorrect, setPracticePreviousCorrect] = useState(0);
  const [practicePreviousWrong, setPracticePreviousWrong] = useState(0);
  const [practiceTaskId, setPracticeTaskId] = useState("");
  const [practiceReturnPath, setPracticeReturnPath] = useState("");
  const [sourceWarning, setSourceWarning] = useState("");
  const [collapsedQuestions, setCollapsedQuestions] = useState({});

  // =========================================================
  // RECENT QUESTION TRACKING (PREVENT QUESTION REPETITION)
  // =========================================================

  const getRecentlySeenQuestionTexts = () => {
    try {
      const stored = sessionStorage.getItem("seenQuizQuestionTexts");
      const parsed = stored ? JSON.parse(stored) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  };

  const recordRecentlySeenQuestions = (newQuestions) => {
    if (!Array.isArray(newQuestions) || newQuestions.length === 0) return;
    try {
      const existing = getRecentlySeenQuestionTexts();
      const newTexts = newQuestions
        .map((q) => (q.question || q.questionText || q.text || "").trim())
        .filter(Boolean);
      const combined = Array.from(new Set([...existing, ...newTexts])).slice(-150);
      sessionStorage.setItem("seenQuizQuestionTexts", JSON.stringify(combined));
    } catch (e) {
      console.warn("Could not save recently seen questions to sessionStorage:", e);
    }
  };

  // =========================================================
  // TOKEN
  // =========================================================

  const getToken = () => {
    return (
      localStorage.getItem("token") ||
      sessionStorage.getItem("token") ||
      ""
    );
  };

  // =========================================================
  // FORMAT QUESTIONS
  // =========================================================

  const formatQuestions = (
    quiz,
    defaultDifficulty = "Intermediate"
  ) => {
    if (!Array.isArray(quiz)) return [];

    return quiz
      .filter(
        (q) =>
          q &&
          (q.question || q.questionText || q.text) &&
          Array.isArray(q.options) &&
          q.options.length >= 2
      )
      .map((q, index) => {
        let answer =
          q.answer ??
          q.correctAnswer ??
          q.correct ??
          q.correctOption ??
          0;

        if (typeof answer === "string") {
          const cleaned = answer.trim();

          if (/^[A-Da-d]$/.test(cleaned)) {
            answer =
              cleaned.toUpperCase().charCodeAt(0) - 65;
          } else if (!isNaN(Number(cleaned))) {
            answer = Number(cleaned);
          } else {
            const foundIndex = q.options.findIndex(
              (opt) =>
                String(opt).trim().toLowerCase() ===
                cleaned.toLowerCase()
            );

            answer = foundIndex >= 0 ? foundIndex : 0;
          }
        }

        answer = Number(answer);

        if (
          answer < 0 ||
          answer >= q.options.length ||
          Number.isNaN(answer)
        ) {
          answer = 0;
        }

        const rawTopic = String(
          q.topic ||
            q.topicName ||
            q.category ||
            q.concept ||
            q.subject ||
            ""
        ).trim();

        const displayTopic =
          rawTopic &&
          rawTopic.toLowerCase() !== "general topic"
            ? rawTopic
            : "Core Concepts";

        return {
          id:
            q.id ||
            `${Date.now()}-${index}-${Math.random()
              .toString(36)
              .slice(2)}`,

          question: String(
            q.question ||
              q.questionText ||
              q.text
          ).trim(),

          options: q.options.map((opt) =>
            String(opt).trim()
          ),

          answer,

          explanation: String(
            q.explanation || ""
          ).trim(),

          topic: displayTopic,

          subtopic: String(
            q.subtopic ||
              q.subTopic ||
              q.subtopicName ||
              ""
          ).trim(),

          difficulty:
            q.difficulty || defaultDifficulty,

          materialId:
            q.materialId ||
            localStorage.getItem("activeMaterialId") ||
            "",
        };
      });
  };

  // =========================================================
  // LOAD EXISTING QUIZ
  // =========================================================

  const loadExistingQuiz = (targetMaterialId) => {
    if (localStorage.getItem("weakTopicQuiz")) {
      return false;
    }

    // If quiz was already completed, do NOT restore it as an active quiz
    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.get("view") !== "result") {
      const lastResult = localStorage.getItem("lastQuizResult");
      const savedQuestions = localStorage.getItem("quizQuestions");
      if (lastResult && savedQuestions) {
        try {
          const parsedResult = JSON.parse(lastResult);
          const parsedQuestions = JSON.parse(savedQuestions);
          const resultQIds = new Set((parsedResult.questions || []).map((q) => q.id || q.question));
          if (parsedQuestions.length > 0 && parsedQuestions.every((q) => resultQIds.has(q.id || q.question))) {
            localStorage.removeItem("quizQuestions");
            localStorage.removeItem("aiQuiz");
            localStorage.removeItem("quizData");
            localStorage.removeItem("generatedQuiz");
            return false;
          }
        } catch (e) {
          // ignore
        }
      }
    }

    const keys = [
      "quizQuestions",
      "aiQuiz",
      "quizData",
      "generatedQuiz",
    ];

    for (const key of keys) {
      const saved = localStorage.getItem(key);

      if (!saved) continue;

      try {
        const parsed = JSON.parse(saved);

        const quiz = Array.isArray(parsed)
          ? parsed
          : parsed &&
            Array.isArray(parsed.questions)
          ? parsed.questions
          : [];

        const formatted = formatQuestions(quiz);

        if (formatted.length > 0) {
          const cachedMatId =
            formatted[0]?.materialId;

          if (
            targetMaterialId &&
            cachedMatId &&
            String(cachedMatId) !==
              String(targetMaterialId)
          ) {
            localStorage.removeItem(key);
            continue;
          }

          setQuestions(formatted);

          if (formatted[0]?.difficulty) {
            setSelectedDifficulty(
              formatted[0].difficulty.toLowerCase()
            );
          }

          return true;
        }
      } catch (err) {
        console.error(
          `Unable to read ${key}:`,
          err
        );
      }
    }

    return false;
  };

  // =========================================================
  // WEAK TOPIC QUIZ REQUEST
  // =========================================================

  const getWeakTopicQuizRequest = () => {
    const saved =
      localStorage.getItem("weakTopicQuiz");

    if (!saved) return null;

    try {
      const parsed = JSON.parse(saved);

      if (parsed && parsed.topic) {
        return parsed;
      }
    } catch (err) {
      console.error(
        "Unable to read weak topic quiz request:",
        err
      );
    }

    return null;
  };

  // =========================================================
  // INITIALIZE
  // =========================================================

  useEffect(() => {
    let isCancelled = false;

    const initializeQuiz = async () => {
      // Prevent concurrent duplicate executions during component lifecycle
      if (initializingRef.current) return;
      initializingRef.current = true;

      setLoading(true);

      const searchParams = new URLSearchParams(window.location.search);
      const isResultView =
        searchParams.get("view") === "result" ||
        window.location.pathname === "/quiz-result";

      const taskIdFromUrl = searchParams.get("taskId");

      // CASE 1: PRACTICE QUIZ RESULT VIEW (on page refresh / explicit result view)
      if (isResultView) {
        let savedPracticeResult = null;
        try {
          savedPracticeResult = JSON.parse(
            localStorage.getItem("activePracticeResult") || "null"
          );
        } catch (e) {}

        const matchesTask = !taskIdFromUrl || (savedPracticeResult && String(savedPracticeResult.taskId) === String(taskIdFromUrl));

        if (
          savedPracticeResult &&
          matchesTask &&
          Array.isArray(savedPracticeResult.reviewQuestions) &&
          savedPracticeResult.reviewQuestions.length > 0
        ) {
          if (isCancelled) return;
          setPracticeResult(savedPracticeResult);
          setPracticeMode(true);
          const effectiveId = taskIdFromUrl || savedPracticeResult.taskId || "";
          setPracticeTaskId(effectiveId);
          setPracticeTopic(savedPracticeResult.topic || "");
          setPracticeSubtopic(savedPracticeResult.subtopic || "");
          setPracticeMaterialId(savedPracticeResult.materialId || "");
          setPracticeMaterialName(savedPracticeResult.materialName || "Study Material");
          setPracticeRequiredScore(savedPracticeResult.requiredScore || 70);
          setPracticeHasPreviousAttempt(Boolean(savedPracticeResult.hasPreviousAttempt));
          setPracticePreviousAccuracy(savedPracticeResult.prevAccuracy || 0);
          setLoading(false);
          return;
        }

        // MongoDB Fallback: fetch latest practice attempt if local state was wiped and taskId is available
        const fallbackTaskId = taskIdFromUrl || (savedPracticeResult && savedPracticeResult.taskId);
        if (fallbackTaskId) {
          const token = getToken();
          if (token) {
            try {
              const res = await fetch(`http://localhost:5000/api/practice-attempts/latest?taskId=${encodeURIComponent(fallbackTaskId)}`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              const data = await res.json();
              if (res.ok && data.success && data.attempt) {
                if (isCancelled) return;
                const a = data.attempt;
                const hasPrev = a.previousAccuracy !== undefined && a.previousAccuracy !== null && a.previousAccuracy > 0;
                const restored = {
                  topic: a.topic,
                  subtopic: a.subtopic || "",
                  percentage: a.accuracy,
                  correctCount: a.correctCount,
                  incorrectCount: a.incorrectCount,
                  totalQuestions: a.totalQuestions || 10,
                  hasPreviousAttempt: hasPrev,
                  prevAccuracy: a.previousAccuracy || 0,
                  improvement: a.improvement || 0,
                  requiredScore: a.requiredScore || 70,
                  passed: a.accuracy >= (a.requiredScore || 70),
                  returnPath: "/weak-topics",
                  taskId: fallbackTaskId,
                  materialId: a.materialId,
                  materialName: a.materialName || "Study Material",
                  reviewQuestions: a.reviewQuestions || [],
                  attemptedAt: a.completedAt,
                };
                setPracticeResult(restored);
                setPracticeMode(true);
                setPracticeTaskId(fallbackTaskId);
                setPracticeTopic(restored.topic);
                setPracticeSubtopic(restored.subtopic);
                setPracticeMaterialId(restored.materialId);
                setPracticeMaterialName(restored.materialName);
                setPracticeRequiredScore(restored.requiredScore);
                setPracticeHasPreviousAttempt(hasPrev);
                setPracticePreviousAccuracy(restored.prevAccuracy);
                setLoading(false);
                return;
              }
            } catch (e) {
              console.warn("Could not fetch latest practice attempt from server:", e);
            }
          }
        }

        // If we reach here for an explicit practice task result view and neither local storage nor server had results:
        if (taskIdFromUrl) {
          setLoading(false);
          setPracticeMode(true);
          setPracticeTaskId(taskIdFromUrl);
          setError("No saved practice quiz results found for this revision task. Please attempt a fresh practice quiz.");
          return;
        }
      }

      // CASE 2: NORMAL QUIZ RESULT VIEW
      if (isResultView) {
        let savedLastResult = null;
        try {
          savedLastResult = JSON.parse(
            localStorage.getItem("lastQuizResult") || "null"
          );
        } catch (e) {}

        if (
          savedLastResult &&
          savedLastResult.quizId &&
          savedLastResult.answers &&
          Array.isArray(savedLastResult.questions) &&
          savedLastResult.questions.length > 0
        ) {
          setQuestions(savedLastResult.questions || []);
          setAnswers(savedLastResult.answers || {});
          setQuizResult(savedLastResult);
          setQuizCompleted(true);
          setLoading(false);
          return;
        }

        // MongoDB Fallback: fetch latest normal quiz result from server
        const token = getToken();
        if (token) {
          try {
            const res = await fetch("http://localhost:5000/api/quiz-results/latest", {
              headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json();
            if (res.ok && data.success && data.result) {
              const r = data.result;
              setQuestions(r.questions || []);
              setAnswers(r.answers || {});
              setQuizResult(r);
              setQuizCompleted(true);
              setLoading(false);
              return;
            }
          } catch (e) {
            console.warn("Could not fetch latest quiz result from server:", e);
          }
        }
      }

      // CASE 3: TASK-SPECIFIC PRACTICE QUIZ INITIALIZATION (when taskId or topic is present in URL)
      const topicFromUrl = searchParams.get("topic");
      const isPracticeRequest = Boolean(taskIdFromUrl || topicFromUrl);

      if (isPracticeRequest && !isResultView) {
        setPracticeMode(true);
        if (taskIdFromUrl) setPracticeTaskId(taskIdFromUrl);
        setPracticeInitializing(true);

        // First check query params
        let targetTopic = searchParams.get("topic") || "";
        let targetSubtopic = searchParams.get("subtopic") || "";
        let targetMaterialId = searchParams.get("materialId") || "";
        let targetMaterialName = searchParams.get("materialName") || "";
        let targetRequiredScore = Number(searchParams.get("requiredScore") || 70);
        let targetPrevAccuracy = searchParams.get("previousAccuracy") ? Number(searchParams.get("previousAccuracy")) : null;
        const targetReturnPath = searchParams.get("returnPath") || "/weak-topics";
        let hasPriorAttempt = searchParams.get("hasPreviousAttempt") === "true";

        // Check stored task payload fallback
        let storedTask = null;
        try {
          storedTask = JSON.parse(
            localStorage.getItem("activePracticeTask") ||
            localStorage.getItem("weakTopicQuiz") ||
            "null"
          );
          if (storedTask && String(storedTask.taskId) === String(taskIdFromUrl)) {
            if (!targetTopic) targetTopic = storedTask.topic || "";
            if (!targetSubtopic) targetSubtopic = storedTask.subtopic || "";
            if (!targetMaterialId) targetMaterialId = storedTask.materialId || "";
            if (!targetMaterialName) targetMaterialName = storedTask.materialName || "";
            if (storedTask.requiredScore) targetRequiredScore = Number(storedTask.requiredScore);
            if (storedTask.previousAccuracy !== undefined && storedTask.previousAccuracy !== null) {
              targetPrevAccuracy = Number(storedTask.previousAccuracy);
            }
            if (storedTask.hasPreviousAttempt !== undefined) {
              hasPriorAttempt = Boolean(storedTask.hasPreviousAttempt);
            }
          }
        } catch (e) {}

        // If topic or material is still missing, fetch task directly from backend
        if (!targetTopic || !targetMaterialId) {
          try {
            const token = getToken();
            if (token) {
              const taskRes = await fetch(`http://localhost:5000/api/revision-tasks/${encodeURIComponent(taskIdFromUrl)}`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              const taskData = await taskRes.json();
              if (taskRes.ok && taskData.success && taskData.task) {
                targetTopic = targetTopic || taskData.task.topic || "";
                targetSubtopic = targetSubtopic || taskData.task.subtopic || "";
                targetMaterialId = targetMaterialId || taskData.task.materialId || "";
                targetMaterialName = targetMaterialName || taskData.task.materialName || "Study Material";
                targetRequiredScore = taskData.task.requiredScore || targetRequiredScore;
                if (taskData.task.latestPracticeAccuracy !== null && taskData.task.latestPracticeAccuracy !== undefined) {
                  targetPrevAccuracy = taskData.task.latestPracticeAccuracy;
                  hasPriorAttempt = true;
                }
              }
            }
          } catch (e) {
            console.warn("Could not fetch revision task details from server:", e);
          }
        }

        setPracticeTopic(targetTopic);
        setPracticeSubtopic(targetSubtopic);
        setPracticeMaterialId(targetMaterialId);
        setPracticeMaterialName(targetMaterialName || "Study Material");
        setPracticeRequiredScore(targetRequiredScore);
        setPracticeHasPreviousAttempt(hasPriorAttempt);
        setPracticePreviousAccuracy(targetPrevAccuracy || 0);
        setPracticeReturnPath(targetReturnPath);

        await generateWeakTopicPracticeQuiz({
          taskId: taskIdFromUrl || undefined,
          topic: targetTopic,
          subtopic: targetSubtopic,
          materialId: targetMaterialId,
          materialName: targetMaterialName,
          requiredScore: targetRequiredScore,
          hasPreviousAttempt: hasPriorAttempt,
          previousAccuracy: targetPrevAccuracy,
          returnPath: targetReturnPath,
        });

        setPracticeInitializing(false);
        return; // NEVER fall through to normal generic quiz difficulty selection!
      }

      // CASE 4: WEAK TOPIC PRACTICE QUIZ (WeakTopics page fallback)
      const weakRequest =
        getWeakTopicQuizRequest();

      if (weakRequest) {
        setPracticeInitializing(true);
        await generateWeakTopicPracticeQuiz(
          weakRequest
        );
        setPracticeInitializing(false);
        return;
      }

      const urlMaterialId =
        searchParams.get("materialId");

      let foundNote = null;

      const selectedNoteStr =
        localStorage.getItem(
          "selectedQuizNote"
        );

      if (selectedNoteStr) {
        try {
          foundNote =
            JSON.parse(selectedNoteStr);
        } catch (e) {
          foundNote = null;
        }
      }

      const allNotes = JSON.parse(
        localStorage.getItem("smartNotes") ||
          "[]"
      );

      if (urlMaterialId) {
        const matched = allNotes.find(
          (n) =>
            String(n.materialId) ===
              String(urlMaterialId) ||
            String(n.id) ===
              String(urlMaterialId)
        );

        if (matched) {
          foundNote = matched;

          localStorage.setItem(
            "selectedQuizNote",
            JSON.stringify(matched)
          );

          localStorage.setItem(
            "activeMaterialId",
            urlMaterialId
          );
        }
      }

      if (
        !foundNote &&
        Array.isArray(allNotes) &&
        allNotes.length > 0
      ) {
        foundNote = allNotes[0];

        localStorage.setItem(
          "selectedQuizNote",
          JSON.stringify(foundNote)
        );
      }

      if (foundNote) {
        setSelectedNote(foundNote);

        const targetMatId =
          urlMaterialId ||
          foundNote.materialId ||
          foundNote.id ||
          localStorage.getItem(
            "activeMaterialId"
          ) ||
          "";

        loadExistingQuiz(targetMatId);
      } else {
        setSelectedNote(null);
      }

      setLoading(false);
    };

    initializeQuiz();

    return () => {
      isCancelled = true;
      initializingRef.current = false;
    };
  }, []);

  // =========================================================
  // DIFFICULTY
  // =========================================================

  const handleDifficultySelect = async (
    difficultyLevel
  ) => {
    if (generating) return;
    setSelectedDifficulty(
      difficultyLevel
    );

    await startNewQuizGeneration(
      difficultyLevel
    );
  };

  // =========================================================
  // NORMAL QUIZ GENERATION
  // =========================================================

  const startNewQuizGeneration = async (
    difficultyLevel
  ) => {
    if (generating) return;
    const token = getToken();

    if (!token) {
      setError("Please login again.");
      setLoading(false);
      return;
    }

    const searchParams =
      new URLSearchParams(
        window.location.search
      );

    const urlMaterialId =
      searchParams.get("materialId");

    let noteToUse = selectedNote;

    if (!noteToUse) {
      const selectedNoteStr =
        localStorage.getItem(
          "selectedQuizNote"
        );

      if (selectedNoteStr) {
        try {
          noteToUse =
            JSON.parse(selectedNoteStr);
        } catch (e) {
          noteToUse = null;
        }
      }
    }

    const materialId =
      urlMaterialId ||
      noteToUse?.materialId ||
      noteToUse?.id ||
      localStorage.getItem(
        "activeMaterialId"
      ) ||
      "";

    const notesContent =
      noteToUse?.notes ||
      noteToUse?.content ||
      "";

    const materialTitle =
      noteToUse?.sourceFileName ||
      noteToUse?.fileName ||
      noteToUse?.title ||
      "Study Material";

    if (
      !notesContent ||
      notesContent.trim().length < 20
    ) {
      setError(
        "Please select a Smart Note before starting a quiz."
      );

      setLoading(false);
      return;
    }

    // Clear stale active questions
    localStorage.removeItem("quizQuestions");
    localStorage.removeItem("aiQuiz");
    localStorage.removeItem("quizData");
    localStorage.removeItem("generatedQuiz");

    setGenerating(true);
    setError("");
    setSourceWarning("");

    try {
      const recentQuestions = getRecentlySeenQuestionTexts();

      const response = await fetch(
        "http://localhost:5000/api/generate-quiz",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            Authorization:
              `Bearer ${token}`,
          },

          body: JSON.stringify({
            notes: notesContent,
            count: 10,
            materialId,
            materialTitle,
            difficulty:
              difficultyLevel,
            previousQuestions: recentQuestions,
          }),
        }
      );

      const data =
        await response.json();

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.message ||
            "Unable to generate quiz."
        );
      }

      if (data.limitedSourceWarning) {
        setSourceWarning(data.limitedSourceWarning);
      }

      const diffLabel =
        difficultyLevel
          .charAt(0)
          .toUpperCase() +
        difficultyLevel.slice(1);

      const formattedQuestions =
        formatQuestions(
          data.questions,
          diffLabel
        );

      if (
        formattedQuestions.length === 0
      ) {
        throw new Error(
          "AI did not return valid quiz questions."
        );
      }

      // Record seen questions to avoid repeating in subsequent quizzes
      recordRecentlySeenQuestions(formattedQuestions);

      const enrichedQuestions =
        formattedQuestions.map(
          (q) => ({
            ...q,

            materialId:
              materialId ||
              q.materialId ||
              "",

            difficulty:
              diffLabel,
          })
        );

      localStorage.setItem(
        "quizQuestions",
        JSON.stringify(
          enrichedQuestions
        )
      );

      localStorage.setItem(
        "aiQuiz",
        JSON.stringify(
          enrichedQuestions
        )
      );

      setQuestions(
        enrichedQuestions
      );

      setCurrentIndex(0);
      setSelectedAnswer(null);
      setAnswers({});
      setQuizCompleted(false);

      setPracticeMode(false);
      setPracticeTopic("");
      setPracticeSubtopic("");

      setShowExplanation(false);
      setError("");
    } catch (err) {
      console.error(
        "Quiz generation error:",
        err
      );

      setError(
        err.message ||
          "Unable to generate quiz."
      );
    } finally {
      setGenerating(false);
    }
  };

  // =========================================================
  // WEAK TOPIC PRACTICE QUIZ
  // =========================================================

  const generateWeakTopicPracticeQuiz =
    async (request) => {
      const token = getToken();

      if (!token) {
        setError("Please login again.");
        setLoading(false);
        return;
      }

      const searchParams = new URLSearchParams(window.location.search);
      const topic = String(
        request.topic || searchParams.get("topic") || ""
      ).trim();

      const subtopic = String(
        request.subtopic || searchParams.get("subtopic") || ""
      ).trim();

      const materialId =
        request.materialId ||
        searchParams.get("materialId") ||
        localStorage.getItem(
          "activeMaterialId"
        ) ||
        "";

      if (materialId) {
        localStorage.setItem("activeMaterialId", materialId);
      }

      // Ensure topic and subtopic are also reflected in state for generating screen
      if (topic) setPracticeTopic(topic);
      if (subtopic) setPracticeSubtopic(subtopic);
      if (request.materialName || searchParams.get("materialName")) {
        setPracticeMaterialName(request.materialName || searchParams.get("materialName"));
      }

      // Clear stale active questions
      localStorage.removeItem("quizQuestions");
      localStorage.removeItem("aiQuiz");
      localStorage.removeItem("quizData");
      localStorage.removeItem("generatedQuiz");

      setGenerating(true);
      setLoading(false);
      setError("");
      setSourceWarning("");

      try {
        const recentQuestions = getRecentlySeenQuestionTexts();

        const response = await fetch(
          "http://localhost:5000/api/generate-weak-topic-quiz",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",

              Authorization:
                `Bearer ${token}`,
            },

            body: JSON.stringify({
              taskId: request.taskId || undefined,
              topic,
              subtopic,
              count: 10,
              materialId,
              previousQuestions: recentQuestions,
            }),
          }
        );

        const data =
          await response.json();

        if (
          !response.ok ||
          !data.success
        ) {
          throw new Error(
            data.message ||
              "Unable to generate weak topic quiz."
          );
        }

        if (data.limitedSourceWarning) {
          setSourceWarning(data.limitedSourceWarning);
        }

        const formattedQuestions =
          formatQuestions(
            data.questions,
            "Intermediate"
          );

        if (
          formattedQuestions.length === 0
        ) {
          throw new Error(
            "AI did not return valid weak topic questions."
          );
        }

        // Record seen questions to avoid repeating in subsequent quizzes
        recordRecentlySeenQuestions(formattedQuestions);

        setQuestions(
          formattedQuestions
        );

        setSelectedDifficulty(
          "intermediate"
        );

        setCurrentIndex(0);
        setSelectedAnswer(null);
        setAnswers({});
        setQuizCompleted(false);

        const searchParams = new URLSearchParams(window.location.search);
        const taskId = request.taskId || searchParams.get("taskId") || "";
        const returnPath = request.returnPath || searchParams.get("returnPath") || "/weak-topics";
        const effectiveTopic = data.topic || topic;
        const effectiveSubtopic = data.subtopic || subtopic;
        const effectiveMatId = data.materialId || materialId;
        const effectiveMatName = data.sourceFileName || request.materialName || "Study Material";
        const effectiveReqScore = Number(request.requiredScore || 70);

        setPracticeMode(true);
        setPracticeTaskId(taskId);
        setPracticeTopic(effectiveTopic);
        setPracticeSubtopic(effectiveSubtopic);
        setPracticeMaterialId(effectiveMatId);
        setPracticeMaterialName(effectiveMatName);
        setPracticeRequiredScore(effectiveReqScore);
        setPracticePreviousAccuracy(request.previousAccuracy !== undefined ? Number(request.previousAccuracy) : 0);
        setPracticePreviousCorrect(request.previousCorrect !== undefined ? Number(request.previousCorrect) : 0);
        setPracticePreviousWrong(request.previousWrong !== undefined ? Number(request.previousWrong) : 0);
        setPracticeReturnPath(returnPath);
        if (taskId) localStorage.setItem("activePracticeTaskId", taskId);
        if (returnPath) localStorage.setItem("activePracticeReturnPath", returnPath);

        setShowExplanation(false);

        localStorage.removeItem(
          "weakTopicQuiz"
        );
      } catch (err) {
        console.error(
          "Weak topic quiz error:",
          err
        );

        setError(
          err.message ||
            "Unable to generate weak topic quiz."
        );
        if (request.taskId || request.topic) {
          setPracticeMode(true);
          setPracticeTaskId(request.taskId || "");
          setPracticeTopic(request.topic || "");
          setPracticeSubtopic(request.subtopic || "");
          setPracticeMaterialId(request.materialId || "");
          setPracticeMaterialName(request.materialName || "Study Material");
          setPracticeRequiredScore(request.requiredScore || 70);
        }
      } finally {
        setGenerating(false);
        setLoading(false);
      }
    };

  // =========================================================
  // CREATE ANSWER OBJECT
  // =========================================================

  const createAnswerObject = (
    question,
    selectedIndex
  ) => {
    if (
      !question ||
      selectedIndex === null ||
      selectedIndex === undefined
    ) {
      return null;
    }

    const correctIndex =
      Number(question.answer);

    return {
      selected:
        question.options[
          selectedIndex
        ],

      selectedIndex,

      correct:
        selectedIndex ===
        correctIndex,

      correctAnswer:
        question.options[
          correctIndex
        ],

      topic:
        question.topic ||
        "Core Concepts",

      subtopic:
        question.subtopic ||
        "",

      difficulty:
        question.difficulty ||
        selectedDifficulty ||
        "Intermediate",

      question:
        question.question,

      explanation:
        question.explanation ||
        "",

      materialId:
        question.materialId ||
        localStorage.getItem(
          "activeMaterialId"
        ) ||
        "",
    };
  };

  // =========================================================
  // SAVE CURRENT ANSWER
  // =========================================================

  const saveCurrentAnswer = (
    answerIndex = selectedAnswer
  ) => {
    const currentQuestion =
      questions[currentIndex];

    if (
      !currentQuestion ||
      answerIndex === null ||
      answerIndex === undefined
    ) {
      return null;
    }

    const answerObject =
      createAnswerObject(
        currentQuestion,
        answerIndex
      );

    if (!answerObject) {
      return null;
    }

    setAnswers((prev) => ({
      ...prev,

      [currentQuestion.id]:
        answerObject,
    }));

    return answerObject;
  };

  // =========================================================
  // CHECK ALL ANSWERS
  // =========================================================

  const areAllQuestionsAnswered =
    (overrideCurrentAnswer) => {
      if (
        questions.length === 0
      ) {
        return false;
      }

      return questions.every(
        (question) => {
          const isCurrentQ =
            question.id ===
            questions[currentIndex]?.id;

          if (isCurrentQ) {
            // Use explicit override first (passed at click-time),
            // then selectedAnswer state, then fallback to answers map
            // (handles React state batching on the last question)
            const effectiveAnswer =
              overrideCurrentAnswer !== undefined
                ? overrideCurrentAnswer
                : selectedAnswer;

            if (effectiveAnswer !== null && effectiveAnswer !== undefined) {
              return true;
            }

            // Fallback: check if already saved to answers map
            const saved = answers[question.id];
            return (
              saved &&
              saved.selectedIndex !== null &&
              saved.selectedIndex !== undefined
            );
          }

          // All other questions — must be in answers map
          const saved =
            answers[
              question.id
            ];

          return (
            saved &&
            saved.selectedIndex !==
              null &&
            saved.selectedIndex !==
              undefined
          );
        }
      );
    };

  // =========================================================
  // ANSWER CLICK
  //
  // IMPORTANT:
  // Answer select pannina udane
  // automatic-aa next question.
  // =========================================================

  const handleAnswerSelect = (
    index
  ) => {
    const currentQuestion =
      questions[currentIndex];

    if (!currentQuestion) {
      return;
    }

    // First save selected answer
    const answerObject =
      createAnswerObject(
        currentQuestion,
        index
      );

    const updatedAnswers = {
      ...answers,

      [currentQuestion.id]:
        answerObject,
    };

    setAnswers(
      updatedAnswers
    );

    setSelectedAnswer(index);

    setShowExplanation(false);

    // Last question:
    // stay here. Finish button will appear.
    if (
      currentIndex ===
      questions.length - 1
    ) {
      return;
    }

    // Automatic next question
    setTimeout(() => {
      const nextIndex =
        currentIndex + 1;

      setCurrentIndex(
        nextIndex
      );

      const nextQuestion =
        questions[nextIndex];

      const savedNext =
        updatedAnswers[
          nextQuestion?.id
        ];

      setSelectedAnswer(
        savedNext?.selectedIndex ??
          null
      );

      setShowExplanation(false);
    }, 180);
  };

  // =========================================================
  // NEXT BUTTON
  //
  // Answer select pannama irundhaalum
  // manually next pogalaam.
  // =========================================================

  const handleNext = () => {
    const currentQuestion =
      questions[currentIndex];

    if (!currentQuestion) {
      return;
    }

    // If answer selected, save it.
    if (
      selectedAnswer !== null
    ) {
      const answerObject =
        createAnswerObject(
          currentQuestion,
          selectedAnswer
        );

      const updatedAnswers = {
        ...answers,

        [currentQuestion.id]:
          answerObject,
      };

      setAnswers(
        updatedAnswers
      );

      moveToNextQuestion(
        updatedAnswers
      );

      return;
    }

    // No answer selected.
    // Still allow skipping.
    moveToNextQuestion(
      answers
    );
  };

  // =========================================================
  // MOVE TO NEXT QUESTION
  // =========================================================

  const moveToNextQuestion =
    (currentAnswers) => {
      if (
        currentIndex >=
        questions.length - 1
      ) {
        return;
      }

      const nextIndex =
        currentIndex + 1;

      setCurrentIndex(
        nextIndex
      );

      const nextQuestion =
        questions[nextIndex];

      const savedNext =
        currentAnswers[
          nextQuestion?.id
        ];

      setSelectedAnswer(
        savedNext?.selectedIndex ??
          null
      );

      setShowExplanation(false);
    };

  // =========================================================
  // SKIP QUESTION
  //
  // Records the current question as unanswered (if not already
  // answered) and advances to the next question.
  // =========================================================

  const handleSkip = () => {
    const currentQuestion = questions[currentIndex];

    if (!currentQuestion) return;

    // If not already answered, record as unanswered explicitly
    const alreadyAnswered =
      answers[currentQuestion.id] !== undefined &&
      answers[currentQuestion.id].selectedIndex !== null &&
      answers[currentQuestion.id].selectedIndex !== undefined;

    if (!alreadyAnswered) {
      const correctIndex = Number(currentQuestion.answer);
      const unansweredRecord = {
        selected: "Not Answered",
        selectedIndex: null,
        correct: false,
        isUnanswered: true,
        correctAnswer: currentQuestion.options?.[correctIndex] || "",
        topic: currentQuestion.topic || "Core Concepts",
        subtopic: currentQuestion.subtopic || "",
        difficulty:
          currentQuestion.difficulty ||
          selectedDifficulty ||
          "Intermediate",
        question: currentQuestion.question,
        explanation: currentQuestion.explanation || "",
      };

      setAnswers((prev) => ({
        ...prev,
        [currentQuestion.id]: unansweredRecord,
      }));
    }

    // Advance to next question
    moveToNextQuestion({ ...answers });
  };

  // =========================================================
  // PREVIOUS
  // =========================================================

  const handlePrevious = () => {
    if (currentIndex === 0) {
      return;
    }

    // Save current answer if selected
    let updatedAnswers =
      answers;

    if (
      selectedAnswer !== null
    ) {
      const currentQuestion =
        questions[currentIndex];

      const answerObject =
        createAnswerObject(
          currentQuestion,
          selectedAnswer
        );

      updatedAnswers = {
        ...answers,

        [currentQuestion.id]:
          answerObject,
      };

      setAnswers(
        updatedAnswers
      );
    }

    const previousIndex =
      currentIndex - 1;

    setCurrentIndex(
      previousIndex
    );

    const previousQuestion =
      questions[
        previousIndex
      ];

    const savedPrevious =
      updatedAnswers[
        previousQuestion?.id
      ];

    setSelectedAnswer(
      savedPrevious?.selectedIndex ??
        null
    );

    setShowExplanation(false);
  };

  // =========================================================
  // FINISH QUIZ
  // =========================================================

  const finishQuiz = async (currentAnswerOverride) => {
    if (submitting) return;

    try {
      setSubmitting(true);
      setError("");

      const searchParams = new URLSearchParams(window.location.search);

      // Final answer for the current question at click-time.
      const effectiveCurrentAnswer =
        currentAnswerOverride !== undefined
          ? currentAnswerOverride
          : selectedAnswer;

      // Save the current answer before calculating the final result.
      let workingAnswers = { ...answers };

      if (
        questions[currentIndex] &&
        effectiveCurrentAnswer !== null &&
        effectiveCurrentAnswer !== undefined
      ) {
        const currentQuestion = questions[currentIndex];
        const answerObject = createAnswerObject(
          currentQuestion,
          effectiveCurrentAnswer
        );

        if (answerObject) {
          workingAnswers[currentQuestion.id] = answerObject;
        }
      }

      // Generate unique quizId for this attempt
      const quizId =
        "quiz_" +
        Date.now() +
        "_" +
        Math.random().toString(36).slice(2, 9);

      const activeMaterialId =
        questions[0]?.materialId ||
        localStorage.getItem("activeMaterialId") ||
        selectedNote?.materialId ||
        selectedNote?.id ||
        "";

      // Treat skipped questions as unanswered so the score always uses total questions
      const finalAnswers = {};

      questions.forEach((question) => {
        const saved = workingAnswers[question.id];

        if (saved) {
          finalAnswers[question.id] = {
            ...saved,
            quizId,
            materialId: activeMaterialId,
          };
          return;
        }

        const correctIndex = Number(question.answer);

        finalAnswers[question.id] = {
          selected: "Not Answered",
          selectedIndex: null,
          correct: false,
          correctAnswer: question.options[correctIndex] || "",
          topic: question.topic || "Core Concepts",
          subtopic: question.subtopic || "",
          difficulty:
            question.difficulty ||
            selectedDifficulty ||
            "Intermediate",
          question: question.question,
          explanation: question.explanation || "",
          materialId: activeMaterialId,
          quizId,
        };
      });

      const answerValues = Object.values(finalAnswers);
      const correctCount = answerValues.filter((a) => a.correct).length;
      const totalQuestions = questions.length;
      const unansweredCount = answerValues.filter(
        (a) => a.selectedIndex === null || a.selectedIndex === undefined
      ).length;
      const incorrectCount = totalQuestions - correctCount;

      // Accuracy = (Correct Answers / Total Questions) * 100
      const percentage =
        totalQuestions > 0
          ? Math.round((correctCount / totalQuestions) * 100)
          : 0;

      const mistakes = answerValues
        .filter((a) => !a.correct)
        .map((a) => ({
          quizId,
          materialId: activeMaterialId,
          question: a.question,
          selectedAnswer: a.selected,
          correctAnswer: a.correctAnswer,
          topic: a.topic || "Core Concepts",
          subtopic: a.subtopic || "",
          explanation: a.explanation || "",
        }));

      // Build the complete result object for this attempt
      const completedQuizResult = {
        quizId,
        materialId: activeMaterialId,
        materialTitle:
          selectedNote?.title ||
          selectedNote?.sourceFileName ||
          "Study Material",
        score: correctCount,
        total: totalQuestions,
        totalQuestions,
        correctCount,
        incorrectCount,
        unansweredCount,
        percentage,
        accuracy: percentage,
        questions,
        answers: finalAnswers,
        mistakes,
        isWeakTopicPractice: Boolean(practiceMode && practiceTopic),
        practiceTopic: practiceTopic || "",
        practiceSubtopic: practiceSubtopic || "",
        completedAt: new Date().toISOString(),
      };

      // =======================================================
      // CASE 1: REVISION PRACTICE QUIZ
      // =======================================================
      const isPracticeAttempt = Boolean(
        practiceMode ||
        practiceTaskId ||
        searchParams.get("taskId") ||
        practiceTopic
      );

      if (isPracticeAttempt) {
        const effectiveTaskId =
          practiceTaskId ||
          searchParams.get("taskId") ||
          localStorage.getItem("activePracticeTaskId") ||
          "";

        const effectiveReturnPath =
          practiceReturnPath ||
          searchParams.get("returnPath") ||
          localStorage.getItem("activePracticeReturnPath") ||
          "/weak-topics";

        const effectiveTopic =
          practiceTopic ||
          searchParams.get("topic") ||
          "Revision Topic";

        const effectiveSubtopic =
          practiceSubtopic ||
          searchParams.get("subtopic") ||
          "";

        const preData = JSON.parse(
          localStorage.getItem("prePracticeScore") || "{}"
        );

        const hasPrevAttempt = Boolean(
          practiceHasPreviousAttempt ||
          searchParams.get("hasPreviousAttempt") === "true" ||
          preData.hasPreviousAttempt ||
          (practicePreviousAccuracy !== null && practicePreviousAccuracy !== undefined && practicePreviousAccuracy > 0) ||
          (preData.previousAccuracy !== null && preData.previousAccuracy !== undefined && preData.previousAccuracy > 0)
        );

        const prevAccuracy =
          preData.previousAccuracy !== undefined && preData.previousAccuracy !== null
            ? Number(preData.previousAccuracy)
            : Number(practicePreviousAccuracy || 0);

        const prevCorrect =
          preData.previousCorrect !== undefined
            ? Number(preData.previousCorrect)
            : Number(practicePreviousCorrect || 0);

        const prevWrong =
          preData.previousWrong !== undefined
            ? Number(preData.previousWrong)
            : Number(practicePreviousWrong || 0);

        const newAccuracy = percentage;
        const improvement = hasPrevAttempt ? (newAccuracy - prevAccuracy) : 0;

        const revisionProgress = {
          taskId: effectiveTaskId,
          topic: effectiveTopic,
          subtopic: effectiveSubtopic,
          previousAccuracy: hasPrevAttempt ? prevAccuracy : 0,
          newAccuracy,
          improvement,
          previousCorrect: prevCorrect,
          previousWrong: prevWrong,
          newCorrect: correctCount,
          newWrong: totalQuestions - correctCount,
          materialId: activeMaterialId,
          previousScore: prevAccuracy,
          newScore: newAccuracy,
          quizId,
          completedAt: new Date().toISOString(),
        };

        localStorage.setItem(
          "lastPracticedSubtopic",
          JSON.stringify(revisionProgress)
        );
        localStorage.setItem(
          "revisionProgress",
          JSON.stringify(revisionProgress)
        );
        localStorage.setItem(
          "lastPracticeQuizResult",
          JSON.stringify(completedQuizResult)
        );

        const history = JSON.parse(
          localStorage.getItem("subtopicPracticeHistory") || "{}"
        );

        const exactKey = `${effectiveTopic.trim().toLowerCase()}|||${(effectiveSubtopic || "").trim().toLowerCase()}`;
        const rawKey = `${effectiveTopic}|||${effectiveSubtopic || ""}`;
        history[exactKey] = revisionProgress;
        history[rawKey] = revisionProgress;

        if (effectiveSubtopic && effectiveSubtopic.trim()) {
          history[effectiveSubtopic.trim().toLowerCase()] = revisionProgress;
        } else {
          history[effectiveTopic.trim().toLowerCase()] = revisionProgress;
        }

        localStorage.setItem(
          "subtopicPracticeHistory",
          JSON.stringify(history)
        );

        // Build the complete question review items from actual submitted quiz
        const reviewQuestions = questions.map((q, idx) => {
          const userAns = finalAnswers[q.id];
          const correctIdx = Number(q.answer);
          const isUnanswered =
            !userAns ||
            userAns.selectedIndex === null ||
            userAns.selectedIndex === undefined ||
            userAns.selected === "Not Answered";
          const isCorrect = !isUnanswered && Boolean(userAns.correct);
          const correctAnswerText =
            Array.isArray(q.options) && q.options[correctIdx] !== undefined
              ? q.options[correctIdx]
              : (userAns?.correctAnswer || "");
          const selectedAnswerText = isUnanswered
            ? "Not Answered"
            : (userAns?.selected || "Not Answered");

          return {
            questionNumber: idx + 1,
            question: q.question,
            options: Array.isArray(q.options) ? q.options : [],
            selectedAnswer: selectedAnswerText,
            selectedIndex: isUnanswered ? null : userAns.selectedIndex,
            correctAnswer: correctAnswerText,
            correctIndex: correctIdx,
            isCorrect,
            isUnanswered,
            explanation: q.explanation || userAns?.explanation || "",
            topic: q.topic || effectiveTopic || "",
            subtopic: q.subtopic || effectiveSubtopic || "",
          };
        });

        const reqThreshold = Number(practiceRequiredScore || 70);
        const isPassed = percentage >= reqThreshold;

        // Immediately persist the practice attempt to MongoDB and wait for completion
        const token = getToken();
        if (token) {
          try {
            const resp = await fetch("http://localhost:5000/api/practice-attempts", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                taskId: effectiveTaskId || undefined,
                materialId: activeMaterialId,
                topic: effectiveTopic,
                subtopic: effectiveSubtopic || "",
                quizId,
                score: correctCount,
                totalQuestions,
                correctCount,
                incorrectCount: totalQuestions - correctCount,
                accuracy: percentage,
                previousAccuracy: prevAccuracy,
                improvement,
                requiredScore: reqThreshold,
                reviewQuestions,
              }),
            });
            const data = await resp.json();
            if (data && data.success) {
              localStorage.setItem("revisionProgressSaved", quizId);
            }
          } catch (postErr) {
            console.warn("Failed to persist practice attempt to server:", postErr);
          }
        }

        // Set feedback for PracticeSection / WeakTopics
        localStorage.setItem(
          "revisionPracticeFeedback",
          JSON.stringify({
            taskId: effectiveTaskId,
            topic: effectiveTopic,
            subtopic: effectiveSubtopic || "",
            accuracy: percentage,
            requiredScore: reqThreshold,
            passed: isPassed,
            status: isPassed ? "Completed" : "In Progress",
            timestamp: Date.now(),
          })
        );

        // Clean up practice temporary flags
        localStorage.removeItem("activePracticeTaskId");
        localStorage.removeItem("activePracticeReturnPath");
        localStorage.removeItem("weakTopicQuiz");

        // Clear active in-progress quiz items
        localStorage.removeItem("quizQuestions");
        localStorage.removeItem("aiQuiz");
        localStorage.removeItem("quizData");
        localStorage.removeItem("generatedQuiz");

        // Store result data and show the practice result view
        const practiceResultData = {
          topic: effectiveTopic,
          subtopic: effectiveSubtopic,
          percentage,
          correctCount,
          incorrectCount: totalQuestions - correctCount,
          unansweredCount: unansweredCount || 0,
          totalQuestions,
          hasPreviousAttempt: hasPrevAttempt,
          prevAccuracy: hasPrevAttempt ? prevAccuracy : null,
          improvement,
          requiredScore: reqThreshold,
          passed: isPassed,
          returnPath: effectiveReturnPath || "/weak-topics",
          taskId: effectiveTaskId,
          materialId: activeMaterialId,
          materialName: practiceMaterialName || searchParams.get("materialName") || "Study Material",
          reviewQuestions,
          attemptedAt: new Date().toISOString(),
        };
        setPracticeResult(practiceResultData);
        // Persist to localStorage so result survives a page refresh
        try {
          localStorage.setItem("activePracticeResult", JSON.stringify(practiceResultData));
        } catch (e) {
          console.warn("Could not persist practiceResult to localStorage:", e);
        }
        // Update URL so refreshing immediately shows the result view without blank page
        try {
          if (effectiveTaskId) {
            window.history.replaceState(null, "", `/quiz?taskId=${encodeURIComponent(effectiveTaskId)}&view=result`);
          }
        } catch (e) {}
        setAnswers(finalAnswers);
        setQuizResult(completedQuizResult);
        setQuizCompleted(true);
        return;
        // DO NOT overwrite lastQuizResult! Original comprehensive quiz is preserved.
      } else {
        // =======================================================
        // CASE 2: COMPREHENSIVE NORMAL QUIZ (Fresh Attempt)
        // =======================================================

        // 1. Wipe out stale previous analysis & old practice history
        localStorage.removeItem("revisionProgress");
        localStorage.removeItem("lastPracticedSubtopic");
        localStorage.removeItem("subtopicPracticeHistory");
        localStorage.removeItem("prePracticeScore");
        localStorage.removeItem("aiWeakTopics");
        localStorage.removeItem("weakTopics");

        // 2. Save ONLY the latest completed quiz result
        localStorage.setItem(
          "lastQuizResult",
          JSON.stringify(completedQuizResult)
        );
        localStorage.setItem(
          "currentQuizId",
          quizId
        );
        localStorage.setItem(
          "quizMistakes",
          JSON.stringify(mistakes)
        );

        // 3. Compute accurate local weak topics grouped by real topic/subtopic
        const topicStats = {};

        Object.values(finalAnswers).forEach((ans) => {
          const rawTopic = (ans.topic || "").trim();
          const topic =
            rawTopic && rawTopic.toLowerCase() !== "general topic"
              ? rawTopic
              : "Core Concepts";
          const rawSubtopic = (ans.subtopic || "").trim();
          const subtopic = rawSubtopic || topic;
          const key = `${topic}|||${subtopic}`;

          if (!topicStats[key]) {
            topicStats[key] = {
              key,
              topic,
              subtopic,
              materialId: activeMaterialId,
              quizId,
              total: 0,
              correct: 0,
              incorrect: 0,
            };
          }

          topicStats[key].total += 1;
          if (ans.correct) {
            topicStats[key].correct += 1;
          } else {
            topicStats[key].incorrect += 1;
          }
        });

        const calculatedWeakTopics = Object.values(topicStats)
          .filter(
            (t) =>
              t.incorrect > 0 ||
              (t.total > 0 &&
                Math.round((t.correct / t.total) * 100) < 70)
          )
          .map((t) => {
            const acc =
              t.total > 0
                ? Math.round((t.correct / t.total) * 100)
                : 0;
            return {
              ...t,
              accuracy: acc,
              severity:
                acc < 40 ? "High Priority" : "Needs Revision",
              recommendation:
                "Review the key concepts and work through practice questions for this section.",
            };
          })
          .sort((a, b) => a.accuracy - b.accuracy);

        localStorage.setItem(
          "weakTopics",
          JSON.stringify(calculatedWeakTopics)
        );

        // Build the complete question review items from actual submitted quiz for normal quiz
        const normalReviewQuestions = questions.map((q, idx) => {
          const userAns = finalAnswers[q.id];
          const correctIdx = Number(q.answer);
          const isUnanswered =
            !userAns ||
            userAns.selectedIndex === null ||
            userAns.selectedIndex === undefined ||
            userAns.selected === "Not Answered";
          const isCorrect = !isUnanswered && Boolean(userAns.correct);
          const correctAnswerText =
            Array.isArray(q.options) && q.options[correctIdx] !== undefined
              ? q.options[correctIdx]
              : (userAns?.correctAnswer || "");
          const selectedAnswerText = isUnanswered
            ? "Not Answered"
            : (userAns?.selected || "Not Answered");

          return {
            questionNumber: idx + 1,
            question: q.question,
            options: Array.isArray(q.options) ? q.options : [],
            selectedAnswer: selectedAnswerText,
            selectedIndex: isUnanswered ? null : userAns.selectedIndex,
            correctAnswer: correctAnswerText,
            correctIndex: correctIdx,
            isCorrect,
            isUnanswered,
            explanation: q.explanation || userAns?.explanation || "",
            topic: q.topic || "Core Concepts",
            subtopic: q.subtopic || "",
          };
        });

        completedQuizResult.reviewQuestions = normalReviewQuestions;

        // Persist complete quiz result to MongoDB
        const _saveToken = localStorage.getItem("token") || sessionStorage.getItem("token");
        if (_saveToken) {
          try {
            await fetch("http://localhost:5000/api/quiz-results", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${_saveToken}`,
              },
              body: JSON.stringify({
                quizId: completedQuizResult.quizId,
                materialId: completedQuizResult.materialId || "",
                topic: selectedNote?.sourceFileName || selectedNote?.title || "Study Material",
                difficulty: selectedDifficulty || "Intermediate",
                accuracy: completedQuizResult.accuracy,
                score: completedQuizResult.score,
                totalQuestions: completedQuizResult.totalQuestions,
                correctCount: completedQuizResult.correctCount,
                incorrectCount: completedQuizResult.incorrectCount,
                unansweredCount,
                questions,
                answers: finalAnswers,
                reviewQuestions: normalReviewQuestions,
                completedAt: completedQuizResult.completedAt,
              }),
            });
          } catch (e) {
            console.warn("Quiz result save to server failed:", e);
          }
        }
      }

      // Clear active in-progress quiz items from localStorage so new quiz attempts don't reload finished questions
      localStorage.removeItem("quizQuestions");
      localStorage.removeItem("aiQuiz");
      localStorage.removeItem("quizData");
      localStorage.removeItem("generatedQuiz");
      localStorage.removeItem("weakTopicQuiz");

      localStorage.setItem(
        "quizAnswers",
        JSON.stringify(finalAnswers)
      );

      setAnswers(finalAnswers);
      setQuizResult(completedQuizResult);
      setQuizCompleted(true);
      setAnalysisError("");

      // Navigate to Quiz Result view (do NOT auto-navigate to /weak-topics)
      navigate("/quiz?view=result", { replace: true });
    } catch (err) {
      console.error("Quiz submission error:", err);
      setError(err.message || "Failed to save quiz results.");
    } finally {
      setSubmitting(false);
    }
  };

  // =========================================================
  // ANALYZE WEAK TOPICS (ONLY ON BUTTON CLICK)
  // =========================================================

  const handleAnalyzeWeakTopics = async () => {
    if (analyzingWeakTopics) return;
    setAnalyzingWeakTopics(true);
    setAnalysisError("");

    try {
      if (practiceMode) {
        navigate("/weak-topics");
        return;
      }

      const currentResult =
        quizResult ||
        JSON.parse(localStorage.getItem("lastQuizResult") || "null");

      if (!currentResult || !currentResult.quizId) {
        throw new Error(
          "No completed quiz found to analyze. Please complete a quiz first."
        );
      }

      const { quizId, materialId, mistakes } = currentResult;
      const mistakesToAnalyze = Array.isArray(mistakes) ? mistakes : [];

      const token = getToken();
      if (token && mistakesToAnalyze.length > 0) {
        const response = await fetch(
          "http://localhost:5000/api/analyze-weak-topics",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              quizId,
              materialId: materialId || "",
              mistakes: mistakesToAnalyze,
            }),
          }
        );

        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(
            data.message ||
              "Failed to analyze weak topics. Please try again."
          );
        }

        localStorage.setItem(
          "aiWeakTopics",
          JSON.stringify({
            quizId,
            weakTopics: data.weakTopics || [],
            overallAdvice: data.overallAdvice || "",
          })
        );
      }

      // Success: navigate to /weak-topics
      navigate("/weak-topics");
    } catch (err) {
      console.error("Analyze Weak Topics error:", err);
      setAnalysisError(
        err.message || "Failed to analyze weak topics. Please try again."
      );
      setAnalyzingWeakTopics(false);
    }
  };

  // =========================================================
  // LOCAL WEAK TOPICS
  // =========================================================

  const generateWeakTopics = (
    mistakes
  ) => {
    if (
      !mistakes ||
      mistakes.length === 0
    ) {
      localStorage.setItem(
        "weakTopics",
        JSON.stringify([])
      );

      return;
    }

    const topicStats = {};

    mistakes.forEach(
      (item) => {
        const topic =
          item.topic ||
          "Core Concepts";

        const subtopic =
          item.subtopic || "";

        const key = subtopic
          ? `${topic} - ${subtopic}`
          : topic;

        if (!topicStats[key]) {
          topicStats[key] = {
            topic,

            subtopic,

            wrong: 0,

            questions: [],
          };
        }

        topicStats[key].wrong +=
          1;

        topicStats[
          key
        ].questions.push(
          item.question
        );
      }
    );

    const weakTopics =
      Object.values(
        topicStats
      )
        .sort(
          (a, b) =>
            b.wrong - a.wrong
        )
        .map((item) => ({
          topic:
            item.topic,

          subtopic:
            item.subtopic,

          wrongAnswers:
            item.wrong,

          status:
            item.wrong >= 2
              ? "Weak"
              : "Needs Revision",

          questions:
            item.questions,
        }));

    localStorage.setItem(
      "weakTopics",
      JSON.stringify(
        weakTopics
      )
    );
  };

  // =========================================================
  // AI WEAK TOPICS
  // =========================================================

  const generateAIWeakTopics =
    async (mistakes) => {
      const token =
        getToken();

      if (!token) return;

      const materialId =
        mistakes[0]?.materialId ||
        localStorage.getItem(
          "activeMaterialId"
        ) ||
        "";

      try {
        const response =
          await fetch(
            "http://localhost:5000/api/analyze-weak-topics",
            {
              method: "POST",

              headers: {
                "Content-Type":
                  "application/json",

                Authorization:
                  `Bearer ${token}`,
              },

              body: JSON.stringify({
                mistakes,

                materialId,
              }),
            }
          );

        const data =
          await response.json();

        if (
          response.ok &&
          data.success
        ) {
          localStorage.setItem(
            "aiWeakTopics",
            JSON.stringify(data)
          );
        }
      } catch (e) {
        console.error(
          "AI weak topics analysis error:",
          e
        );
      }
    };

  // =========================================================
  // RESET
  // =========================================================

  const resetForNewDifficulty =
    () => {
      localStorage.removeItem(
        "quizQuestions"
      );

      localStorage.removeItem(
        "aiQuiz"
      );

      localStorage.removeItem("quizData");
      localStorage.removeItem("generatedQuiz");
      localStorage.removeItem("quizAnswers");
      localStorage.removeItem("weakTopicQuiz");

      setQuestions([]);

      setSelectedDifficulty(
        null
      );

      setCurrentIndex(0);

      setSelectedAnswer(null);

      setAnswers({});

      setQuizCompleted(false);
      setQuizResult(null);

      setPracticeMode(false);

      setPracticeTopic("");

      setPracticeSubtopic("");

      setShowExplanation(false);

      setError("");
      setSourceWarning("");
      setAnalysisError("");

      navigate("/quiz");
    };

  // =========================================================
  // LOADING
  // =========================================================

  if (loading) {
    return (
      <div className="quiz-page-wrapper">
        <Navbar />

        <main className="quiz-container saas-container">
          <div className="quiz-loading-box">

            <div className="spinner"></div>

            <h2>
              Loading AI Quiz...
            </h2>

            <p>
              Retrieving material
              selection details.
            </p>

          </div>
        </main>
      </div>
    );
  }

  // =========================================================
  // GENERATING  (must be checked BEFORE no-material guard)
  // =========================================================

  if (generating) {
    return (
      <div className="quiz-page-wrapper">
        <Navbar />

        <main className="quiz-container">
          <div className="quiz-loading-box">

            <div className="spinner"></div>

            <h2>
              {practiceMode || practiceTaskId
                ? `Generating Practice Quiz for "${practiceTopic || "Selected Topic"}"...`
                : `Generating ${selectedDifficulty ? selectedDifficulty.toUpperCase() : ""} AI Quiz...`}
            </h2>

            <p>
              {practiceMode || practiceTaskId
                ? `Formulating 10 practice questions focused on ${practiceTopic}${practiceSubtopic && practiceSubtopic !== practiceTopic ? ` (${practiceSubtopic})` : ""} from ${practiceMaterialName || "your study material"}...`
                : "Groq AI is analyzing key concepts to formulate 10 custom questions."}
            </p>

          </div>
        </main>
      </div>
    );
  }

  // =========================================================
  // NO MATERIAL
  // =========================================================

  if (
    !selectedNote &&
    !practiceMode &&
    !practiceInitializing &&
    !practiceTaskId
  ) {
    return (
      <div className="quiz-page-wrapper">
        <Navbar />

        <main className="quiz-container saas-container">
          <div className="quiz-error-box">

            <div className="error-icon">
              📄
            </div>

            <h2>
              Please select a Smart
              Note to start a quiz.
            </h2>

            <p>
              You must select or
              upload a study material
              first before starting
              an AI Quiz.
            </p>

            <div className="error-actions-row">

              <Link
                to="/smart-notes"
                className="saas-btn-primary"
              >
                View Smart Notes →
              </Link>

              <Link
                to="/upload"
                className="saas-btn-secondary"
              >
                Upload Material
              </Link>

            </div>

          </div>
        </main>
      </div>
    );
  }

  // =========================================================
  // ERROR
  // =========================================================

  if (error) {
    const currentSearch = new URLSearchParams(window.location.search);
    const isPracticeError = Boolean(
      practiceMode ||
      practiceTaskId ||
      currentSearch.get("taskId") ||
      currentSearch.get("topic")
    );

    if (isPracticeError) {
      const displayTopic = practiceTopic || currentSearch.get("topic") || "";
      const displaySubtopic = practiceSubtopic || currentSearch.get("subtopic") || "";
      const displayMatName = practiceMaterialName || currentSearch.get("materialName") || "Study Material";
      const displayTaskId = practiceTaskId || currentSearch.get("taskId") || "";
      const displayMatId = practiceMaterialId || currentSearch.get("materialId") || "";
      const displayReqScore = practiceRequiredScore || Number(currentSearch.get("requiredScore") || 70);
      const displayPrevAcc = practicePreviousAccuracy !== null && practicePreviousAccuracy !== undefined
        ? practicePreviousAccuracy
        : (currentSearch.get("previousAccuracy") ? Number(currentSearch.get("previousAccuracy")) : null);
      const displayReturnPath = practiceReturnPath || currentSearch.get("returnPath") || "/weak-topics";

      return (
        <div className="quiz-page-wrapper">
          <Navbar />

          <main className="quiz-container">
            <div className="quiz-error-box">
              <div className="error-icon">⚠️</div>

              <h2>Practice Quiz Generation Error</h2>

              {displayTopic && (
                <p className="task-topic-heading" style={{ fontSize: "1.1rem", marginBottom: "0.25rem" }}>
                  Topic: <strong>{displayTopic}</strong> {displaySubtopic && displaySubtopic !== displayTopic ? `· ${displaySubtopic}` : ""}
                </p>
              )}

              {displayMatName && (
                <p style={{ color: "#64748b", fontSize: "0.9rem", marginBottom: "1rem" }}>
                  Study Material: 📄 {displayMatName}
                </p>
              )}

              <p style={{ color: "#dc2626", margin: "1rem 0 1.5rem 0", lineHeight: 1.5 }}>
                {error}
              </p>

              <div className="error-actions-row">
                <button
                  onClick={() => {
                    setError("");
                    generateWeakTopicPracticeQuiz({
                      taskId: displayTaskId,
                      topic: displayTopic,
                      subtopic: displaySubtopic,
                      materialId: displayMatId,
                      materialName: displayMatName,
                      requiredScore: displayReqScore,
                      previousAccuracy: displayPrevAcc,
                      returnPath: displayReturnPath,
                    });
                  }}
                  className="saas-btn-primary"
                >
                  🔄 Retry Practice Quiz
                </button>

                <button
                  onClick={handleBackToRevisionPlan}
                  className="saas-btn-secondary"
                >
                  ← Back to Weak Topics
                </button>
              </div>
            </div>
          </main>
        </div>
      );
    }

    return (
      <div className="quiz-page-wrapper">
        <Navbar />

        <main className="quiz-container">
          <div className="quiz-error-box">

            <div className="error-icon">
              ⚠️
            </div>

            <h2>
              Quiz Generation Error
            </h2>

            <p>{error}</p>

            <div style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap", marginTop: "16px" }}>
              <button
                onClick={() => {
                  setError("");
                  startNewQuizGeneration(selectedDifficulty || "intermediate");
                }}
                className="saas-btn-primary"
                style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
              >
                🔄 Retry Generating Quiz
              </button>

              <button
                onClick={() => {
                  setError("");
                  setSelectedDifficulty(null);
                }}
                className="saas-btn-secondary"
              >
                ← Back to Difficulty Selection
              </button>
            </div>

          </div>
        </main>
      </div>
    );
  }

  // =========================================================
  // DIFFICULTY SELECTION
  // =========================================================

  const currentSearchForDiff = new URLSearchParams(window.location.search);
  const isAnyPracticeContext = Boolean(
    practiceMode ||
    practiceTaskId ||
    practiceInitializing ||
    currentSearchForDiff.get("taskId") ||
    currentSearchForDiff.get("topic")
  );

  if (
    questions.length === 0 &&
    !quizCompleted &&
    !isAnyPracticeContext
  ) {
    const materialName =
      selectedNote?.sourceFileName ||
      selectedNote?.fileName ||
      selectedNote?.title ||
      "Selected Study Material";

    const getFileType = (
      name = ""
    ) => {
      const ext = name
        .split(".")
        .pop()
        .toUpperCase();

      if (ext === "PDF")
        return "PDF";

      if (
        ext === "PPT" ||
        ext === "PPTX"
      ) {
        return "PowerPoint";
      }

      if (
        ext === "DOC" ||
        ext === "DOCX"
      ) {
        return "Word Document";
      }

      if (ext === "TXT")
        return "Text File";

      return (
        ext || "Study Material"
      );
    };

    const fileType =
      getFileType(
        materialName
      );

    const uploadDate =
      selectedNote?.createdAt
        ? new Date(
            selectedNote.createdAt
          ).toLocaleDateString(
            "en-US",
            {
              month: "short",
              day: "numeric",
              year: "numeric",
            }
          )
        : "Recently uploaded";

    return (
      <div className="quiz-page-wrapper quiz-start-bg">
        <Navbar />

        <main className="quiz-container quiz-start-container">

          <div className="quiz-start-top">

            <span className="quiz-start-pill">
              🎓 Interactive Assessment
            </span>

            <h1 className="quiz-start-heading">
              AI Quiz
            </h1>

            <p className="quiz-start-subtitle">
              Generate a personalized
              10-question quiz from
              your selected study
              material using AI.
            </p>

          </div>

          <div className="quiz-material-card">

            <div className="quiz-material-card-left">

              <div className="qmc-source-label">
                Source: Study Material
              </div>

              <div className="qmc-filename">
                {materialName}
              </div>

              <div className="qmc-meta-row">

                <span className="qmc-badge">
                  {fileType}
                </span>

                <span className="qmc-date">
                  📅 {uploadDate}
                </span>

              </div>

            </div>

            <div className="quiz-material-card-right">

              <div className="qmc-illustration">

                <svg
                  width="90"
                  height="90"
                  viewBox="0 0 90 90"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >

                  <rect
                    x="10"
                    y="5"
                    width="55"
                    height="70"
                    rx="6"
                    fill="#e0e7ff"
                    stroke="#6366f1"
                    strokeWidth="2"
                  />

                  <rect
                    x="18"
                    y="20"
                    width="38"
                    height="4"
                    rx="2"
                    fill="#a5b4fc"
                  />

                  <rect
                    x="18"
                    y="30"
                    width="30"
                    height="4"
                    rx="2"
                    fill="#a5b4fc"
                  />

                  <rect
                    x="18"
                    y="40"
                    width="35"
                    height="4"
                    rx="2"
                    fill="#a5b4fc"
                  />

                  <rect
                    x="18"
                    y="50"
                    width="22"
                    height="4"
                    rx="2"
                    fill="#c7d2fe"
                  />

                  <circle
                    cx="68"
                    cy="62"
                    r="16"
                    fill="#4f46e5"
                  />

                  <text
                    x="68"
                    y="67"
                    textAnchor="middle"
                    fill="white"
                    fontSize="14"
                    fontWeight="bold"
                  >
                    ?
                  </text>

                </svg>

              </div>

            </div>

          </div>

          <div className="quiz-difficulty-intro">

            <p>
              Choose your preferred
              difficulty level to
              generate a 10-question
              quiz.
            </p>

            <p>
              Each quiz is generated
              only from the selected
              material.
            </p>

          </div>

          <div className="difficulty-cards-grid">

            {/* EASY */}

            <div className="difficulty-card card-easy">

              <div className="card-level-badge level-easy">
                EASY
              </div>

              <h3 className="card-level-title">
                Easy Level
              </h3>

              <p className="card-level-tagline">
                Build your basics
              </p>

              <ul className="card-checklist">

                <li>
                  ✓ Basic definitions
                  and terms
                </li>

                <li>
                  ✓ Direct recall
                  from material
                </li>

                <li>
                  ✓ Key concepts
                  identification
                </li>

                <li>
                  ✓ Beginner-friendly
                  questions
                </li>

              </ul>

              <button
                onClick={() =>
                  handleDifficultySelect(
                    "easy"
                  )
                }
                className="diff-btn btn-easy"
              >
                ▶ Start Easy Quiz →
              </button>

            </div>

            {/* INTERMEDIATE */}

            <div className="difficulty-card card-intermediate">

              <div className="card-level-badge level-intermediate">
                INTERMEDIATE
              </div>

              <h3 className="card-level-title">
                Intermediate Level
              </h3>

              <p className="card-level-tagline">
                Strengthen your
                understanding
              </p>

              <ul className="card-checklist">

                <li>
                  ✓ Concept-based
                  questions
                </li>

                <li>
                  ✓ Practical
                  application
                  scenarios
                </li>

                <li>
                  ✓ Compare and
                  contrast topics
                </li>

                <li>
                  ✓ Moderate
                  reasoning required
                </li>

              </ul>

              <button
                onClick={() =>
                  handleDifficultySelect(
                    "intermediate"
                  )
                }
                className="diff-btn btn-intermediate"
              >
                ▶ Start Intermediate
                Quiz →
              </button>

            </div>

            {/* DIFFICULT */}

            <div className="difficulty-card card-difficult">

              <div className="card-level-badge level-difficult">
                DIFFICULT
              </div>

              <h3 className="card-level-title">
                Difficult Level
              </h3>

              <p className="card-level-tagline">
                Challenge yourself
              </p>

              <ul className="card-checklist">

                <li>
                  ✓ Deep analysis
                  questions
                </li>

                <li>
                  ✓ Complex multi-step
                  reasoning
                </li>

                <li>
                  ✓ Advanced scenario
                  cases
                </li>

                <li>
                  ✓ Expert-level
                  understanding
                </li>

              </ul>

              <button
                onClick={() =>
                  handleDifficultySelect(
                    "difficult"
                  )
                }
                className="diff-btn btn-difficult"
              >
                ▶ Start Difficult
                Quiz →
              </button>

            </div>

          </div>

          <div className="quiz-tip-banner">
            💡 <strong>Tip:</strong>{" "}
            Choose a difficulty
            level based on your
            preparation and learning
            goals.
          </div>

          <div className="start-screen-footer">

            <Link
              to="/smart-notes"
              className="saas-btn-secondary"
            >
              ← Back to Smart Notes
            </Link>

          </div>

        </main>
      </div>
    );
  }

  // =========================================================
  // QUIZ COMPLETED
  // =========================================================

  // ── PRACTICE QUIZ RESULT VIEW ────────────────────────────────────────────
  // ── PRACTICE RETRY & COLLAPSE HELPERS ──────────────────────────────────────
  const isQuestionCollapsed = (idx) => {
    if (collapsedQuestions[idx] !== undefined) {
      return Boolean(collapsedQuestions[idx]);
    }
    // Default: Q1 (idx 0) is open, all subsequent questions start collapsed
    return idx !== 0;
  };

  const toggleQuestionCollapse = (idx) => {
    const current = isQuestionCollapsed(idx);
    setCollapsedQuestions((prev) => ({
      ...prev,
      [idx]: !current,
    }));
  };

  const toggleCollapseAll = (questionsList) => {
    const count = questionsList?.length || 0;
    const allAreCollapsed = questionsList.every((_, i) => isQuestionCollapsed(i));
    const nextState = {};
    for (let i = 0; i < count; i++) {
      nextState[i] = !allAreCollapsed;
    }
    setCollapsedQuestions(nextState);
  };

  const formatAttemptDate = (dateVal) => {
    try {
      const d = dateVal ? new Date(dateVal) : new Date();
      if (isNaN(d.getTime())) return "Nov 2, 2026";
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch (e) {
      return "Nov 2, 2026";
    }
  };

  const StudyIllustration = () => (
    <svg
      width="135"
      height="135"
      viewBox="0 0 160 160"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ filter: "drop-shadow(0 10px 18px rgba(99, 102, 241, 0.15))" }}
    >
      <circle cx="80" cy="80" r="68" fill="url(#ill-glow)" />
      <g transform="rotate(-6 68 85)">
        <rect x="24" y="22" width="76" height="104" rx="14" fill="#ffffff" stroke="#c7d2fe" strokeWidth="3" />
        <rect x="44" y="15" width="36" height="15" rx="6" fill="#6366f1" />
        <circle cx="62" cy="22" r="3" fill="#ffffff" />
        <rect x="34" y="42" width="14" height="14" rx="4" fill="#f43f5e" />
        <path d="M37 49L41 53L45 45" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="54" y="46" width="36" height="5" rx="2.5" fill="#e2e8f0" />
        <rect x="34" y="64" width="14" height="14" rx="4" fill="#f43f5e" />
        <path d="M37 71L41 75L45 67" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="54" y="68" width="32" height="5" rx="2.5" fill="#e2e8f0" />
        <rect x="34" y="86" width="14" height="14" rx="4" fill="#f43f5e" />
        <path d="M37 93L41 97L45 89" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="54" y="90" width="34" height="5" rx="2.5" fill="#e2e8f0" />
      </g>
      <g transform="translate(68, 100)">
        <rect x="0" y="8" width="62" height="14" rx="3" fill="#ea580c" />
        <rect x="4" y="10" width="54" height="10" rx="2" fill="#fed7aa" />
        <rect x="0" y="8" width="6" height="14" rx="2" fill="#c2410c" />
      </g>
      <g transform="translate(74, 90)">
        <rect x="0" y="8" width="56" height="13" rx="3" fill="#f59e0b" />
        <rect x="4" y="10" width="48" height="9" rx="2" fill="#fef3c7" />
        <rect x="0" y="8" width="6" height="13" rx="2" fill="#d97706" />
      </g>
      <g transform="translate(86, 52) rotate(8)">
        <ellipse cx="26" cy="22" rx="14" ry="7" fill="#1e1b4b" />
        <polygon points="26,6 48,15 26,24 4,15" fill="#312e81" stroke="#4338ca" strokeWidth="1.5" />
        <circle cx="26" cy="15" r="2.5" fill="#fbbf24" />
        <path d="M26 15 C33 16, 38 21, 39 28" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" fill="none" />
        <rect x="37" y="27" width="4" height="6" rx="1" fill="#f59e0b" />
      </g>
      <circle cx="20" cy="50" r="2" fill="#a5b4fc" />
      <circle cx="140" cy="35" r="2.5" fill="#f472b6" />
      <circle cx="28" cy="130" r="2" fill="#fbbf24" />
      <defs>
        <radialGradient id="ill-glow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(80 80) rotate(90) scale(68)">
          <stop stopColor="#e0e7ff" stopOpacity="0.7" />
          <stop offset="1" stopColor="#e0e7ff" stopOpacity="0" />
        </radialGradient>
      </defs>
    </svg>
  );

  const handleRetryPracticeQuiz = async () => {
    if (!practiceResult) return;
    const targetTopic = practiceResult.topic;
    const targetSubtopic = practiceResult.subtopic || "";
    const targetMaterialId =
      practiceResult.materialId ||
      localStorage.getItem("activeMaterialId") ||
      "";
    const targetMaterialName = practiceResult.materialName || "Study Material";
    const targetTaskId = practiceResult.taskId || "";
    const targetReturnPath = practiceResult.returnPath || "/weak-topics";
    const latestScore = practiceResult.percentage;
    const targetReqScore = practiceResult.requiredScore || 70;

    // Reset attempt state
    setPracticeResult(null);
    localStorage.removeItem("activePracticeResult"); // clear persisted result on retry
    setQuizCompleted(false);
    setQuestions([]);
    setAnswers({});
    setCurrentIndex(0);
    setSelectedAnswer(null);
    setCollapsedQuestions({});
    setError("");

    // Clear &view=result from URL so browser refresh remains on practice quiz
    try {
      if (targetTaskId) {
        window.history.replaceState(
          null,
          "",
          `/quiz?taskId=${encodeURIComponent(targetTaskId)}&topic=${encodeURIComponent(targetTopic)}&returnPath=${encodeURIComponent(targetReturnPath)}`
        );
      }
    } catch (e) {}

    // Request fresh 10 questions for this exact same task & study material
    await generateWeakTopicPracticeQuiz({
      topic: targetTopic,
      subtopic: targetSubtopic,
      materialId: targetMaterialId,
      materialName: targetMaterialName,
      taskId: targetTaskId,
      requiredScore: targetReqScore,
      returnPath: targetReturnPath,
      previousAccuracy: latestScore,
    });
  };

  const handleBackToRevisionPlan = () => {
    // Keep practice feedback fresh so banner shows on RevisionScheduler / WeakTopics
    const fbStr = localStorage.getItem("revisionPracticeFeedback");
    if (fbStr) {
      try {
        const fb = JSON.parse(fbStr);
        fb.timestamp = Date.now();
        localStorage.setItem("revisionPracticeFeedback", JSON.stringify(fb));
      } catch (e) {}
    }
    // Clear persisted practice result so a fresh visit to /quiz doesn't restore it
    localStorage.removeItem("activePracticeResult");
    const searchParams = new URLSearchParams(window.location.search);
    const returnTarget =
      practiceResult?.returnPath ||
      practiceReturnPath ||
      searchParams.get("returnPath") ||
      "/weak-topics";
    setPracticeResult(null);
    navigate(returnTarget, { replace: true });
  };

  // ── PRACTICE QUIZ RESULT VIEW ────────────────────────────────────────────
  if (practiceResult) {
    const pr = practiceResult;
    const isPassed = pr.passed !== undefined
      ? Boolean(pr.passed)
      : pr.percentage >= (pr.requiredScore || 70);

    const improvVal = pr.improvement !== undefined && pr.improvement !== null
      ? Number(pr.improvement)
      : (pr.percentage - (pr.prevAccuracy || 0));

    const improvStr = improvVal >= 0 ? `+${improvVal}%` : `${improvVal}%`;
    const optionLetters = ["A", "B", "C", "D"];

    const reviewList =
      Array.isArray(pr.reviewQuestions) && pr.reviewQuestions.length > 0
        ? pr.reviewQuestions
        : Array.isArray(questions) && questions.length > 0
        ? questions.map((q, idx) => {
            const userAns = answers[q.id];
            const correctIdx = Number(q.answer);
            const isUnanswered =
              !userAns ||
              userAns.selectedIndex === null ||
              userAns.selectedIndex === undefined ||
              userAns.selected === "Not Answered";
            const isCorrect = !isUnanswered && Boolean(userAns.correct);
            return {
              questionNumber: idx + 1,
              question: q.question,
              options: Array.isArray(q.options) ? q.options : [],
              selectedAnswer: isUnanswered
                ? "Not Answered"
                : userAns?.selected || "Not Answered",
              selectedIndex: isUnanswered ? null : userAns?.selectedIndex,
              correctAnswer:
                Array.isArray(q.options) && q.options[correctIdx] !== undefined
                  ? q.options[correctIdx]
                  : userAns?.correctAnswer || "",
              correctIndex: correctIdx,
              isCorrect,
              isUnanswered,
              explanation: q.explanation || userAns?.explanation || "",
              topic: q.topic || pr.topic || "",
              subtopic: q.subtopic || pr.subtopic || "",
            };
          })
        : [];

    const allCollapsed = reviewList.length > 0 && reviewList.every((_, i) => isQuestionCollapsed(i));

    // SVG Circular score progress calculations
    const radius = 50;
    const circumference = 2 * Math.PI * radius; // ~314.16
    const validPct = Math.min(100, Math.max(0, Number(pr.percentage) || 0));
    const strokeDashoffset = circumference * (1 - validPct / 100);

    return (
      <div className="quiz-page-wrapper">
        <Navbar />
        <main className="practice-result-container">
          {/* 1. RESULT PAGE HEADER CARD */}
          <div className="pr-header-card">
            <div className="pr-header-left">
              <div className="pr-illustration-box">
                <StudyIllustration />
              </div>
              <div className="pr-details-box">
                <span className="pr-badge-pill">Practice Quiz Result</span>
                <h1 className="pr-topic-title" title={pr.topic}>
                  {pr.topic}
                </h1>
                <p className="pr-meta-line">
                  <span className="pr-meta-label">Subtopic:</span>
                  <span className="pr-meta-val">{pr.subtopic || pr.topic}</span>
                </p>
                <p className="pr-meta-line">
                  <span className="pr-meta-label">Material:</span>
                  <span className="pr-meta-val" title={pr.materialName || "Study Material"}>
                    {pr.materialName || "Study Material"}
                  </span>
                </p>
                <p className="pr-meta-line">
                  <span className="pr-meta-icon">📅</span>
                  <span className="pr-meta-label">Attempted on:</span>
                  <span className="pr-meta-val">
                    {formatAttemptDate(pr.attemptedAt || pr.completedAt)}
                  </span>
                </p>
              </div>
            </div>

            {/* Right Score & Status */}
            <div className="pr-score-widget">
              <div className="pr-circle-wrapper">
                <svg className="pr-circle-svg" viewBox="0 0 120 120">
                  <circle
                    cx="60"
                    cy="60"
                    r={radius}
                    fill="none"
                    stroke="#f1f5f9"
                    strokeWidth="10"
                  />
                  <circle
                    cx="60"
                    cy="60"
                    r={radius}
                    fill="none"
                    stroke={isPassed ? "#22c55e" : "#ef4444"}
                    strokeWidth="10"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    style={{ transition: "stroke-dashoffset 0.8s ease-out" }}
                  />
                </svg>
                <div className="pr-circle-text">
                  <span className="pr-circle-pct">{pr.percentage}%</span>
                  <span className="pr-circle-fraction">
                    ({pr.correctCount} / {pr.totalQuestions})
                  </span>
                </div>
                {isPassed && (
                  <div className="pr-trophy-badge" title="Target Met!">
                    🏆
                  </div>
                )}
              </div>

              <div className="pr-status-col">
                <div
                  className={`pr-status-pill ${
                    isPassed ? "status-pill-completed" : "status-pill-pending"
                  }`}
                >
                  {isPassed ? "✓ Completed" : "● In Progress"}
                </div>
                <span className="pr-req-score-text">
                  Required Score: {pr.requiredScore || 70}%
                </span>
              </div>
            </div>
          </div>

          {/* 2. HORIZONTAL PERFORMANCE SUMMARY BAR */}
          <div className="pr-summary-bar">
            <div className="pr-summary-item">
              <div className="pr-item-icon-box icon-purple">?</div>
              <div className="pr-item-content">
                <span className="pr-stat-val">{pr.totalQuestions}</span>
                <span className="pr-stat-label">Total Questions</span>
              </div>
            </div>

            <div className="pr-summary-item">
              <div className="pr-item-icon-box icon-green">✓</div>
              <div className="pr-item-content">
                <span className="pr-stat-val text-success">{pr.correctCount}</span>
                <span className="pr-stat-label">Correct</span>
              </div>
            </div>

            <div className="pr-summary-item">
              <div className="pr-item-icon-box icon-red">✕</div>
              <div className="pr-item-content">
                <span className="pr-stat-val text-danger">{pr.incorrectCount}</span>
                <span className="pr-stat-label">Wrong</span>
              </div>
            </div>

            <div className="pr-summary-item">
              <div className="pr-item-icon-box icon-purple">📊</div>
              <div className="pr-item-content">
                <span
                  className={`pr-stat-val ${
                    improvVal >= 0 ? "text-improvement" : "text-improvement-neg"
                  }`}
                >
                  {pr.hasPreviousAttempt ? improvStr : `${pr.percentage}%`}
                </span>
                <span className="pr-stat-label">Improvement</span>
                <span className="pr-stat-subtext">
                  {pr.hasPreviousAttempt &&
                  pr.prevAccuracy !== null &&
                  pr.prevAccuracy !== undefined
                    ? `(Previous: ${pr.prevAccuracy}% → Current: ${pr.percentage}%)`
                    : `(First Attempt: ${pr.percentage}%)`}
                </span>
              </div>
            </div>
          </div>

          {/* 3. COMPLETION MESSAGE BANNER */}
          <div className={`pr-banner ${isPassed ? "pr-banner-success" : "pr-banner-warning"}`}>
            <span className="pr-banner-icon">{isPassed ? "🎉" : "🎯"}</span>
            <div className="pr-banner-text">
              {isPassed ? (
                <>
                  <strong>Congratulations!</strong> You scored <strong>{pr.percentage}%</strong>. This practice task is now marked as <strong>Completed</strong> in your Revision Plan.
                </>
              ) : (
                <>
                  <strong>Keep practising!</strong> You scored <strong>{pr.percentage}%</strong>. You need at least <strong>{pr.requiredScore || 70}%</strong> to complete this task.
                </>
              )}
            </div>
          </div>

          {/* 4. QUESTION & ANSWER REVIEW SECTION */}
          <div className="pr-review-section">
            <div className="pr-review-header">
              <div className="pr-review-title-wrap">
                <span className="pr-review-book-icon">📖</span>
                <h2 className="pr-review-title">Question & Answer Review</h2>
              </div>
              <div className="pr-review-meta-pills">
                <span className="pr-meta-count">{reviewList.length} Questions</span>
                <span className="pr-meta-divider">|</span>
                <span className="pr-meta-correct">{pr.correctCount} Correct</span>
                {reviewList.length > 0 && (
                  <button
                    type="button"
                    className="pr-btn-toggle-all"
                    onClick={() => toggleCollapseAll(reviewList)}
                  >
                    {allCollapsed ? "▼ Expand All" : "▲ Collapse All"}
                  </button>
                )}
              </div>
            </div>

            {reviewList.length > 0 ? (
              <div className="pr-accordion-list">
                {reviewList.map((item, idx) => {
                  const isCollapsed = isQuestionCollapsed(idx);
                  const isCorrect = item.isCorrect;
                  const isUnanswered = item.isUnanswered;

                  return (
                    <div
                      key={idx}
                      className={`pr-accordion-card ${
                        !isCollapsed
                          ? isCorrect
                            ? "card-open-correct"
                            : isUnanswered
                            ? "card-open-unanswered"
                            : "card-open-incorrect"
                          : ""
                      }`}
                    >
                      {/* Accordion Header */}
                      <div
                        className="pr-accordion-header"
                        onClick={() => toggleQuestionCollapse(idx)}
                        role="button"
                        tabIndex={0}
                        title="Click to expand / collapse this question"
                      >
                        <div className="pr-header-left-wrap">
                          <span
                            className={`pr-q-badge ${
                              isCorrect
                                ? "q-badge-green"
                                : isUnanswered
                                ? "q-badge-amber"
                                : "q-badge-red"
                            }`}
                          >
                            Q{item.questionNumber || idx + 1}
                          </span>
                          <span className="pr-accordion-q-title">{item.question}</span>
                        </div>
                        <div className="pr-header-right-wrap">
                          <span
                            className={`pr-status-pill-sm ${
                              isCorrect
                                ? "pill-correct"
                                : isUnanswered
                                ? "pill-unanswered"
                                : "pill-incorrect"
                            }`}
                          >
                            {isCorrect
                              ? "✓ Correct"
                              : isUnanswered
                              ? "⚠️ Not Answered"
                              : "✕ Incorrect"}
                          </span>
                          <span className="pr-chevron-icon">{isCollapsed ? "▼" : "▲"}</span>
                        </div>
                      </div>

                      {/* Accordion Body */}
                      {!isCollapsed && (
                        <div className="pr-accordion-body">
                          {/* Left Column: 4 Options List */}
                          <div className="pr-options-col">
                            {(item.options || []).map((opt, optIdx) => {
                              const letter = optionLetters[optIdx] || `${optIdx + 1}`;
                              const isSelected =
                                item.selectedIndex === optIdx || item.selectedAnswer === opt;
                              const isCorrectOption =
                                item.correctIndex === optIdx || item.correctAnswer === opt;

                              let optClass = "pr-option-item";
                              let rightMarker = null;

                              if (isSelected && isCorrectOption) {
                                optClass += " opt-selected-correct";
                                rightMarker = (
                                  <span className="pr-check-icon-circle" title="Your Correct Answer">
                                    ✓
                                  </span>
                                );
                              } else if (isSelected && !isCorrectOption) {
                                optClass += " opt-selected-incorrect";
                                rightMarker = (
                                  <span className="pr-cross-icon-circle" title="Your Incorrect Answer">
                                    ✕
                                  </span>
                                );
                              } else if (isCorrectOption) {
                                optClass += " opt-target-correct";
                                rightMarker = (
                                  <span className="pr-target-badge">
                                    ✓ Correct Answer
                                  </span>
                                );
                              }

                              return (
                                <div key={optIdx} className={optClass}>
                                  <div className="pr-opt-left">
                                    <span className="pr-opt-letter">{letter}</span>
                                    <span className="pr-opt-text">{opt}</span>
                                  </div>
                                  {rightMarker}
                                </div>
                              );
                            })}
                          </div>

                          {/* Right Column: Breakdown & Explanation */}
                          <div className="pr-breakdown-col">
                            <div className="pr-ans-box-group">
                              <span className="pr-ans-box-label">Your Answer:</span>
                              <div
                                className={`pr-ans-box ${
                                  isCorrect
                                    ? "ans-box-green"
                                    : isUnanswered
                                    ? "ans-box-amber"
                                    : "ans-box-red"
                                }`}
                              >
                                {item.selectedAnswer || "Not Answered"}
                              </div>
                            </div>

                            <div className="pr-ans-box-group">
                              <span className="pr-ans-box-label">Correct Answer:</span>
                              <div className="pr-ans-box ans-box-purple">
                                {item.correctAnswer ||
                                  (item.options && item.options[item.correctIndex]) ||
                                  "N/A"}
                              </div>
                            </div>

                            <div className="pr-explanation-card">
                              <span className="pr-exp-icon">💡</span>
                              <div className="pr-exp-text">
                                {item.explanation ? (
                                  <>
                                    <strong>Explanation:</strong>{" "}
                                    {item.explanation}
                                  </>
                                ) : (
                                  <span style={{ color: "#94a3b8" }}>
                                    No explanation available for this question.
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ padding: "2rem", textAlign: "center", color: "#64748b" }}>
                No question review details available for this quiz.
              </div>
            )}

            {/* 5. BOTTOM NAVIGATION BUTTONS */}
            <div className="pr-bottom-actions">
              <button
                type="button"
                className="pr-btn-outline"
                onClick={handleBackToRevisionPlan}
              >
                ←{" "}
                {pr.returnPath === "/revision-scheduler"
                  ? "Back to Practice Section"
                  : "Back to Weak Topics"}
              </button>
              <button
                type="button"
                className="pr-btn-solid"
                onClick={handleRetryPracticeQuiz}
              >
                ↻ Retry Practice Quiz
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (quizCompleted) {
    const activeResult =
      quizResult ||
      JSON.parse(localStorage.getItem("lastQuizResult") || "null");

    const resultQuestions =
      activeResult &&
      Array.isArray(activeResult.questions) &&
      activeResult.questions.length > 0
        ? activeResult.questions
        : questions;

    const resultAnswers =
      activeResult &&
      activeResult.answers &&
      typeof activeResult.answers === "object"
        ? activeResult.answers
        : answers;

    const totalQuestions = resultQuestions.length;
    const answerValues = Object.values(resultAnswers);

    const correctCount =
      activeResult?.correctCount !== undefined
        ? activeResult.correctCount
        : answerValues.filter((a) => a.correct).length;

    const incorrectCount =
      activeResult?.incorrectCount !== undefined
        ? activeResult.incorrectCount
        : totalQuestions - correctCount;

    const unansweredCount =
      activeResult?.unansweredCount !== undefined
        ? activeResult.unansweredCount
        : answerValues.filter(
            (a) =>
              a.selectedIndex === null || a.selectedIndex === undefined
          ).length;

    // Accuracy = (Correct Answers / Total Questions) * 100
    const percentage =
      activeResult?.accuracy !== undefined
        ? activeResult.accuracy
        : totalQuestions > 0
        ? Math.round((correctCount / totalQuestions) * 100)
        : 0;

    return (
      <div className="quiz-page-wrapper">
        <Navbar />

        <main className="quiz-container">
          <div className="quiz-score-summary-card">
            <div className="score-summary-header">
              <div className="saas-badge">🎉 Quiz Completed</div>
              <h1 className="summary-title">Quiz Performance Breakdown</h1>
              <p className="summary-subtext">
                Review your score and identify areas for targeted revision.
              </p>
            </div>

            {/* RADIAL SCORE DISPLAY */}
            <div className="score-radial-box">
              <div className="big-score-percentage">{percentage}%</div>
              <div className="score-fraction">
                {correctCount} of {totalQuestions} Correct
              </div>
            </div>

            {/* COMPREHENSIVE STATS METRICS GRID */}
            <div className="quiz-result-stats-grid">
              <div className="result-stat-item">
                <span className="result-stat-label">Total Questions</span>
                <span className="result-stat-val">{totalQuestions}</span>
              </div>
              <div className="result-stat-item">
                <span className="result-stat-label">Correct</span>
                <span className="result-stat-val text-success">{correctCount}</span>
              </div>
              <div className="result-stat-item">
                <span className="result-stat-label">Incorrect</span>
                <span className="result-stat-val text-danger">{incorrectCount}</span>
              </div>
              {unansweredCount > 0 && (
                <div className="result-stat-item">
                  <span className="result-stat-label">Unanswered</span>
                  <span className="result-stat-val text-amber">{unansweredCount}</span>
                </div>
              )}
              <div className="result-stat-item">
                <span className="result-stat-label">Final Score</span>
                <span className="result-stat-val text-primary">
                  {correctCount} / {totalQuestions}
                </span>
              </div>
              <div className="result-stat-item">
                <span className="result-stat-label">Overall Accuracy</span>
                <span className="result-stat-val text-purple">{percentage}%</span>
              </div>
              <div className="result-stat-item">
                <span className="result-stat-label">Performance</span>
                <span className={`result-stat-val ${
                  percentage >= 70 ? "text-success" : percentage >= 40 ? "text-amber" : "text-danger"
                }`}>
                  {percentage >= 70 ? "🏆 Mastered" : percentage >= 40 ? "📈 Needs Practice" : "⚠️ Weak Topic"}
                </span>
              </div>
            </div>

            {/* ERROR ALERT IF ANALYSIS FAILS */}
            {analysisError && (
              <div className="result-error-alert">
                <span>⚠️</span> {analysisError}
              </div>
            )}

            {/* ACTIONS */}
            <div className="summary-actions-row">
              <button
                onClick={handleAnalyzeWeakTopics}
                disabled={analyzingWeakTopics}
                className="saas-btn-primary view-weak-topics-btn"
              >
                {practiceMode ? (
                  <>← Back to Weak Topics</>
                ) : analyzingWeakTopics ? (
                  <>
                    <span className="btn-spinner-sm"></span> Analyzing Weak Topics...
                  </>
                ) : (
                  <>Analyze Weak Topics →</>
                )}
              </button>

              <button
                onClick={resetForNewDifficulty}
                className="saas-btn-secondary"
              >
                🔄 Change Difficulty / Retake
              </button>

              <Link to="/smart-notes" className="saas-btn-secondary">
                📄 View Smart Notes
              </Link>
            </div>

            {/* AI QUIZ – QUESTION & ANSWER REVIEW */}
            {resultQuestions.length > 0 && (() => {
              const optionLettersNQ = ["A", "B", "C", "D"];
              const normalReviewList = resultQuestions.map((q, idx) => {
                const userAns = resultAnswers[q.id];
                const correctIdx = Number(q.answer);
                const isUnanswered =
                  !userAns ||
                  userAns.selectedIndex === null ||
                  userAns.selectedIndex === undefined ||
                  userAns.selected === "Not Answered";
                const isCorrect = !isUnanswered && Boolean(userAns?.correct);
                return {
                  idx,
                  q,
                  userAns,
                  correctIdx,
                  isUnanswered,
                  isCorrect,
                };
              });

              return (
                <div className="practice-review-section" style={{ marginTop: "2rem" }}>
                  <div className="practice-review-header">
                    <div>
                      <h2 className="practice-review-title">AI Quiz – Question & Answer Review</h2>
                      <p className="practice-review-subtitle">
                        Review all {normalReviewList.length} questions, your selected answers, correct solutions, and explanations.
                      </p>
                    </div>
                  </div>
                  <div className="practice-review-list">
                    {normalReviewList.map(({ idx, q, userAns, correctIdx, isUnanswered, isCorrect }) => (
                      <div
                        key={q.id || idx}
                        className={`practice-review-card ${
                          isCorrect
                            ? "review-card-correct"
                            : isUnanswered
                            ? "review-card-unanswered"
                            : "review-card-incorrect"
                        }`}
                      >
                        {/* Header */}
                        <div className="practice-review-card-header" style={{ cursor: "default" }}>
                          <div className="review-header-left">
                            <span className="review-q-number">Question {idx + 1}</span>
                            <span
                              className={`review-status-pill ${
                                isCorrect
                                  ? "status-pill-correct"
                                  : isUnanswered
                                  ? "status-pill-unanswered"
                                  : "status-pill-incorrect"
                              }`}
                            >
                              {isCorrect ? "✅ Correct" : isUnanswered ? "⚠️ Not Answered" : "❌ Incorrect"}
                            </span>
                            {q.topic && (
                              <span className="review-subtopic-tag">{q.topic}</span>
                            )}
                          </div>
                        </div>

                        {/* Question text */}
                        <h3 className="practice-review-question-text">
                          <strong>Question {idx + 1}:</strong> {q.question}
                        </h3>

                        {/* All four options */}
                        <div className="practice-review-body">
                          <div className="practice-options-list">
                            {(Array.isArray(q.options) ? q.options : []).map((opt, optIdx) => {
                              const letter = optionLettersNQ[optIdx] || `${optIdx + 1}`;
                              const isSelected =
                                userAns?.selectedIndex === optIdx ||
                                userAns?.selected === opt;
                              const isCorrectOption = correctIdx === optIdx;

                              let optClass = "practice-opt-item";
                              let badgeText = "";
                              let badgeClass = "";

                              if (isSelected && isCorrectOption) {
                                optClass += " opt-selected-correct";
                                badgeText = "Selected Answer (Correct) ✅";
                                badgeClass = "opt-badge-correct";
                              } else if (isSelected && !isCorrectOption) {
                                optClass += " opt-selected-incorrect";
                                badgeText = "Selected Answer (Incorrect) ❌";
                                badgeClass = "opt-badge-incorrect";
                              } else if (isCorrectOption) {
                                optClass += " opt-is-correct-target";
                                badgeText = "Correct Answer ✓";
                                badgeClass = "opt-badge-target";
                              }

                              return (
                                <div key={optIdx} className={optClass}>
                                  <div className="opt-left">
                                    <span className="opt-letter">{letter}.</span>
                                    <span className="opt-text">{opt}</span>
                                  </div>
                                  {badgeText && (
                                    <span className={`opt-status-badge ${badgeClass}`}>
                                      {badgeText}
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>

                          {/* Summary box */}
                          <div className="practice-answer-summary-box">
                            <div className="answer-summary-row">
                              <span className="answer-summary-label">Your Answer:</span>
                              <span
                                className={`answer-summary-value ${
                                  isCorrect
                                    ? "text-success"
                                    : isUnanswered
                                    ? "text-amber"
                                    : "text-danger"
                                }`}
                              >
                                {userAns?.selected || "Not Answered"}
                                {isCorrect ? " – Correct" : isUnanswered ? " – Not Answered" : " – Incorrect"}
                              </span>
                            </div>
                            <div className="answer-summary-row">
                              <span className="answer-summary-label">Correct Answer:</span>
                              <span className="answer-summary-value text-success" style={{ fontWeight: 700 }}>
                                {Array.isArray(q.options) && q.options[correctIdx] !== undefined
                                  ? q.options[correctIdx]
                                  : userAns?.correctAnswer || "N/A"}
                              </span>
                            </div>

                            {q.explanation && (
                              <div className="practice-explanation-box">
                                <span className="explanation-icon">💡</span>
                                <div className="explanation-content">
                                  <strong>Explanation:</strong> {q.explanation}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        </main>
      </div>
    );
  }

  // =========================================================
  // ACTIVE QUESTION
  // =========================================================

  if (questions.length === 0) {
    const searchParams = new URLSearchParams(window.location.search);
    const effectiveTopic = practiceTopic || searchParams.get("topic") || "";
    const effectiveSubtopic = practiceSubtopic || searchParams.get("subtopic") || "";
    const effectiveMatName = practiceMaterialName || searchParams.get("materialName") || "Study Material";
    const effectiveTaskId = practiceTaskId || searchParams.get("taskId") || "";

    if (practiceMode || practiceTaskId || effectiveTaskId) {
      return (
        <div className="quiz-page-wrapper">
          <Navbar />
          <main className="quiz-container">
            <div className="quiz-error-box">
              <div className="error-icon">📝</div>
              <h2>Practice Quiz Ready</h2>
              {effectiveTopic && (
                <p className="task-topic-heading" style={{ fontSize: "1.1rem", marginBottom: "0.25rem" }}>
                  Topic: <strong>{effectiveTopic}</strong> {effectiveSubtopic && effectiveSubtopic !== effectiveTopic ? `· ${effectiveSubtopic}` : ""}
                </p>
              )}
              {effectiveMatName && (
                <p style={{ color: "#64748b", fontSize: "0.9rem", marginBottom: "1rem" }}>
                  Study Material: 📄 {effectiveMatName}
                </p>
              )}
              <p style={{ color: "#64748b", margin: "1rem 0 1.5rem 0", lineHeight: 1.5 }}>
                Questions for this practice session are ready to be generated. Click below to start your 10-question practice quiz.
              </p>
              <div className="error-actions-row">
                <button
                  onClick={() => {
                    setError("");
                    generateWeakTopicPracticeQuiz({
                      taskId: effectiveTaskId,
                      topic: effectiveTopic,
                      subtopic: effectiveSubtopic,
                      materialId: practiceMaterialId || searchParams.get("materialId") || "",
                      materialName: effectiveMatName,
                      requiredScore: practiceRequiredScore || Number(searchParams.get("requiredScore") || 70),
                      previousAccuracy: practicePreviousAccuracy,
                      returnPath: practiceReturnPath || searchParams.get("returnPath") || "/weak-topics",
                    });
                  }}
                  className="saas-btn-primary"
                >
                  🚀 Start Practice Quiz
                </button>
                <button
                  onClick={handleBackToRevisionPlan}
                  className="saas-btn-secondary"
                >
                  {practiceReturnPath === "/weak-topics" || searchParams.get("returnPath") === "/weak-topics"
                    ? "← Back to Weak Topics"
                    : "← Back to Practice Section"}
                </button>
              </div>
            </div>
          </main>
        </div>
      );
    }

    return (
      <div className="quiz-page-wrapper">
        <Navbar />
        <main className="quiz-container">
          <div className="quiz-error-box">
            <div className="error-icon">⚠️</div>
            <h2>No Questions Available</h2>
            <p style={{ color: "#64748b", margin: "1rem 0 1.5rem 0" }}>
              Please select a difficulty level to generate your AI quiz.
            </p>
            <button
              onClick={resetForNewDifficulty}
              className="saas-btn-primary"
            >
              ← Choose Difficulty
            </button>
          </div>
        </main>
      </div>
    );
  }

  const currentQ = questions[currentIndex];

  if (!currentQ) {
    return (
      <div className="quiz-page-wrapper">
        <Navbar />
        <main className="quiz-container">
          <div className="quiz-error-box">
            <div className="error-icon">⚠️</div>
            <h2>Question Unavailable</h2>
            <p>The selected question could not be loaded.</p>
            <div className="error-actions-row">
              <button
                onClick={() => setCurrentIndex(0)}
                className="saas-btn-primary"
              >
                Go to Question 1
              </button>
              <button
                onClick={handleBackToRevisionPlan}
                className="saas-btn-secondary"
              >
                ← Back to Practice Section
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const progressPercent =
    questions.length > 0
      ? Math.round(
          ((currentIndex + 1) /
            questions.length) *
            100
        )
      : 0;

  const isLastQuestion =
    currentIndex ===
    questions.length - 1;

  // Check if current question is answered either via selectedAnswer or answers map
  const currentQAnswered =
    selectedAnswer !== null ||
    (answers[currentQ?.id]?.selectedIndex !== null &&
      answers[currentQ?.id]?.selectedIndex !== undefined);

  const allAnswered =
    currentQAnswered &&
    areAllQuestionsAnswered();

  return (
    <div className="quiz-page-wrapper">
      <Navbar />

      <main className="quiz-container">

        {/* TOP HEADER */}
        <header className="quiz-page-header">
          <div className="quiz-header-left">
            <span className="saas-badge quiz-diff-badge">
              {practiceMode
                ? "🎯 Task Practice Quiz · Revision Plan"
                : `⚡ ${
                    currentQ.difficulty ||
                    selectedDifficulty ||
                    "Intermediate"
                  } AI Quiz`}
            </span>

            <h1 className="quiz-page-title">
              {practiceMode ? practiceTopic : "AI Quiz Assessment"}
            </h1>
            {practiceMode && (
              <p className="quiz-header-task-sub" style={{ margin: "0.25rem 0 0 0", fontSize: "0.95rem", color: "#64748b" }}>
                {practiceSubtopic && practiceSubtopic !== practiceTopic ? `${practiceSubtopic} · ` : ""}
                📄 {practiceMaterialName || "Study Material"}
              </p>
            )}
          </div>

          {practiceMode ? (
            <button
              onClick={handleBackToRevisionPlan}
              className="saas-btn-secondary"
              title="Return to Weak Topics"
            >
              {practiceReturnPath === "/revision-scheduler"
                ? "← Back to Practice Section"
                : "← Back to Weak Topics"}
            </button>
          ) : (
            <button
              onClick={resetForNewDifficulty}
              className="saas-btn-secondary change-diff-btn"
            >
              ← Change Difficulty
            </button>
          )}
        </header>

        {/* PROGRESS */}
        <section className="quiz-progress-section" aria-label="Quiz Progress">
          <div className="quiz-progress-labels">
            <span className="quiz-progress-count">
              Question {currentIndex + 1} of {questions.length}
            </span>

            <span className="quiz-progress-percent">
              {progressPercent}% Complete
            </span>
          </div>

          <div className="quiz-progress-track">
            <div
              className="quiz-progress-fill"
              style={{
                width: `${progressPercent}%`,
              }}
            ></div>
          </div>
        </section>

        {/* SOURCE WARNING BANNER (IF LIMITED SOURCE MATERIAL) */}
        {sourceWarning && (
          <div
            style={{
              marginBottom: "16px",
              padding: "12px 16px",
              backgroundColor: "#fffbeb",
              border: "1px solid #fef3c7",
              borderLeft: "4px solid #f59e0b",
              borderRadius: "8px",
              color: "#92400e",
              fontSize: "13.5px",
              lineHeight: "1.5",
              display: "flex",
              alignItems: "center",
              gap: "10px",
            }}
          >
            <span style={{ fontSize: "18px" }}>ℹ️</span>
            <span>{sourceWarning}</span>
          </div>
        )}

        {/* QUESTION CARD */}
        <div className="quiz-question-card">
          <h2 className="question-text">
            {currentQ.question}
          </h2>

          <div className="quiz-options-list">
            {(currentQ.options || []).map(
              (option, idx) => (
                <button
                  key={idx}
                  type="button"
                  className={`quiz-option-btn ${
                    selectedAnswer === idx
                      ? "selected"
                      : ""
                  }`}
                  onClick={() =>
                    handleAnswerSelect(idx)
                  }
                >
                  <span className="option-letter">
                    {String.fromCharCode(
                      65 + idx
                    )}
                  </span>

                  <span className="option-text">
                    {option}
                  </span>
                </button>
              )
            )}
          </div>

          {/* EXPLANATION */}
          {currentQ.explanation && (
            <div className="explanation-toggle-box">
              <button
                type="button"
                className="text-toggle-btn"
                onClick={() =>
                  setShowExplanation(
                    !showExplanation
                  )
                }
              >
                {showExplanation
                  ? "💡 Hide Explanation"
                  : "💡 Need a hint / explanation?"}
              </button>

              {showExplanation && (
                <div className="explanation-text">
                  {currentQ.explanation}
                </div>
              )}
            </div>
          )}
        </div>

        {/* CONTROLS */}
        <div className="quiz-controls-row">
          <button
            type="button"
            onClick={handlePrevious}
            disabled={currentIndex === 0}
            className="saas-btn-secondary quiz-control-btn"
          >
            ← Previous Question
          </button>

          {!isLastQuestion ? (
            <>
              <button
                type="button"
                onClick={handleSkip}
                className="saas-btn-secondary quiz-control-btn"
                title="Skip this question and come back to it later"
              >
                Skip Question ↷
              </button>
              <button
                type="button"
                onClick={handleNext}
                className="saas-btn-primary quiz-control-btn"
              >
                Next Question →
              </button>
            </>
          ) : (
            <div className="submit-btn-wrapper">
              <button
                type="button"
                onClick={() => finishQuiz(selectedAnswer)}
                disabled={submitting}
                className="saas-btn-primary quiz-control-btn submit-finish-btn"
              >
                {submitting ? "Submitting Quiz..." : "Submit & Finish Quiz →"}
              </button>
            </div>
          )}
        </div>

      </main>
    </div>
  );
}

export default Quiz;