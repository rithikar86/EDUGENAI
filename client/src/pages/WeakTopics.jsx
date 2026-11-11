import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import PracticeSection from "../components/PracticeSection";
import "../styles/WeakTopics.css";

export const computePerformanceAndMessage = (prevAcc, newAcc) => {
  const prev = Number(prevAcc ?? 0);
  const current = Number(newAcc ?? 0);
  const diff = current - prev;
  const improvementStr = diff > 0 ? `+${diff}%` : `${diff}%`;

  let performance = "";
  let message = "";

  if (diff >= 20 && current >= 75) {
    performance = "Improved ✓";
    message = "Your performance improved well. This subtopic is now better understood.";
  } else if (current >= 80 && diff >= 0) {
    performance = "Improved ✓";
    message = "This subtopic is now performing well.";
  } else if (diff > 0) {
    performance = current >= 70 ? "Improved ✓" : "Needs More Practice";
    message = "Your performance improved. A little more practice can strengthen this subtopic.";
  } else if (diff < 0) {
    performance = "Needs Revision";
    message = "This subtopic still needs more practice and revision.";
  } else {
    performance = current >= 70 ? "Good" : "Needs Revision";
    message = "This subtopic still needs more practice and revision.";
  }

  return {
    previousAccuracy: prev,
    currentAccuracy: current,
    improvement: diff,
    improvementStr,
    performance,
    message,
  };
};

