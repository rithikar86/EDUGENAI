import { useEffect, useState, useCallback, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import "../styles/RevisionScheduler.css";

const API = "http://localhost:5000";

// ─── Utility Helpers ─────────────────────────────────────────────────────────
const getToken = () =>
  localStorage.getItem("token") || sessionStorage.getItem("token");

export const parseDateParts = (d) => {
  if (!d) return null;
  if (typeof d === "string") {
    const match = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10) - 1;
      const day = parseInt(match[3], 10);
      return new Date(year, month, day, 12, 0, 0);
    }
  }
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return null;
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 12, 0, 0);
};

export const toYYYYMMDD = (val) => {
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

export const getTaskDateKey = (task) => {
  if (!task) return "";
  if (task.scheduledDateKey && typeof task.scheduledDateKey === "string") {
    const k = task.scheduledDateKey.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(k)) return k;
  }
  return toYYYYMMDD(task.scheduledDate);
};

export const fmtDate = (d) => {
  if (!d) return "—";
  const dt = parseDateParts(d);
  if (!dt) return "—";
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

export const fmtShortDate = (d) => {
  if (!d) return "—";
  const dt = parseDateParts(d);
  if (!dt) return "—";
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

export const isSameDay = (d1, d2) => {
  if (!d1 || !d2) return false;
  return toYYYYMMDD(d1) === toYYYYMMDD(d2);
};

export const isToday = (d) => isSameDay(d, new Date());

export const extractTopicsForRevision = (lastResult, storedWeakTopics) => {
  // If the last quiz achieved 100%, NO revision tasks should be extracted
  if (lastResult) {
    const total = Number(
      lastResult.totalQuestions ||
      (Array.isArray(lastResult.questions) ? lastResult.questions.length : 0)
    );
    const correct = Number(
      lastResult.correctCount !== undefined
        ? lastResult.correctCount
        : lastResult.score !== undefined
        ? lastResult.score
        : 0
    );
    const accuracy = Number(
      lastResult.accuracy !== undefined
        ? lastResult.accuracy
        : total > 0
        ? (correct / total) * 100
        : 0
    );

    if (total > 0 && (correct >= total || accuracy >= 100)) {
      return [];
    }
  }

  if (Array.isArray(storedWeakTopics) && storedWeakTopics.length > 0) {
    const valid = storedWeakTopics.filter((t) => t && (t.topic || typeof t === "string"));
    if (valid.length > 0) {
      return valid.map((t) => ({
        topic: typeof t === "string" ? t : t.topic,
        subtopic: typeof t === "string" ? "" : (t.subtopic || ""),
        accuracy: t.accuracy !== undefined ? Number(t.accuracy) : 50,
        incorrect: t.incorrect || t.mistakeCount || 0,
      }));
    }
  }

  if (lastResult && lastResult.answers && typeof lastResult.answers === "object") {
    const topicStats = {};
    Object.values(lastResult.answers).forEach((ans) => {
      const topic = (ans.topic || "").trim() || "Core Concepts";
      const subtopic = (ans.subtopic || "").trim() || topic;
      const key = `${topic}|||${subtopic}`;
      if (!topicStats[key]) {
        topicStats[key] = { topic, subtopic, correct: 0, total: 0, incorrect: 0 };
      }
      topicStats[key].total += 1;
      if (ans.correct) topicStats[key].correct += 1;
      else topicStats[key].incorrect += 1;
    });

    const weakOnly = Object.values(topicStats)
      .filter((t) => t.incorrect > 0 || (t.total > 0 && Math.round((t.correct / t.total) * 100) < 70))
      .map((t) => ({
        topic: t.topic,
        subtopic: t.subtopic,
        accuracy: t.total > 0 ? Math.round((t.correct / t.total) * 100) : 50,
        incorrect: t.incorrect,
        total: t.total,
      }));

    if (weakOnly.length > 0) return weakOnly;
  }

  return [];
};

// ─── Consistent Task Status Calculator ─────────────────────────────────────────
// Minimum Required Practice Score: 70%
// 1. If attempted and score >= 70% -> Completed
// 2. If attempted and score < 70%  -> In Progress (e.g. 10%, 30%, 50%, 60%, 69%)
// 3. If unattempted (no score)     -> Pending
export const computeTaskStatus = (task) => {
  if (!task) return "Pending";
  const reqScore = Number(task.requiredScore || 70);
  const hasScore =
    task.latestPracticeAccuracy !== null &&
    task.latestPracticeAccuracy !== undefined &&
    !isNaN(Number(task.latestPracticeAccuracy));

  if (!hasScore) {
    return task.status === "In Progress" ? "In Progress" : "Pending";
  }

  const score = Number(task.latestPracticeAccuracy);
  if (score >= reqScore) {
    return "Completed";
  } else {
    return "In Progress";
  }
};

export default function PracticeSection({ returnPath = "/weak-topics", embedded = true }) {
  const navigate = useNavigate();

  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [updatingId, setUpdatingId] = useState(null);
  const [message, setMessage] = useState({ text: "", type: "" });

  // Calendar State
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(null);

  const lastQuizResult = (() => {
    try {
      return JSON.parse(localStorage.getItem("lastQuizResult") || "null");
    } catch (e) {
      return null;
    }
  })();

  const isLatestQuiz100Percent = Boolean(
    lastQuizResult &&
    (
      (Number(lastQuizResult.totalQuestions) > 0 &&
       Number(lastQuizResult.correctCount ?? lastQuizResult.score ?? 0) >= Number(lastQuizResult.totalQuestions)) ||
      Number(lastQuizResult.accuracy) >= 100
    )
  );

  // ── Load saved plan from MongoDB ───────────────────────────────────────────
  const loadPlan = useCallback(async () => {
    setLoading(true);
    try {
      const token = getToken();
      if (!token) return;

      const res = await fetch(`${API}/api/revision-plan`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setTasks(data.tasks || []);
      } else {
        showMessage(data.message || "Failed to load revision plan.", "error");
      }
    } catch (err) {
      showMessage("Could not connect to the server. Please check your connection.", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPlan();
  }, [loadPlan]);

  // ── Restore Feedback & Context from Practice Quiz ─────────────────────────
  useEffect(() => {
    const feedbackStr = localStorage.getItem("revisionPracticeFeedback");
    if (feedbackStr) {
      try {
        const feedback = JSON.parse(feedbackStr);
        if (feedback && feedback.timestamp && Date.now() - feedback.timestamp < 3600000) {
          const reqScore = feedback.requiredScore || 70;
          if (feedback.passed) {
            showMessage(
              `🎉 Practice Quiz Completed: Scored ${feedback.accuracy}% on "${feedback.topic}"! Task completed successfully and marked as Completed.`,
              "success"
            );
          } else {
            showMessage(
              `📝 Practice Quiz Completed: Scored ${feedback.accuracy}% on "${feedback.topic}". Score must be ${reqScore}% or above to complete. Task marked as In Progress.`,
              "error"
            );
          }
        }
      } catch (e) {
        // ignore
      }
      localStorage.removeItem("revisionPracticeFeedback");
    }

    const savedDate = localStorage.getItem("activePracticeDate");
    if (savedDate) {
      const d = parseDateParts(savedDate);
      if (d) {
        setSelectedCalendarDate(d);
        setCalendarDate(new Date(d.getFullYear(), d.getMonth(), 1));
      }
      localStorage.removeItem("activePracticeDate");
    }
  }, []);

  // ── Generate / Regenerate Revision Plan ───────────────────────────────────
  const handleGeneratePlan = async () => {
    setGenerating(true);
    setMessage({ text: "", type: "" });

    try {
      const token = getToken();
      if (!token) throw new Error("Please log in to generate your revision plan.");

      const lastResult = JSON.parse(localStorage.getItem("lastQuizResult") || "null");
      const storedWeak = JSON.parse(localStorage.getItem("weakTopics") || "[]");

      const extractedTopics = extractTopicsForRevision(lastResult, storedWeak);

      const targetMaterialId =
        lastResult?.materialId ||
        storedWeak?.[0]?.materialId ||
        localStorage.getItem("activeMaterialId") ||
        "";

      const payload = {
        quizId: lastResult?.quizId || `session-${Date.now()}`,
        materialId: targetMaterialId,
        weakTopics: extractedTopics,
        totalQuestions: lastResult?.totalQuestions,
        correctCount: lastResult?.correctCount,
        score: lastResult?.score,
        accuracy: lastResult?.accuracy,
      };

      const res = await fetch(`${API}/api/revision-plan`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        if (data.isPerfectScore) {
          showMessage(
            data.message || "🌟 Outstanding! You scored 100% on this quiz. All questions answered correctly — no revision tasks needed.",
            "success"
          );
        } else if (data.tasksCreated && data.tasksCreated.length > 0) {
          showMessage(
            `🎉 Revision plan updated: Added ${data.tasksCreated.length} new revision task(s) on ${fmtShortDate(data.assignedDate) || data.assignedDate}!`,
            "success"
          );
        } else {
          showMessage(
            data.message || "Your revision plan is already up to date. All weak topics already have tasks.",
            "success"
          );
        }
        await loadPlan();
      } else {
        showMessage(data.message || "Failed to generate revision plan.", "error");
      }
    } catch (err) {
      showMessage(err.message || "Error generating plan. Please try again.", "error");
    } finally {
      setGenerating(false);
    }
  };

  // ── Action: Practice Quiz ──────────────────────────────────────────────────
  const handlePracticeQuiz = (task) => {
    localStorage.removeItem("quizQuestions");
    localStorage.removeItem("aiQuiz");
    localStorage.removeItem("quizAnswers");
    localStorage.removeItem("quizData");
    localStorage.removeItem("generatedQuiz");
    localStorage.removeItem("activePracticeResult");

    const lastResult = JSON.parse(localStorage.getItem("lastQuizResult") || "{}");
    const hasPriorAttempt = task.latestPracticeAccuracy !== null && task.latestPracticeAccuracy !== undefined;
    const taskIdStr = String(task.id || task._id || task.taskId || "");
    const materialIdStr = String(task.materialId || lastResult.materialId || "");

    const payload = {
      taskId: taskIdStr,
      quizId: task.quizId || lastResult.quizId || "",
      topic: task.topic,
      subtopic: task.subtopic || task.topic,
      materialId: materialIdStr,
      materialName: task.materialName || "Study Material",
      hasPreviousAttempt: hasPriorAttempt,
      previousAccuracy: hasPriorAttempt ? Number(task.latestPracticeAccuracy) : null,
      requiredScore: Number(task.requiredScore || 70),
      count: 10,
      returnPath: returnPath,
    };
    localStorage.setItem("weakTopicQuiz", JSON.stringify(payload));
    localStorage.setItem("activePracticeTask", JSON.stringify(payload));
    localStorage.setItem("prePracticeScore", JSON.stringify(payload));
    localStorage.setItem("activePracticeTaskId", taskIdStr);
    if (task.scheduledDate) {
      localStorage.setItem("activePracticeDate", String(task.scheduledDate));
    } else if (selectedCalendarDate) {
      localStorage.setItem("activePracticeDate", toYYYYMMDD(selectedCalendarDate));
    }
    if (materialIdStr) {
      localStorage.setItem("activeMaterialId", materialIdStr);
    }

    const query = new URLSearchParams({
      taskId: taskIdStr,
      topic: task.topic || "",
      subtopic: task.subtopic || task.topic || "",
      materialId: materialIdStr,
      materialName: task.materialName || "Study Material",
      hasPreviousAttempt: hasPriorAttempt ? "true" : "false",
      previousAccuracy: hasPriorAttempt ? String(task.latestPracticeAccuracy) : "",
      requiredScore: String(task.requiredScore || 70),
      returnPath: returnPath,
    });

    navigate(`/quiz?${query.toString()}`);
  };

  // ── Action: Open Notes ─────────────────────────────────────────────────────
  const handleOpenNotes = async (task) => {
    const token = getToken();
    if (!token) {
      navigate("/login");
      return;
    }

    if (task.materialId) {
      try {
        const params = new URLSearchParams({ materialId: task.materialId });
        if (task.topic) params.set("topic", task.topic);
        if (task.subtopic) params.set("subtopic", task.subtopic);
        const res = await fetch(`${API}/api/notes/for-task?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (res.ok && data.success && data.note) {
          const noteRef = {
            id: data.note.id,
            materialId: data.note.materialId,
            title: data.note.title,
            sourceFileName: data.note.sourceFileName,
            notes: data.note.content,
            type: data.note.type,
            youtubeUrl: data.note.youtubeUrl || null,
            sourceType: data.note.sourceType || null,
          };
          localStorage.setItem("selectedFlashcardNote", JSON.stringify(noteRef));
          localStorage.setItem("selectedQuizNote", JSON.stringify(noteRef));
          localStorage.setItem("activeMaterialId", String(task.materialId));
          navigate(`/smart-notes?noteId=${data.note.id}`);
          return;
        }
      } catch (err) {
        console.warn("Could not fetch specific note for task:", err);
      }
      localStorage.setItem("activeMaterialId", String(task.materialId));
    }
    navigate("/smart-notes");
  };

  const showMessage = (text, type) => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: "", type: "" }), 6000);
  };

  // ── Metrics & Calculations ────────────────────────────────────────────────
  const totalTasksCount = tasks.length;
  const completedTasksCount = tasks.filter((t) => computeTaskStatus(t) === "Completed").length;
  const pendingTasksCount = totalTasksCount - completedTasksCount;
  const completionRate =
    totalTasksCount > 0 ? Math.round((completedTasksCount / totalTasksCount) * 100) : 0;

  // Filter tasks for the active date (EXACT DATE ONLY)
  const displayedTasks = useMemo(() => {
    const targetKey = selectedCalendarDate
      ? toYYYYMMDD(selectedCalendarDate)
      : toYYYYMMDD(new Date());
    return tasks.filter((t) => {
      const taskDateKey = getTaskDateKey(t);
      return taskDateKey === targetKey;
    });
  }, [tasks, selectedCalendarDate]);

  // Upcoming Tasks (scheduled strictly after today and not completed)
  const upcomingTasks = useMemo(() => {
    const todayKey = toYYYYMMDD(new Date());
    return tasks
      .filter((t) => {
        const taskKey = getTaskDateKey(t);
        return taskKey && taskKey > todayKey && computeTaskStatus(t) !== "Completed";
      })
      .sort((a, b) => {
        const da = getTaskDateKey(a);
        const db = getTaskDateKey(b);
        return da.localeCompare(db);
      })
      .slice(0, 6);
  }, [tasks]);

  // ── Calendar Helpers ──────────────────────────────────────────────────────
  const calendarYear = calendarDate.getFullYear();
  const calendarMonth = calendarDate.getMonth();
  const monthName = calendarDate.toLocaleString("default", { month: "long" });

  const prevMonth = () => {
    setCalendarDate(new Date(calendarYear, calendarMonth - 1, 1));
  };

  const nextMonth = () => {
    setCalendarDate(new Date(calendarYear, calendarMonth + 1, 1));
  };

  const jumpToToday = () => {
    const now = new Date();
    setCalendarDate(now);
    setSelectedCalendarDate(null);
  };

  // Calendar grid days
  const calendarDays = useMemo(() => {
    const firstDayIndex = new Date(calendarYear, calendarMonth, 1).getDay();
    const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(calendarYear, calendarMonth, 0).getDate();

    const days = [];

    // Prev month padding
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      days.push({
        dayNum: daysInPrevMonth - i,
        date: new Date(calendarYear, calendarMonth - 1, daysInPrevMonth - i, 12, 0, 0),
        isCurrentMonth: false,
      });
    }

    // Current month days
    for (let i = 1; i <= daysInMonth; i++) {
      days.push({
        dayNum: i,
        date: new Date(calendarYear, calendarMonth, i, 12, 0, 0),
        isCurrentMonth: true,
      });
    }

    // Next month padding to maintain a fixed 42-slot grid (6 rows x 7 days)
    // This prevents layout bouncing/shifting when toggling between 5-week and 6-week months
    let nextMonthDay = 1;
    while (days.length < 42) {
      days.push({
        dayNum: nextMonthDay,
        date: new Date(calendarYear, calendarMonth + 1, nextMonthDay, 12, 0, 0),
        isCurrentMonth: false,
      });
      nextMonthDay++;
    }

    return days;
  }, [calendarYear, calendarMonth]);

  // Date-wise task completion map (calculates status strictly per exact date)
  // Colour Rules:
  // - GREEN:  All tasks completed (100%)
  // - ORANGE: Partially completed (1% - 99%)
  // - RED:    No tasks completed (0%)
  // - DEFAULT: No tasks scheduled
  const dateCompletionMap = useMemo(() => {
    const map = {};
    tasks.forEach((t) => {
      const key = getTaskDateKey(t);
      if (key) {
        if (!map[key]) {
          map[key] = { total: 0, completed: 0, inProgress: 0, pending: 0 };
        }
        map[key].total += 1;
        const status = computeTaskStatus(t);
        if (status === "Completed") {
          map[key].completed += 1;
        } else if (status === "In Progress") {
          map[key].inProgress += 1;
        } else {
          map[key].pending += 1;
        }
      }
    });

    const resultMap = {};
    Object.keys(map).forEach((key) => {
      const item = map[key];
      const percent = item.total > 0 ? Math.round((item.completed / item.total) * 100) : 0;
      let color = "red";
      if (item.completed === item.total && item.total > 0) {
        color = "green"; // All tasks completed (100%)
      } else if (item.completed > 0) {
        color = "orange"; // Partially completed (1% - 99%)
      } else {
        color = "red"; // No tasks completed (0%)
      }
      resultMap[key] = {
        total: item.total,
        completed: item.completed,
        inProgress: item.inProgress,
        pending: item.pending,
        percent,
        color,
      };
    });
    return resultMap;
  }, [tasks]);

  const scheduledDatesMap = useMemo(() => {
    const map = {};
    Object.keys(dateCompletionMap).forEach((k) => {
      map[k] = dateCompletionMap[k].total;
    });
    return map;
  }, [dateCompletionMap]);

  return (
    <section className="ps-section-wrapper">
      {/* ── SECTION HEADER ──────────────────────────────────────────────── */}
      <div className="ps-section-header">
        <div className="ps-section-title-wrap">
          <span className="ps-section-icon">🎯</span>
          <div>
            <h2 className="ps-section-title">Practice Section</h2>
            <p className="ps-section-subtext">
              Daily revision tasks based on your weak topics.
            </p>
          </div>
        </div>

        {totalTasksCount > 0 && (
          <button
            onClick={handleGeneratePlan}
            disabled={generating}
            className="ps-btn-regen"
            title="Update revision schedule with any newly identified weak topics"
          >
            {generating ? (
              <>
                <span className="rs-spinner-sm"></span> Updating...
              </>
            ) : (
              <>🔄 Regenerate Tasks</>
            )}
          </button>
        )}
      </div>

      {/* ── ALERTS / FEEDBACK MESSAGES ─────────────────────────────────── */}
      {message.text && (
        <div
          className={`rs-alert-banner ${
            message.type === "error" ? "alert-error" : "alert-success"
          }`}
          style={{ marginBottom: "1.25rem" }}
        >
          <span>{message.type === "error" ? "⚠️" : "✓"}</span>
          <span>{message.text}</span>
        </div>
      )}

      {/* ── 4 SUMMARY METRIC CARDS ─────────────────────────────────────── */}
      <div className="ps-stats-grid">
        {/* Total Tasks */}
        <div className="ps-stat-card">
          <div className="ps-stat-icon-box box-purple">
            <span className="ps-icon">📋</span>
          </div>
          <div className="ps-stat-info">
            <span className="ps-stat-label">Total Tasks</span>
            <span className="ps-stat-value">{totalTasksCount}</span>
          </div>
        </div>

        {/* Completed */}
        <div className="ps-stat-card">
          <div className="ps-stat-icon-box box-green">
            <span className="ps-icon text-green">✓</span>
          </div>
          <div className="ps-stat-info">
            <span className="ps-stat-label">Completed</span>
            <span className="ps-stat-value text-green">{completedTasksCount}</span>
          </div>
        </div>

        {/* Pending */}
        <div className="ps-stat-card">
          <div className="ps-stat-icon-box box-amber">
            <span className="ps-icon">⏳</span>
          </div>
          <div className="ps-stat-info">
            <span className="ps-stat-label">Pending</span>
            <span className="ps-stat-value text-amber">{pendingTasksCount}</span>
          </div>
        </div>

        {/* Completion Rate */}
        <div className="ps-stat-card">
          <div className="ps-stat-icon-box box-indigo">
            <span className="ps-icon">📊</span>
          </div>
          <div className="ps-stat-info">
            <span className="ps-stat-label">Completion Rate</span>
            <span className="ps-stat-value text-indigo">{completionRate}%</span>
            <div className="ps-mini-track">
              <div
                className="ps-mini-fill"
                style={{ width: `${Math.min(completionRate, 100)}%` }}
              ></div>
            </div>
          </div>
        </div>
      </div>

      {/* ── MAIN CONTENT LAYOUT (TASKS ON LEFT, CALENDAR ON RIGHT) ──────── */}
      {loading ? (
        <div className="rs-loading-box" style={{ background: "#ffffff", borderRadius: "16px", padding: "2.5rem" }}>
          <div className="spinner"></div>
          <h2>Loading Practice Tasks...</h2>
          <p>Fetching scheduled revision activities from your plan.</p>
        </div>
      ) : totalTasksCount === 0 ? (
        <div className="rs-empty-plan-card" style={{ background: "#ffffff", borderRadius: "16px", margin: "1rem auto" }}>
          <div className="rs-empty-icon-circle">{isLatestQuiz100Percent ? "🏆" : "🎯"}</div>
          <h2 className="rs-empty-title">{isLatestQuiz100Percent ? "All Topics Mastered (100% Score)" : "No Practice Tasks Yet"}</h2>
          <p className="rs-empty-desc">
            {isLatestQuiz100Percent
              ? "Outstanding! You scored 100% on your AI Quiz with all questions answered correctly. No revision tasks needed for this quiz."
              : "Generate customized daily revision tasks based on your quiz mistakes and weak topics."}
          </p>
          <div className="rs-empty-btn-group">
            <button
              onClick={handleGeneratePlan}
              disabled={generating}
              className="rs-btn-primary"
            >
              {generating ? "Updating Plan…" : "🔄 Regenerate Tasks"}
            </button>
            <Link to="/quiz" className="rs-btn-secondary">
              Take Another Quiz →
            </Link>
          </div>
        </div>
      ) : (
        <div className="ps-columns-layout">
          {/* ── LEFT COLUMN: Tasks for Selected Date ───────────────────── */}
          <div className="ps-tasks-column">
            <div className="ps-tasks-container-card">
              <div className="ps-tasks-card-header">
                <div>
                  <h3 className="ps-tasks-heading">
                    {selectedCalendarDate
                      ? `Tasks for ${fmtDate(selectedCalendarDate)}`
                      : `Tasks for ${fmtDate(new Date())}`}
                  </h3>
                  <p className="ps-tasks-subheading">
                    Scheduled activities for the selected date ({displayedTasks.length} {displayedTasks.length === 1 ? "task" : "tasks"})
                  </p>
                </div>

                {selectedCalendarDate && (
                  <button
                    onClick={jumpToToday}
                    className="ps-btn-today-pill"
                    title="Show tasks for today"
                  >
                    ← Back to Today
                  </button>
                )}
              </div>

              {displayedTasks.length === 0 ? (
                <div className="rs-no-tasks-state">
                  <span className="rs-no-tasks-icon">🎉</span>
                  <p className="rs-no-tasks-text">
                    {selectedCalendarDate
                      ? "No revision tasks scheduled for this date."
                      : "You're all caught up for today! Review upcoming tasks or take a practice quiz."}
                  </p>
                </div>
              ) : (
                <div className="ps-task-cards-list">
                  {displayedTasks.map((task) => {
                    const taskStatus = computeTaskStatus(task);
                    const isCompleted = taskStatus === "Completed";
                    const isInProgress = taskStatus === "In Progress";
                    const pLower = (task.priority || "Medium").toLowerCase();
                    const reqScore = task.requiredScore || 70;
                    const hasScore =
                      task.latestPracticeAccuracy !== null &&
                      task.latestPracticeAccuracy !== undefined &&
                      !isNaN(Number(task.latestPracticeAccuracy));
                    const scorePassed = hasScore && Number(task.latestPracticeAccuracy) >= reqScore;

                    return (
                      <div
                        key={task.id}
                        className={`ps-task-card ${
                          isCompleted
                            ? "ps-task-completed"
                            : isInProgress
                            ? "ps-task-in-progress"
                            : "ps-task-pending"
                        }`}
                      >
                        {/* Top Meta Row: Priority and Status */}
                        <div className="ps-task-card-top">
                          <span
                            className={`ps-priority-pill priority-${pLower}`}
                          >
                            <span className="ps-dot">●</span> {task.priority ? task.priority.toUpperCase() : "MEDIUM"}
                          </span>

                          <span
                            className={`ps-status-pill ${
                              isCompleted
                                ? "status-done"
                                : isInProgress
                                ? "status-in-progress"
                                : "status-pending"
                            }`}
                          >
                            {isCompleted
                              ? "✓ Completed"
                              : isInProgress
                              ? "● In Progress"
                              : "● Pending"}
                          </span>
                        </div>

                        {/* Title & Material */}
                        <div className="ps-task-card-content">
                          <h4 className="ps-task-topic">{task.topic}</h4>
                          {task.subtopic && task.subtopic !== task.topic && (
                            <p className="ps-task-subtopic">Subtopic: {task.subtopic}</p>
                          )}
                          {task.materialName && (
                            <p className="ps-task-material" title={task.materialName}>
                              📄 {task.materialName}
                            </p>
                          )}
                        </div>

                        {/* Schedule & Score Meta + Action Buttons Row */}
                        <div className="ps-task-card-footer">
                          <div className="ps-task-meta-items">
                            <span className="ps-meta-item">
                              📅 {fmtDate(task.scheduledDate)}
                            </span>
                            <span className="ps-meta-item">
                              🎯 Practice Score:{" "}
                              <strong
                                className={
                                  hasScore
                                    ? scorePassed
                                      ? "text-green"
                                      : "text-danger"
                                    : "text-muted"
                                }
                              >
                                {hasScore ? `${task.latestPracticeAccuracy}%` : "--"}
                              </strong>
                            </span>
                            <span className="ps-meta-item">
                              ⭐ Required: <strong>{reqScore}%</strong>
                            </span>
                          </div>

                          <div className="ps-task-actions">
                            <button
                              onClick={() => handleOpenNotes(task)}
                              className="ps-btn-notes"
                              title="Open smart notes for this topic"
                            >
                              📖 Open Notes
                            </button>
                            <button
                              onClick={() => handlePracticeQuiz(task)}
                              className="ps-btn-quiz"
                              title="Start a 10-question practice quiz on this topic"
                            >
                              ▷ Practice Quiz
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ── RIGHT COLUMN: Calendar & Upcoming Tasks ────────────────── */}
          <aside className="ps-side-column">
            {/* MONTHLY CALENDAR */}
            <div className="ps-card-box ps-calendar-card">
              <div className="calendar-nav-bar">
                <h3 className="calendar-month-heading">
                  {monthName} {calendarYear}
                </h3>
                <div className="calendar-nav-buttons">
                  <button
                    onClick={prevMonth}
                    className="cal-nav-btn"
                    title="Previous Month"
                  >
                    ‹
                  </button>
                  <button
                    onClick={jumpToToday}
                    className="cal-today-btn"
                    title="Jump to Today"
                  >
                    Today
                  </button>
                  <button
                    onClick={nextMonth}
                    className="cal-nav-btn"
                    title="Next Month"
                  >
                    ›
                  </button>
                </div>
              </div>

              {/* Day of Week Headers */}
              <div className="calendar-weekdays-row">
                {["SU", "MO", "TU", "WE", "TH", "FR", "SA"].map((d) => (
                  <div key={d} className="calendar-weekday-cell">
                    {d}
                  </div>
                ))}
              </div>

              {/* Days Grid */}
              <div className="calendar-grid">
                {calendarDays.map((item, idx) => {
                  const dayKey = toYYYYMMDD(item.date);
                  const todayKey = toYYYYMMDD(new Date());
                  const isItemToday = dayKey === todayKey;
                  const isSelected = selectedCalendarDate
                    ? toYYYYMMDD(selectedCalendarDate) === dayKey
                    : false;
                  const dateData = dateCompletionMap[dayKey] || null;
                  const taskCountOnDate = dateData ? dateData.total : 0;

                  let statusClass = "";
                  let tooltipText = fmtDate(item.date);
                  if (dateData) {
                    if (dateData.color === "green") {
                      statusClass = "day-status-green";
                      tooltipText += `: ${dateData.total} ${dateData.total === 1 ? "task" : "tasks"} (100% Completed – All Tasks Completed)`;
                    } else if (dateData.color === "orange") {
                      statusClass = "day-status-orange";
                      tooltipText += `: ${dateData.total} tasks (${dateData.completed} completed, ${dateData.total - dateData.completed} pending – ${dateData.percent}% Complete)`;
                    } else if (dateData.color === "red") {
                      statusClass = "day-status-red";
                      tooltipText += `: ${dateData.total} ${dateData.total === 1 ? "task" : "tasks"} (0% Completed – No Tasks Completed)`;
                    }
                  } else {
                    tooltipText += ": No tasks scheduled";
                  }

                  return (
                    <button
                      key={dayKey || idx}
                      type="button"
                      onClick={() => {
                        setSelectedCalendarDate(item.date);
                        if (!item.isCurrentMonth) {
                          setCalendarDate(new Date(item.date.getFullYear(), item.date.getMonth(), 1));
                        }
                      }}
                      className={`calendar-day-btn ${
                        !item.isCurrentMonth ? "day-other-month" : ""
                      } ${statusClass} ${isItemToday ? "day-today" : ""} ${
                        isSelected ? "day-selected" : ""
                      } ${taskCountOnDate > 0 ? "day-has-tasks" : ""}`}
                      title={tooltipText}
                    >
                      <span className="cal-day-number">{item.dayNum}</span>
                      {taskCountOnDate > 0 && (
                        <span className={`cal-task-dot dot-${dateData?.color || "default"}`}></span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* 4-State Legend */}
              <div className="calendar-legend-box">
                <div className="calendar-legend-title">Task Completion Legend</div>
                <div className="calendar-legend-grid">
                  <div className="legend-item">
                    <span className="legend-dot status-green"></span>
                    <span className="legend-text"><strong className="legend-color-tag">Green</strong> – All Tasks Completed</span>
                  </div>
                  <div className="legend-item">
                    <span className="legend-dot status-orange"></span>
                    <span className="legend-text"><strong className="legend-color-tag">Orange</strong> – Partially Completed</span>
                  </div>
                  <div className="legend-item">
                    <span className="legend-dot status-red"></span>
                    <span className="legend-text"><strong className="legend-color-tag">Red</strong> – No Tasks Completed</span>
                  </div>
                  <div className="legend-item">
                    <span className="legend-dot status-default"></span>
                    <span className="legend-text"><strong className="legend-color-tag">Default</strong> – No Tasks Scheduled</span>
                  </div>
                </div>
              </div>
            </div>

            {/* UPCOMING TASKS CARD */}
            <div className="ps-card-box ps-upcoming-card">
              <div className="ps-upcoming-header">
                <h3 className="ps-upcoming-title">
                  <span style={{ marginRight: "0.35rem" }}>🗂</span> Upcoming Tasks
                </h3>
              </div>

              {upcomingTasks.length === 0 ? (
                <div className="rs-upcoming-empty">
                  <p>No upcoming tasks. You're all caught up!</p>
                </div>
              ) : (
                <div className="ps-upcoming-list">
                  {upcomingTasks.map((t) => {
                    const uStatus = computeTaskStatus(t);
                    return (
                      <div key={t.id} className="ps-upcoming-row">
                        <div className="ps-upcoming-left">
                          <div className="ps-upcoming-icon-box">📋</div>
                          <div className="ps-upcoming-info">
                            <span className="ps-upcoming-task-title">{t.topic}</span>
                            <span className="ps-upcoming-task-date">
                              📅 {fmtShortDate(t.scheduledDate)}
                            </span>
                          </div>
                        </div>

                        <span
                          className={`ps-status-pill ${
                            uStatus === "Completed"
                              ? "status-done"
                              : uStatus === "In Progress"
                              ? "status-in-progress"
                              : "status-pending"
                          }`}
                        >
                          {uStatus === "Completed"
                            ? "✓ Completed"
                            : uStatus === "In Progress"
                            ? "● In Progress"
                            : "● Pending"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}
