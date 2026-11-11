import { Link, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import Navbar from "../components/Navbar";
import "../styles/Dashboard.css";

function Dashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [stats, setStats] = useState({
    materialsCount: 0,
    weakTopicsCount: 0,
    flashcardsCount: 0,
    quizScore: "Not Taken"
  });
  const [recentMaterials, setRecentMaterials] = useState([]);

  useEffect(() => {
    const loadDashboard = async () => {
    const token = localStorage.getItem("token") || sessionStorage.getItem("token");
    if (!token) {
      navigate("/login");
      return;
    }

    const savedUser = localStorage.getItem("user") || sessionStorage.getItem("user");
    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch (error) {
        console.error("User data error:", error);
      }
    }

    // Load baseline quiz score from localStorage (immediate display while API loads)
    try {
      const lastQuizResult = JSON.parse(localStorage.getItem("lastQuizResult") || "null");

      let accuracy = null;
      if (lastQuizResult) {
        if (lastQuizResult.accuracy !== undefined) {
          accuracy = lastQuizResult.accuracy;
        } else if (lastQuizResult.percentage !== undefined) {
          accuracy = lastQuizResult.percentage;
        } else if (lastQuizResult.scorePercentage !== undefined) {
          accuracy = lastQuizResult.scorePercentage;
        } else if (lastQuizResult.totalQuestions > 0 && lastQuizResult.score !== undefined) {
          accuracy = Math.round((lastQuizResult.score / lastQuizResult.totalQuestions) * 100);
        } else if (lastQuizResult.total > 0 && lastQuizResult.score !== undefined) {
          accuracy = Math.round((lastQuizResult.score / lastQuizResult.total) * 100);
        }
      }

      setStats({
        materialsCount: 0,
        weakTopicsCount: 0,
        revisionNotesCount: 0,
        flashcardsCount: 0,
        quizScore: accuracy !== null ? `${accuracy}%` : "Not Taken"
      });

    } catch (e) {
      console.error("Dashboard storage parsing error:", e);
    }

    // Fetch all real stats from MongoDB APIs
    if (token) {
      const headers = { Authorization: `Bearer ${token}` };

      // 1. Materials count + recent materials list
      try {
        const matRes = await fetch("http://localhost:5000/api/materials", { headers });
        const matData = await matRes.json();
        if (matRes.ok && matData.success && Array.isArray(matData.materials)) {
          setStats((prev) => ({ ...prev, materialsCount: matData.materials.length }));
          const recent = matData.materials.slice(0, 5).map((m) => ({
            id: m.id || m._id,
            title: m.fileName || m.title || "Study Material",
            date: m.createdAt ? new Date(m.createdAt).toLocaleDateString() : "Recent",
            type: m.fileType || "PDF / Doc",
            noteObj: {
              materialId: m.id || m._id,
              fileName: m.fileName || m.title,
              fileType: m.fileType,
              createdAt: m.createdAt,
            },
          }));
          setRecentMaterials(recent);
        }
      } catch (err) {
        console.warn("Dashboard: Could not fetch materials:", err);
      }

      // 2. Weak topics count — use same localStorage source as WeakTopics page (set after quiz completion)
      //    Fall back to MongoDB practice-attempts if localStorage has no quiz data yet
      try {
        const lsWeakTopics = JSON.parse(localStorage.getItem("weakTopics") || "[]");
        if (Array.isArray(lsWeakTopics) && lsWeakTopics.length > 0) {
          // Use localStorage — this matches exactly what the WeakTopics page shows
          setStats((prev) => ({ ...prev, weakTopicsCount: lsWeakTopics.length }));
        } else {
          // Fallback: derive from MongoDB practice attempts
          const attRes = await fetch("http://localhost:5000/api/practice-attempts", { headers });
          const attData = await attRes.json();
          if (attRes.ok && attData.success && Array.isArray(attData.attempts)) {
            const weakSet = new Set(
              attData.attempts
                .filter((a) => (a.accuracy ?? 100) < 70)
                .map((a) => a.topic)
            );
            setStats((prev) => ({ ...prev, weakTopicsCount: weakSet.size }));
          }
        }
      } catch (err) {
        console.warn("Dashboard: Could not fetch weak topics count:", err);
      }

      // 3. Flashcards count from MongoDB (count of successfully generated flashcard sets, NOT individual cards)
      try {
        const fcRes = await fetch("http://localhost:5000/api/flashcards", { headers });
        const fcData = await fcRes.json();
        if (fcRes.ok && fcData.success) {
          const setsCount =
            fcData.totalSets !== undefined
              ? Number(fcData.totalSets)
              : fcData.totalDecks !== undefined
              ? Number(fcData.totalDecks)
              : Array.isArray(fcData.decks)
              ? fcData.decks.length
              : 0;

          setStats((prev) => ({ ...prev, flashcardsCount: setsCount }));
        }
      } catch (err) {
        console.warn("Dashboard: Could not fetch flashcard count:", err);
      }

      // 4. Revision notes count from MongoDB
      try {
        const notesRes = await fetch("http://localhost:5000/api/notes", { headers });
        const notesData = await notesRes.json();
        if (notesRes.ok && notesData.success && Array.isArray(notesData.notes)) {
          const remoteRevisionCount = notesData.notes.filter(
            (n) =>
              n.type === "weak-topic" ||
              n.type === "weak-topic-complete" ||
              n.type === "weak-topic-revision"
          ).length;
          setStats((prev) => ({ ...prev, revisionNotesCount: remoteRevisionCount }));
        }
      } catch (err) {
        console.warn("Dashboard: Could not fetch notes count:", err);
      }

      // 5. Latest quiz accuracy from MongoDB (overrides localStorage — persists across sessions)
      try {
        const qrRes = await fetch("http://localhost:5000/api/quiz-results/latest", { headers });
        const qrData = await qrRes.json();
        if (qrRes.ok && qrData.success && qrData.result) {
          setStats((prev) => ({
            ...prev,
            quizScore: `${Math.round(qrData.result.accuracy)}%`,
          }));
        }
      } catch (err) {
        console.warn("Dashboard: Could not fetch quiz results:", err);
      }
    }
    }; // end loadDashboard
    loadDashboard();
  }, [navigate]);


  const handleTakeQuizForMaterial = (mat) => {
    localStorage.removeItem("weakTopicQuiz");
    localStorage.removeItem("quizQuestions");
    localStorage.removeItem("aiQuiz");
    localStorage.removeItem("quizAnswers");
    localStorage.removeItem("quizData");
    localStorage.removeItem("generatedQuiz");

    if (mat.noteObj) {
      localStorage.setItem("selectedQuizNote", JSON.stringify(mat.noteObj));
      if (mat.noteObj.materialId) {
        localStorage.setItem("activeMaterialId", mat.noteObj.materialId);
      }
    } else if (mat.id) {
      localStorage.setItem("activeMaterialId", String(mat.id));
    }
    navigate("/quiz");
  };

  const handleViewNotesForMaterial = (mat) => {
    if (mat.noteObj) {
      localStorage.setItem("selectedFlashcardNote", JSON.stringify(mat.noteObj));
      localStorage.setItem("selectedQuizNote", JSON.stringify(mat.noteObj));
      if (mat.noteObj.materialId) {
        localStorage.setItem("activeMaterialId", mat.noteObj.materialId);
      }
    }
    navigate("/smart-notes");
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return { text: "Good morning", emoji: "🌅" };
    if (hour >= 12 && hour < 17) return { text: "Good afternoon", emoji: "☀️" };
    if (hour >= 17 && hour < 21) return { text: "Good evening", emoji: "🌆" };
    return { text: "Good night", emoji: "🌙" };
  };

  if (!user) {
    return (
      <div className="dashboard-loading-state">
        <div className="spinner"></div>
        <p>Loading your learning workspace...</p>
      </div>
    );
  }

  const greeting = getGreeting();

  return (
    <div className="dashboard-page-wrapper">
      <Navbar />

      <main className="dashboard-main-container saas-container">
        
        {/* HEADER GREETING */}
        <header className="dashboard-greeting-bar">
          <div>
            <div className="greeting-badge">✨ Student Learning Portal</div>
            <h1 className="greeting-title">
              {greeting.text}, {user.name || "Learner"} {greeting.emoji}
            </h1>
            <p className="greeting-subtext">
              Here is your study progress and intelligent AI learning tools.
            </p>
          </div>

          <Link to="/upload" className="saas-btn-primary upload-header-btn">
            + Upload New Material
          </Link>
        </header>

        {/* METRICS ROW */}
        <section className="dashboard-stats-grid">
          <div className="stat-card">
            <div className="stat-icon-wrapper bg-indigo">📄</div>
            <div className="stat-details">
              <div className="stat-value">{stats.materialsCount}</div>
              <div className="stat-label">Study Materials Uploaded</div>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon-wrapper bg-purple">🎯</div>
            <div className="stat-details">
              <div className="stat-value">{stats.weakTopicsCount}</div>
              <div className="stat-label">Weak Topics Identified</div>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon-wrapper bg-teal">▣</div>
            <div className="stat-details">
              <div className="stat-value">{stats.flashcardsCount}</div>
              <div className="stat-label">Flashcards Generated</div>
            </div>
          </div>

          <div className="stat-card">
            <div className="stat-icon-wrapper bg-amber">⚡</div>
            <div className="stat-details">
              <div className="stat-value">{stats.quizScore}</div>
              <div className="stat-label">Latest Quiz Accuracy</div>
            </div>
          </div>
        </section>

        {/* RECENT MATERIALS & TOOLS GRID */}
        <div className="dashboard-content-split">
          
          {/* RECENT MATERIALS */}
          <section className="dashboard-section-box flex-2">
            <div className="section-title-row">
              <h3>Recent Study Materials</h3>
              <Link to="/smart-notes" className="section-link">View All Notes →</Link>
            </div>

            {recentMaterials.length === 0 ? (
              <div className="empty-state-box">
                <div className="empty-icon">📤</div>
                <h4>No Materials Uploaded Yet</h4>
                <p>Upload a PDF, presentation, or YouTube link to generate your first set of Smart Notes!</p>
                <Link to="/upload" className="saas-btn-secondary empty-action-btn">
                  Upload Material Now
                </Link>
              </div>
            ) : (
              <div className="recent-materials-list">
                {recentMaterials.map((mat) => (
                  <div key={mat.id} className="recent-material-item">
                    <div className="mat-file-icon">📄</div>
                    <div className="mat-info">
                      <div className="mat-title">{mat.title}</div>
                      <div className="mat-meta">
                        <span className="mat-badge">{mat.type}</span> • {mat.date}
                      </div>
                    </div>
                    <div className="mat-actions">
                      <button onClick={() => handleViewNotesForMaterial(mat)} className="mat-action-btn" title="View Smart Notes">
                        Smart Notes
                      </button>
                      <button onClick={() => handleTakeQuizForMaterial(mat)} className="mat-action-btn primary" title="Take AI Quiz">
                        Take Quiz
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* QUICK TOOLS CARD SIDEBAR */}
          <section className="dashboard-section-box flex-1">
            <div className="section-title-row">
              <h3>Learning Tools</h3>
            </div>

            <div className="tools-vertical-stack">
              
              <Link to="/smart-notes" className="quick-tool-card">
                <div className="tool-card-icon bg-indigo">📄</div>
                <div>
                  <h4>Smart Notes</h4>
                  <p>AI summaries & revision notes</p>
                </div>
                <span className="arrow-tag">→</span>
              </Link>

              <Link to="/flashcards" className="quick-tool-card">
                <div className="tool-card-icon bg-purple">▣</div>
                <div>
                  <h4>Flashcards</h4>
                  <p>Active recall revision decks</p>
                </div>
                <span className="arrow-tag">→</span>
              </Link>

              <Link to="/quiz" className="quick-tool-card">
                <div className="tool-card-icon bg-teal">⚡</div>
                <div>
                  <h4>AI Practice Quiz</h4>
                  <p>Adaptive multiple choice tests</p>
                </div>
                <span className="arrow-tag">→</span>
              </Link>

              <Link to="/weak-topics" className="quick-tool-card">
                <div className="tool-card-icon bg-amber">🎯</div>
                <div>
                  <h4>Weak Topics</h4>
                  <p>Identify & fix learning gaps</p>
                </div>
                <span className="arrow-tag">→</span>
              </Link>

              <Link to="/revision-scheduler" className="quick-tool-card">
                <div className="tool-card-icon bg-green">📅</div>
                <div>
                  <h4>Revision Plan</h4>
                  <p>Daily scheduled study tasks</p>
                </div>
                <span className="arrow-tag">→</span>
              </Link>

            </div>
          </section>

        </div>

      </main>
    </div>
  );
}

export default Dashboard;