function WeakTopics() {
  const navigate = useNavigate();

  const [analysis, setAnalysis] = useState(null);
  const [revisionProgress, setRevisionProgress] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generatingNotes, setGeneratingNotes] = useState(null);
  const [generatingAllNotes, setGeneratingAllNotes] = useState(false);
  const [message, setMessage] = useState("");

  const getToken = () => localStorage.getItem("token") || sessionStorage.getItem("token");

  useEffect(() => {
    loadWeakTopics();
    persistPracticeAttemptIfPending();
  }, []);

  // Persist any pending practice attempt (from revisionProgress localStorage) to MongoDB
  const persistPracticeAttemptIfPending = async () => {
    try {
      const savedRev = JSON.parse(localStorage.getItem("revisionProgress") || "null");
      if (!savedRev || !savedRev.topic) return;

      // Only persist if not already persisted (track with a flag)
      const alreadySaved = localStorage.getItem("revisionProgressSaved");
      if (alreadySaved === savedRev.quizId) return;

      const token = getToken();
      if (!token) return;

      const payload = {
        taskId: savedRev.taskId || undefined,
        materialId: savedRev.materialId || "",
        topic: savedRev.topic,
        subtopic: savedRev.subtopic || "",
        quizId: savedRev.quizId || "",
        score: savedRev.newCorrect || 0,
        totalQuestions: (savedRev.newCorrect || 0) + (savedRev.newWrong || 0),
        correctCount: savedRev.newCorrect || 0,
        incorrectCount: savedRev.newWrong || 0,
        accuracy: savedRev.newAccuracy || savedRev.newScore || 0,
        previousAccuracy: savedRev.previousAccuracy || savedRev.previousScore || 0,
        improvement: savedRev.improvement || 0,
        requiredScore: savedRev.requiredScore || 70,
      };

      const response = await fetch("http://localhost:5000/api/practice-attempts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (response.ok && data.success) {
        // Mark this quizId as saved so we don't double-save on re-render
        localStorage.setItem("revisionProgressSaved", savedRev.quizId || "saved");
        console.log("Practice attempt saved to server.");
      }
    } catch (err) {
      console.warn("Could not persist practice attempt to server:", err);
    }
  };

  const loadWeakTopics = async () => {
    try {
      setLoading(true);
      const lastResult = JSON.parse(localStorage.getItem("lastQuizResult") || "null");

      if (
        !lastResult ||
        !lastResult.quizId ||
        !lastResult.answers ||
        typeof lastResult.answers !== "object" ||
        Object.keys(lastResult.answers).length === 0
      ) {
        setRevisionProgress(null);
        setSelectedInspection(null);
        setAnalysis({
          hasQuiz: false,
          topics: [],
          incorrectCount: 0,
          averageAccuracy: 0,
        });
        localStorage.setItem("weakTopics", JSON.stringify([]));
        setLoading(false);
        return;
      }

      const mistakes = Array.isArray(lastResult.mistakes) ? lastResult.mistakes : [];
      const aiSaved = JSON.parse(localStorage.getItem("aiWeakTopics") || "null");
      const savedRevProgress = JSON.parse(localStorage.getItem("revisionProgress") || "null");
      const subtopicHistory = JSON.parse(localStorage.getItem("subtopicPracticeHistory") || "{}");
      const lastPracticed = JSON.parse(localStorage.getItem("lastPracticedSubtopic") || "null");

      setRevisionProgress(savedRevProgress);

      const topicMap = {};

      Object.values(lastResult.answers).forEach((answer) => {
        const rawTopic = answer.topic && answer.topic.trim() ? answer.topic.trim() : "";
        const topic = rawTopic && rawTopic !== "General Topic" ? rawTopic : "General Topic";
        const subtopic = answer.subtopic && answer.subtopic.trim() ? answer.subtopic.trim() : "";
        const key = `${topic}|||${subtopic}`;

        if (!topicMap[key]) {
          topicMap[key] = {
            key,
            topic,
            subtopic,
            materialId: lastResult.materialId || "",
            quizId: lastResult.quizId || "",
            total: 0,
            correct: 0,
            incorrect: 0,
          };
        }

        topicMap[key].total += 1;
        if (answer.correct) {
          topicMap[key].correct += 1;
        } else {
          topicMap[key].incorrect += 1;
        }
      });

      let topics = Object.values(topicMap).map((t) => {
        const accuracy = t.total > 0 ? Math.round((t.correct / t.total) * 100) : 0;
        return {
          ...t,
          accuracy,
          severity: accuracy < 40 ? "High Priority" : accuracy < 70 ? "Needs Revision" : "Good",
          recommendation: t.incorrect > 0 ? "Review core definitions and work through practice questions for this section." : "",
        };
      });

      // Enrich with AI analysis ONLY if aiSaved belongs to the current quiz attempt
      if (aiSaved && aiSaved.quizId === lastResult.quizId && Array.isArray(aiSaved.weakTopics) && aiSaved.weakTopics.length > 0) {
        aiSaved.weakTopics.forEach((aiTopic) => {
          const topicName = aiTopic.topic && aiTopic.topic.trim() ? aiTopic.topic.trim() : "General Topic";
          const subtopicName = aiTopic.subtopic && aiTopic.subtopic.trim() ? aiTopic.subtopic.trim() : "";
          const existingIndex = topics.findIndex(
            (t) => t.topic.toLowerCase() === topicName.toLowerCase() && t.subtopic.toLowerCase() === subtopicName.toLowerCase()
          );

          if (existingIndex >= 0) {
            topics[existingIndex] = {
              ...topics[existingIndex],
              severity: aiTopic.severity ? `${aiTopic.severity} Priority` : topics[existingIndex].severity,
              recommendation: aiTopic.revisionAdvice || aiTopic.reason || topics[existingIndex].recommendation,
              aiReason: aiTopic.reason || "",
            };
          }
        });
      }

      // Merge persistent subtopic practice results ONLY for topics belonging to this quiz
      topics = topics.map((t) => {
        const exactKey = `${t.topic.trim().toLowerCase()}|||${(t.subtopic || "").trim().toLowerCase()}`;
        const rawKey = `${t.topic}|||${t.subtopic || ""}`;
        let practiced = subtopicHistory[exactKey] || subtopicHistory[rawKey];
        if (!practiced && t.subtopic) {
          practiced = subtopicHistory[t.subtopic.trim().toLowerCase()];
        }
        if (!practiced && !t.subtopic) {
          practiced = subtopicHistory[t.topic.trim().toLowerCase()];
        }

        if (practiced && (!practiced.materialId || !lastResult.materialId || practiced.materialId === lastResult.materialId)) {
          const newAcc = Number(practiced.newAccuracy);
          return {
            ...t,
            accuracy: newAcc,
            correct: Number(practiced.newCorrect),
            incorrect: Number(practiced.newWrong),
            total: Number(practiced.newCorrect) + Number(practiced.newWrong),
            previousAccuracy: Number(practiced.previousAccuracy),
            improvement: Number(practiced.improvement),
            practiced: true,
            severity: newAcc >= 80 ? "Mastered ✓" : newAcc >= 70 ? "Improved ✓" : newAcc < 40 ? "High Priority" : "Needs Revision",
          };
        }
        return t;
      });

      const hasSpecificTopics = topics.some((t) => t.topic !== "General Topic");
      if (hasSpecificTopics) {
        topics = topics.filter((t) => t.topic !== "General Topic");
      }

      const uniqueTopics = [];
      topics.forEach((t) => {
        const exists = uniqueTopics.some(
          (item) => item.topic.toLowerCase() === t.topic.toLowerCase() && item.subtopic.toLowerCase() === t.subtopic.toLowerCase()
        );
        if (!exists) uniqueTopics.push(t);
      });

      // Keep topics that are weak (<70% accuracy or has mistakes) OR that were weak and practiced in this session
      const weakOnly = uniqueTopics
        .filter((t) => Number(t.accuracy) < 70 || t.incorrect > 0 || t.practiced)
        .sort((a, b) => Number(a.accuracy) - Number(b.accuracy));

      // Save deduplicated topics to localStorage for Dashboard synchronization
      localStorage.setItem("weakTopics", JSON.stringify(weakOnly));

      const avgAcc =
        weakOnly.length > 0
          ? Math.round(
              weakOnly.reduce((sum, t) => sum + Number(t.accuracy), 0) /
                weakOnly.length
            )
          : (lastResult.accuracy !== undefined ? Number(lastResult.accuracy) : 0);

      const overallAcc =
        lastResult.accuracy !== undefined
          ? Number(lastResult.accuracy)
          : lastResult.percentage !== undefined
          ? Number(lastResult.percentage)
          : 0;

      setAnalysis({
        hasQuiz: true,
        quizId: lastResult.quizId,
        materialId: lastResult.materialId,
        overallAccuracy: overallAcc,
        topics: weakOnly,
        incorrectCount: mistakes.length,
        averageAccuracy: avgAcc,
      });

      setLoading(false);

      // --- Load persisted practice attempts from MongoDB and merge into topics ---
      const token = getToken();
      if (token) {
        try {
          const materialId = lastResult.materialId || "";
          const attemptsUrl = `http://localhost:5000/api/practice-attempts${materialId ? `?materialId=${materialId}` : ""}`;
          const res = await fetch(attemptsUrl, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const data = await res.json();

          if (res.ok && data.success && Array.isArray(data.attempts) && data.attempts.length > 0) {
            // Merge server-side practice history into the displayed topics
            setAnalysis((prev) => {
              if (!prev || !Array.isArray(prev.topics)) return prev;
              const mergedTopics = prev.topics.map((t) => {
                const tTopic = String(t.topic || "").trim().toLowerCase();
                const tSub = String(t.subtopic || "").trim().toLowerCase();

                const serverAttempt = data.attempts.find((a) => {
                  const aTopic = String(a.topic || "").trim().toLowerCase();
                  const aSub = String(a.subtopic || "").trim().toLowerCase();
                  if (aTopic !== tTopic) return false;
                  if (tSub) {
                    return aSub === tSub;
                  }
                  return !aSub || aSub === tTopic;
                });
                if (serverAttempt) {
                  const newAcc = Number(serverAttempt.accuracy);
                  return {
                    ...t,
                    accuracy: newAcc,
                    correct: Number(serverAttempt.correctCount),
                    incorrect: Number(serverAttempt.incorrectCount),
                    total: Number(serverAttempt.totalQuestions),
                    previousAccuracy: Number(serverAttempt.previousAccuracy),
                    improvement: Number(serverAttempt.improvement),
                    practiced: true,
                    severity: newAcc >= 80
                      ? "Mastered ✓"
                      : newAcc >= 70
                      ? "Improved ✓"
                      : newAcc < 40
                      ? "High Priority"
                      : "Needs Revision",
                  };
                }
                return t;
              });
              localStorage.setItem("weakTopics", JSON.stringify(mergedTopics));
              return { ...prev, topics: mergedTopics };
            });
          }
        } catch (err) {
          console.warn("Practice attempts fetch error:", err);
        }
      }
    } catch (error) {
      console.error("Weak topic loading error:", error);
      setAnalysis({ hasQuiz: false, topics: [], incorrectCount: 0, averageAccuracy: 0 });
      setLoading(false);
    }
  };

  const generateRevisionNotes = async (topic) => {
    try {
      setGeneratingNotes(topic.key);
      setMessage("");

      const token = getToken();
      if (!token) throw new Error("Please login again to generate notes.");

      const lastResult = JSON.parse(localStorage.getItem("lastQuizResult") || "{}");
      const mistakes = JSON.parse(localStorage.getItem("quizMistakes") || "[]");

      const response = await fetch("http://localhost:5000/api/generate-weak-topic-notes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          topic: topic.topic,
          subtopic: topic.subtopic,
          materialId: topic.materialId || lastResult.materialId || "",
          mistakes,
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Failed to generate targeted Smart Notes.");
      }

      const sourceFileName = data.sourceFileName || "Study Material";
      const newWeakNote = {
        id: data.id || data.noteId || `weak-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        materialId: data.materialId || topic.materialId || "",
        title: data.title || `${sourceFileName} - Weak Topic - ${topic.topic}`,
        sourceFileName: sourceFileName,
        fileName: sourceFileName,
        topic: topic.topic,
        subtopic: topic.subtopic,
        notes: data.notes || "",
        createdAt: data.createdAt || new Date().toISOString(),
        type: "weak-topic-revision",
      };

      const existingNotes = JSON.parse(localStorage.getItem("smartNotes") || "[]");
      const updatedNotes = [newWeakNote, ...existingNotes.filter((n) => n.id !== newWeakNote.id)];
      localStorage.setItem("smartNotes", JSON.stringify(updatedNotes));

      // Append to weakTopicNotes array (preserving all previous revision notes)
      const existingWeak = JSON.parse(localStorage.getItem("weakTopicNotes") || "[]");
      const weakArray = Array.isArray(existingWeak)
        ? existingWeak
        : (existingWeak && typeof existingWeak === "object" && existingWeak.notes ? [existingWeak] : []);
      const updatedWeak = [newWeakNote, ...weakArray.filter((n) => n.id !== newWeakNote.id)];
      localStorage.setItem("weakTopicNotes", JSON.stringify(updatedWeak));

      localStorage.setItem("selectedFlashcardNote", JSON.stringify(newWeakNote));
      localStorage.setItem("selectedQuizNote", JSON.stringify(newWeakNote));
      if (newWeakNote.materialId) {
        localStorage.setItem("activeMaterialId", String(newWeakNote.materialId));
      }

      navigate("/smart-notes");
    } catch (error) {
      console.error("Targeted revision notes error:", error);
      setMessage(error.message || "Unable to generate targeted Smart Notes.");
    } finally {
      setGeneratingNotes(null);
    }
  };

  const generateCompleteWeakNotes = async () => {
    if (!analysis || !Array.isArray(analysis.topics) || analysis.topics.length === 0) {
      setMessage("No weak topics available to generate complete revision notes.");
      return;
    }

    try {
      setGeneratingAllNotes(true);
      setMessage("");

      const token = getToken();
      if (!token) throw new Error("Please login again to generate notes.");

      const lastResult = JSON.parse(localStorage.getItem("lastQuizResult") || "{}");
      const targetMaterialId = analysis.topics[0]?.materialId || lastResult.materialId || "";

      const topicsPayload = analysis.topics.map((t) => ({
        topic: t.topic,
        subtopic: t.subtopic || "",
        accuracy: t.accuracy,
        mistakeCount: t.incorrect || t.mistakeCount || 0,
      }));

      const response = await fetch("http://localhost:5000/api/generate-complete-weak-notes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          topics: topicsPayload,
          materialId: targetMaterialId,
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.message || "Failed to generate complete Weak Topic Smart Notes.");
      }

      const sourceFileName = data.sourceFileName || "Study Material";
      const newCompleteNote = {
        id: data.id || data.noteId || `weak-complete-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        materialId: data.materialId || targetMaterialId,
        title: data.title || `${sourceFileName} - AI Revision Note (Complete Weak Topics)`,
        sourceFileName: sourceFileName,
        fileName: sourceFileName,
        topic: "Complete Weak Topics Revision",
        subtopic: `${topicsPayload.length} Topics Covered`,
        topics: topicsPayload,
        notes: data.notes || "",
        createdAt: data.createdAt || new Date().toISOString(),
        type: "weak-topic-complete",
      };

      // Save to smartNotes array
      const existingNotes = JSON.parse(localStorage.getItem("smartNotes") || "[]");
      const updatedNotes = [newCompleteNote, ...existingNotes.filter((n) => n.id !== newCompleteNote.id)];
      localStorage.setItem("smartNotes", JSON.stringify(updatedNotes));

      // Save to weakTopicNotes array for Dashboard tracking & Revision Notes count
      const existingWeak = JSON.parse(localStorage.getItem("weakTopicNotes") || "[]");
      const weakArray = Array.isArray(existingWeak)
        ? existingWeak
        : (existingWeak && typeof existingWeak === "object" && existingWeak.notes ? [existingWeak] : []);
      const updatedWeak = [newCompleteNote, ...weakArray.filter((n) => n.id !== newCompleteNote.id)];
      localStorage.setItem("weakTopicNotes", JSON.stringify(updatedWeak));

      localStorage.setItem("selectedFlashcardNote", JSON.stringify(newCompleteNote));
      localStorage.setItem("selectedQuizNote", JSON.stringify(newCompleteNote));
      if (newCompleteNote.materialId) {
        localStorage.setItem("activeMaterialId", String(newCompleteNote.materialId));
      }

      navigate("/smart-notes");
    } catch (error) {
      console.error("Complete revision notes generation error:", error);
      setMessage(error.message || "Unable to generate complete Weak Topic Smart Notes.");
    } finally {
      setGeneratingAllNotes(false);
    }
  };

  const startRevisionMode = (topic) => {
    // Clear any stale active quiz questions to ensure fresh practice generation
    localStorage.removeItem("quizQuestions");
    localStorage.removeItem("aiQuiz");
    localStorage.removeItem("quizAnswers");
    localStorage.removeItem("quizData");
    localStorage.removeItem("generatedQuiz");

    const lastResult = JSON.parse(localStorage.getItem("lastQuizResult") || "{}");
    const currentAccuracy = Number(topic.accuracy ?? 0);
    const targetMaterialId = topic.materialId || lastResult.materialId || "";

    const rawTopic = topic.topic && topic.topic !== "General Topic" ? topic.topic.trim() : (topic.subtopic ? topic.subtopic.trim() : "Core Concepts");
    const rawSubtopic = topic.subtopic && topic.subtopic !== "Not specified" ? topic.subtopic.trim() : "";

    const practicePayload = {
      quizId: lastResult.quizId || "",
      topic: rawTopic,
      subtopic: rawSubtopic,
      materialId: targetMaterialId,
      previousAccuracy: currentAccuracy,
      previousCorrect: Number(topic.correct || 0),
      previousWrong: Number(topic.incorrect || topic.mistakeCount || 0),
      count: 10,
    };

    localStorage.setItem("weakTopicQuiz", JSON.stringify(practicePayload));
    localStorage.setItem("prePracticeScore", JSON.stringify(practicePayload));
    if (targetMaterialId) {
      localStorage.setItem("activeMaterialId", targetMaterialId);
    }

    const query = new URLSearchParams({
      topic: rawTopic,
      subtopic: rawSubtopic,
      materialId: targetMaterialId,
      previousAccuracy: String(currentAccuracy),
      hasPreviousAttempt: "true",
      returnPath: "/weak-topics",
    });

    navigate(`/quiz?${query.toString()}`);
  };

  const dismissRevisionProgress = () => {
    localStorage.removeItem("revisionProgress");
    setRevisionProgress(null);
  };

  if (loading) {
    return (
      <div className="weak-topics-page-wrapper">
        <Navbar />
        <main className="weak-topics-container saas-container">
          <div className="weak-loading-box">
            <div className="spinner"></div>
            <h2>Analyzing Learning Performance...</h2>
            <p>Gathering quiz responses to identify targeted weak topics.</p>
          </div>
        </main>
      </div>
    );
  }

  const hasWeakTopics = analysis && Array.isArray(analysis.topics) && analysis.topics.length > 0;

  return (
    <div className="weak-topics-page-wrapper">
      <Navbar />

      <main className="weak-topics-container saas-container">
        {/* MESSAGES / ALERTS */}
        {message && (
          <div className="upload-alert-box error" style={{ marginBottom: "1.5rem" }}>
            <span>⚠️</span> {message}
          </div>
        )}

        {/* 1. REVISION IMPROVEMENT BANNER (WHEN AVAILABLE) */}
        {revisionProgress && (
          <div className="revision-improvement-banner">
            <div className="banner-info">
              <span className="banner-badge">⭐ REVISION SCORE PROGRESS</span>
              <h3>Topic: {revisionProgress.topic} {revisionProgress.subtopic ? `(${revisionProgress.subtopic})` : ""}</h3>
              <p>Previous Accuracy: <strong>{revisionProgress.previousScore || revisionProgress.previousAccuracy || 0}%</strong> → New Accuracy: <strong>{revisionProgress.newScore || revisionProgress.newAccuracy || 0}%</strong></p>
            </div>
            <div className="banner-action">
              <span className="banner-pill">
                {revisionProgress.improvement >= 0
                  ? `+${revisionProgress.improvement}% Score Change ↑`
                  : `${revisionProgress.improvement}% Score Change ↓`}
              </span>
              <button onClick={dismissRevisionProgress} className="banner-close-btn" title="Dismiss">✕</button>
            </div>
          </div>
        )}

        {!analysis || !analysis.hasQuiz ? (
          /* NO QUIZ COMPLETED EMPTY STATE */
          <div className="weak-empty-card">
            <div className="empty-icon-circle">📝</div>
            <h2 className="empty-title">No Completed Quiz Found</h2>
            <p className="empty-subtext">
              Please complete and submit an AI Quiz first to analyze your performance and identify weak topics.
            </p>
            <Link to="/quiz" className="saas-btn-primary">
              Take AI Quiz Now →
            </Link>
          </div>
        ) : !hasWeakTopics ? (
          /* ALL TOPICS PASSED EMPTY STATE */
          <div className="weak-empty-card">
            <div className="empty-icon-circle">✓</div>
            <h2 className="empty-title">You're doing well!</h2>
            <p className="empty-subtext">
              No weak topics have been identified in your latest quiz. All tested topics scored 70% or higher.
            </p>
            <Link to="/quiz" className="saas-btn-primary">
              Take AI Quiz Now →
            </Link>
          </div>
        ) : (
          <div>
            {/* SUMMARY STATS ROW */}
            <div className="weak-stats-summary-grid">
              <div className="summary-stat-card">
                <div className="stat-card-title">Overall Quiz Accuracy</div>
                <div className="stat-card-value text-indigo">{analysis.overallAccuracy}%</div>
                <div className="stat-card-subtext">From latest completed quiz</div>
              </div>

              <div className="summary-stat-card">
                <div className="stat-card-title">Weak Topics</div>
                <div className="stat-card-value text-purple">{analysis.topics.length}</div>
                <div className="stat-card-subtext">Scoring under 70% accuracy</div>
              </div>

              <div className="summary-stat-card">
                <div className="stat-card-title">Weak Topic Average</div>
                <div className="stat-card-value text-amber">{analysis.averageAccuracy}%</div>
                <div className="stat-card-subtext">Across weak topic areas</div>
              </div>

              <div className="summary-stat-card">
                <div className="stat-card-title">Total Mistakes</div>
                <div className="stat-card-value text-danger">{analysis.incorrectCount}</div>
                <div className="stat-card-subtext">Questions to review</div>
              </div>
            </div>

            {/* MAIN SINGLE WEAK TOPICS TABLE CONTAINER */}
            <div className="weak-analysis-main-card">
              <div className="card-header-bar">
                <div>
                  <h2 className="card-header-title">Weak Topic Analysis</h2>
                  <p className="card-header-subtext">
                    Topics that need more revision based on your quiz performance.
                  </p>
                </div>

                <button
                  onClick={generateCompleteWeakNotes}
                  disabled={generatingAllNotes || generatingNotes !== null}
                  className="btn-complete-weak-notes"
                  title="Generate one comprehensive AI Revision Note covering all weak topics"
                >
                  {generatingAllNotes ? (
                    <>
                      <span className="btn-spinner-sm"></span> Generating Notes...
                    </>
                  ) : (
                    <>📚 Generate Weak Topic Smart Notes</>
                  )}
                </button>
              </div>

              {/* COMPACT TABLE LAYOUT */}
              <div className="weak-table-responsive-wrapper">
                <table className="weak-analysis-table">
                  <colgroup>
                    <col className="col-topic-colgroup" />
                    <col className="col-accuracy-colgroup" />
                    <col className="col-perf-colgroup" />
                    <col className="col-status-colgroup" />
                    <col className="col-actions-colgroup" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="th-topic">Topic & Subtopic</th>
                      <th className="th-accuracy">Accuracy</th>
                      <th className="th-performance">Performance</th>
                      <th className="th-status">Status</th>
                      <th className="th-actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.topics.map((t) => {
                      const hasValidResult = (t.total !== undefined && t.total > 0) || t.practiced || (t.accuracy !== undefined && t.accuracy !== null && !isNaN(t.accuracy));
                      const accuracy = hasValidResult ? Number(t.accuracy || 0) : null;
                      const isHighPriority = accuracy !== null && accuracy < 40;
                      const isMastered = accuracy !== null && accuracy >= 80;
                      const isImproving = t.practiced && !isMastered && Number(t.improvement || 0) > 0;

                      // Determine accuracy pill class
                      const pillClass = accuracy === null
                        ? "pill-neutral"
                        : isMastered
                        ? "pill-success"
                        : isImproving
                        ? "pill-info"
                        : isHighPriority
                        ? "pill-danger"
                        : "pill-warning";

                      const fillClass = accuracy === null
                        ? "bg-neutral"
                        : isMastered
                        ? "bg-success"
                        : isImproving
                        ? "bg-info"
                        : isHighPriority
                        ? "bg-danger"
                        : "bg-warning";

                      // Determine status badge
                      let statusLabel = t.severity || (accuracy === null ? "Not Assessed" : isHighPriority ? "High Priority" : "Needs Revision");
                      let badgeClass = isHighPriority ? "badge-high" : "badge-medium";
                      if (accuracy === null) {
                        badgeClass = "badge-neutral";
                      } else if (isMastered) {
                        statusLabel = "Mastered ✓";
                        badgeClass = "badge-mastered";
                      } else if (isImproving) {
                        statusLabel = "Improving ↑";
                        badgeClass = "badge-improving";
                      }

                      return (
                        <tr key={t.key} className="weak-table-row">
                          <td className="col-topic-cell">
                            <div className="topic-name-bold">{t.topic}</div>
                            {t.subtopic && <div className="subtopic-name-muted">Subtopic: {t.subtopic}</div>}
                          </td>

                          <td className="col-accuracy-cell">
                            <div className="accuracy-pill-wrap">
                              <span className={`accuracy-pill ${pillClass}`}>
                                {accuracy !== null ? `${accuracy}%` : "--"}
                              </span>
                              <div className="compact-progress-track">
                                <div
                                  className={`compact-progress-fill ${fillClass}`}
                                  style={{ width: `${accuracy !== null ? Math.max(5, Math.min(100, accuracy)) : 0}%` }}
                                ></div>
                              </div>
                            </div>
                          </td>

                          <td className="col-perf-cell">
                            <div className="perf-counts">
                              <span className="count-correct">✓ {t.correct || 0}</span>
                              <span className="count-divider">/</span>
                              <span className="count-wrong">❌ {t.incorrect || t.mistakeCount || 0}</span>
                            </div>
                          </td>

                          <td className="col-status-cell">
                            <span className={`status-badge ${badgeClass}`}>
                              {statusLabel}
                            </span>
                          </td>

                          <td className="col-actions-cell">
                            <div className="action-buttons-inline">
                              <button
                                onClick={() => generateRevisionNotes(t)}
                                disabled={generatingNotes === t.key}
                                className="action-btn action-btn-primary"
                                title="Generate targeted revision notes for this topic"
                              >
                                {generatingNotes === t.key ? "Generating..." : "Generate Revision Notes"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 4. PRACTICE SECTION DIRECTLY BELOW WEAK TOPIC ANALYSIS TABLE */}
            <PracticeSection returnPath="/weak-topics" />
          </div>
        )}

        {/* Fallback Practice Section for empty states when no active weak topics in latest quiz */}
        {(!analysis || !analysis.hasQuiz || !hasWeakTopics) && (
          <div style={{ marginTop: "2rem" }}>
            <PracticeSection returnPath="/weak-topics" />
          </div>
        )}

      </main>
    </div>
  );
}

export default WeakTopics;