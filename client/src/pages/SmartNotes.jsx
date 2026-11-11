import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import html2pdf from "html2pdf.js";
import Navbar from "../components/Navbar";
import "../styles/SmartNotes.css";

function SmartNotes() {
  const [notes, setNotes] = useState([]);
  const [selectedNote, setSelectedNote] = useState(null);
  const [filter, setFilter] = useState("all"); // 'all', 'standard', 'revision'
  const [noteOpenPending, setNoteOpenPending] = useState(null); // noteId to auto-open

  const contentRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();

  // Read ?noteId= from URL on mount
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const noteId = params.get("noteId");
    if (noteId) setNoteOpenPending(noteId);
    loadNotes();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Once notes are loaded, auto-open the pending note
  useEffect(() => {
    if (noteOpenPending && notes.length > 0) {
      const target = notes.find((n) => n.id === noteOpenPending);
      if (target) {
        openNote(target);
        setNoteOpenPending(null);
        // Remove noteId from URL without re-render
        const url = new URL(window.location.href);
        url.searchParams.delete("noteId");
        window.history.replaceState({}, "", url.pathname + url.search);
      }
    }
  }, [notes, noteOpenPending]); // eslint-disable-line react-hooks/exhaustive-deps

  const isRevisionNote = (note) =>
    Boolean(
      note &&
        (note.type === "weak-topic" ||
          note.type === "weak-topic-complete" ||
          note.type === "weak-topic-revision")
    );

  const loadNotes = async () => {
    try {
      const token = localStorage.getItem("token") || sessionStorage.getItem("token");
      let remoteNotes = [];

      if (token) {
        try {
          const response = await fetch("http://localhost:5000/api/notes", {
            headers: { Authorization: `Bearer ${token}` },
          });
          const data = await response.json();
          if (response.ok && data.success && Array.isArray(data.notes)) {
            remoteNotes = data.notes.map((item) => {
              const isRev =
                item.type === "weak-topic" ||
                item.type === "weak-topic-complete" ||
                item.type === "weak-topic-revision";
              return {
                id: String(item.id || item._id),
                materialId: item.materialId ? String(item.materialId) : "",
                title: item.title || "Study Material",
                fileName: item.title || "Study Material",
                sourceFileName: item.sourceFileName || item.title || "Study Material",
                notes: item.content || item.notes || "",
                createdAt: item.createdAt || new Date().toISOString(),
                type: isRev ? item.type : "standard",
                topic: item.weakTopic || item.topic || (item.topics && item.topics.length > 0 ? "Complete Weak Topics" : ""),
                subtopic: item.weakSubtopic || item.subtopic || (item.topics && item.topics.length > 0 ? `${item.topics.length} Topics` : ""),
                topics: item.topics || [],
                youtubeUrl: item.youtubeUrl || null,
                sourceType: item.sourceType || (item.youtubeUrl ? "youtube" : null),
              };
            });
          }
        } catch (apiErr) {
          console.warn("Server notes fetch fallback:", apiErr);
        }
      }

      // Merge notes keyed by unique note ID (NOT by materialId!)
      // This preserves all separate revision notes for different topics of the same material.
      const notesMap = new Map();

      // Track standard notes to strictly prevent duplicate cards for the same material or document
      const standardMaterialIds = new Set();
      const standardTitles = new Set();

      // 1. Authoritative remote notes from MongoDB
      remoteNotes.forEach((remote) => {
        const idKey = String(remote.id || "");
        if (idKey) {
          notesMap.set(idKey, remote);
        }
        if (!isRevisionNote(remote)) {
          if (remote.materialId) standardMaterialIds.add(String(remote.materialId));
          standardMaterialIds.add(idKey);
          if (remote.title) standardTitles.add(remote.title.trim().toLowerCase());
          if (remote.sourceFileName) standardTitles.add(remote.sourceFileName.trim().toLowerCase());
          if (remote.fileName) standardTitles.add(remote.fileName.trim().toLowerCase());
        }
      });

      // 2. Add local notes only if their ID and material are not already present from server
      const savedNotes = JSON.parse(localStorage.getItem("smartNotes") || "[]");
      if (Array.isArray(savedNotes)) {
        savedNotes.forEach((local) => {
          const idKey = String(local.id || "");
          const matId = String(local.materialId || local.id || "");
          const isLocalRev = isRevisionNote(local);

          if (!isLocalRev) {
            // Check if this standard note is already present in remoteNotes
            const titleNorm = String(local.title || local.fileName || "").trim().toLowerCase();
            const titleNoExt = titleNorm.replace(/\.[^/.]+$/, "").trim();
            const alreadyHasStandard =
              (idKey && notesMap.has(idKey)) ||
              (matId && standardMaterialIds.has(matId)) ||
              (titleNorm && standardTitles.has(titleNorm)) ||
              (titleNoExt && Array.from(standardTitles).some((t) => t.replace(/\.[^/.]+$/, "").trim() === titleNoExt));

            if (alreadyHasStandard) {
              return; // Do NOT add duplicate standard note from localStorage!
            }
          }

          if (idKey && !notesMap.has(idKey)) {
            notesMap.set(idKey, local);
          }
        });

        // Prune stale duplicate standard notes from localStorage so browser stays clean
        if (remoteNotes.length > 0) {
          const cleanedLocal = savedNotes.filter((local) => {
            if (isRevisionNote(local)) return true;
            const idKey = String(local.id || "");
            const matId = String(local.materialId || local.id || "");
            const titleNorm = String(local.title || local.fileName || "").trim().toLowerCase();
            const titleNoExt = titleNorm.replace(/\.[^/.]+$/, "").trim();
            const isDup =
              (idKey && notesMap.has(idKey)) ||
              (matId && standardMaterialIds.has(matId)) ||
              (titleNorm && standardTitles.has(titleNorm)) ||
              (titleNoExt && Array.from(standardTitles).some((t) => t.replace(/\.[^/.]+$/, "").trim() === titleNoExt));
            return !isDup;
          });
          if (cleanedLocal.length !== savedNotes.length) {
            localStorage.setItem("smartNotes", JSON.stringify(cleanedLocal));
          }
        }
      }

      // 3. Add weakTopicNotes only if not already present
      const weakTopicData = JSON.parse(localStorage.getItem("weakTopicNotes") || "null");
      if (weakTopicData) {
        const weakList = Array.isArray(weakTopicData) ? weakTopicData : [weakTopicData];
        weakList.forEach((w) => {
          if (!w || !w.notes) return;
          const idKey = String(w.id || "");
          if (idKey && !notesMap.has(idKey)) {
            const isComplete = w.type === "weak-topic-complete";
            const sourceFile = w.sourceFileName || w.fileName || "Study Material";
            const weakTitle =
              w.title ||
              (isComplete
                ? `${sourceFile} - AI Revision Note (Complete Weak Topics)`
                : `${sourceFile} - Weak Topic - ${w.topic || "Weak Topic"}`);

            notesMap.set(idKey, {
              id: idKey,
              materialId: w.materialId || "",
              title: weakTitle,
              fileName: sourceFile,
              sourceFileName: sourceFile,
              notes: w.notes,
              createdAt: w.createdAt || new Date().toISOString(),
              type: isComplete ? "weak-topic-complete" : "weak-topic-revision",
              topic: w.topic || (isComplete ? "Complete Weak Topics" : "Weak Topic"),
              subtopic: w.subtopic || "",
              topics: w.topics || [],
            });
          }
        });
      }

      const combinedNotes = Array.from(notesMap.values());
      combinedNotes.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

      setNotes(combinedNotes);
    } catch (error) {
      console.error("Unable to load Smart Notes:", error);
      setNotes([]);
    }
  };

  const handleDelete = async (note) => {
    if (!window.confirm("Are you sure you want to delete this note?")) return;

    // Delete from MongoDB if note has an ID and user is authenticated
    const token = localStorage.getItem("token") || sessionStorage.getItem("token");
    if (token && note.id && !note.id.startsWith("weak-")) {
      try {
        await fetch(`http://localhost:5000/api/notes/${note.id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch (err) {
        console.warn("Could not delete note from server:", err);
      }
    }

    // Clean up local storage
    const savedWeak = JSON.parse(localStorage.getItem("weakTopicNotes") || "null");
    if (Array.isArray(savedWeak)) {
      localStorage.setItem("weakTopicNotes", JSON.stringify(savedWeak.filter((w) => w.id !== note.id)));
    } else if (savedWeak && (savedWeak.id === note.id || savedWeak.topic === note.topic)) {
      localStorage.removeItem("weakTopicNotes");
    }

    const savedNotes = JSON.parse(localStorage.getItem("smartNotes") || "[]");
    const updatedNotes = savedNotes.filter((item) => item.id !== note.id);
    localStorage.setItem("smartNotes", JSON.stringify(updatedNotes));

    setNotes((prev) => prev.filter((item) => item.id !== note.id));
    setSelectedNote(null);
  };

  const openNote = (note) => {
    setSelectedNote(note);
    if (note) {
      localStorage.setItem("selectedQuizNote", JSON.stringify(note));
      localStorage.setItem("selectedFlashcardNote", JSON.stringify(note));
      const matId = note.materialId || note.id || "";
      if (matId) {
        localStorage.setItem("activeMaterialId", String(matId));
      }
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleContinueToFlashcards = () => {
    if (!selectedNote) return;
    localStorage.setItem("selectedFlashcardNote", JSON.stringify(selectedNote));
    localStorage.setItem("selectedQuizNote", JSON.stringify(selectedNote));
    if (selectedNote.materialId) {
      localStorage.setItem("activeMaterialId", selectedNote.materialId);
    }
    navigate("/flashcards");
  };

  const handleContinueToQuiz = () => {
    if (!selectedNote) return;
    const matId = selectedNote.materialId || selectedNote.id || "";
    localStorage.setItem("selectedQuizNote", JSON.stringify(selectedNote));
    localStorage.removeItem("quizQuestions");
    localStorage.removeItem("aiQuiz");
    localStorage.removeItem("quizData");
    localStorage.removeItem("generatedQuiz");
    localStorage.removeItem("weakTopicQuiz");
    localStorage.removeItem("quizAnswers");
    if (matId) {
      localStorage.setItem("activeMaterialId", String(matId));
      navigate(`/quiz?materialId=${matId}`);
    } else {
      navigate("/quiz");
    }
  };

  const handleDownload = async () => {
    if (!selectedNote || !contentRef.current) return;
    try {
      const element = contentRef.current;
      const cleanFileName = (selectedNote.title || "Smart_Notes")
        .replace(/\.[^/.]+$/, "")
        .replace(/[^a-zA-Z0-9_-]/g, "_");

      const options = {
        margin: [12, 12, 12, 12],
        filename: `${cleanFileName}_Smart_Notes.pdf`,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff" },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        pagebreak: { mode: ["css", "legacy"] },
      };

      await html2pdf().set(options).from(element).save();
    } catch (error) {
      console.error("PDF Download Error:", error);
      alert("Unable to download notes as PDF.");
    }
  };

  const markdownComponents = {
    h1: ({ children }) => <h1 className="detail-h1">{children}</h1>,
    h2: ({ children }) => <h2 className="detail-h2">{children}</h2>,
    h3: ({ children }) => <h3 className="detail-h3">{children}</h3>,
    p: ({ children }) => <p className="detail-paragraph">{children}</p>,
    ul: ({ children }) => <ul className="detail-ul">{children}</ul>,
    ol: ({ children }) => <ol className="detail-ol">{children}</ol>,
    li: ({ children }) => <li className="detail-li">{children}</li>,
    strong: ({ children }) => <strong className="detail-strong">{children}</strong>,
  };

  const filteredNotes = notes.filter((note) => {
    if (filter === "standard") return !isRevisionNote(note);
    if (filter === "revision") return isRevisionNote(note);
    return true;
  });

  return (
    <div className="smart-notes-page-wrapper">
      <Navbar />

      <main className="smart-notes-container saas-container">
        
        {/* DETAIL VIEW MODAL / PAGE */}
        {selectedNote ? (
          <div className="note-detail-view-card">
            
            <div className="detail-top-bar">
              <button onClick={() => setSelectedNote(null)} className="saas-btn-secondary">
                ← Back to Smart Notes
              </button>
              
              <div className="detail-action-buttons">
                <button onClick={handleDownload} className="saas-btn-secondary">
                  📥 Download PDF
                </button>
                <button onClick={() => handleDelete(selectedNote)} className="saas-btn-danger">
                  🗑️ Delete Note
                </button>
              </div>
            </div>

            <div className="detail-meta-header">
              <div className="badge-row">
                <span className={isRevisionNote(selectedNote) ? "saas-badge-purple" : "saas-badge"}>
                  {isRevisionNote(selectedNote) ? "🎯 AI REVISION NOTE" : "📄 AI GENERATED NOTE"}
                </span>
                <span className="source-file-pill">
                  Source: {selectedNote.sourceFileName || selectedNote.fileName || selectedNote.title || "Study Material"}
                </span>
                {(selectedNote.youtubeUrl || selectedNote.sourceType === "youtube") && (
                  <a
                    href={selectedNote.youtubeUrl || "#"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="youtube-source-link"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      background: "rgba(255,0,0,0.08)",
                      color: "#c00",
                      border: "1px solid rgba(255,0,0,0.18)",
                      borderRadius: "999px",
                      padding: "4px 14px",
                      fontSize: "0.82rem",
                      fontWeight: 600,
                      textDecoration: "none",
                      transition: "background 0.2s",
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = "rgba(255,0,0,0.15)"}
                    onMouseLeave={e => e.currentTarget.style.background = "rgba(255,0,0,0.08)"}
                  >
                    ▶ YouTube Source
                  </a>
                )}
              </div>

              <h1 className="detail-main-title">
                {selectedNote.title}
              </h1>

              {isRevisionNote(selectedNote) && (
                <div className="weak-topic-detail-box">
                  <div className="weak-box-label">
                    {Array.isArray(selectedNote.topics) && selectedNote.topics.length > 0
                      ? `Covered Weak Topics (${selectedNote.topics.length})`
                      : "Targeted Weak Topic"}
                  </div>
                  <div className="weak-box-topic">{selectedNote.topic}</div>
                  {selectedNote.subtopic && (
                    <div className="weak-box-subtopic">
                      Subtopic: <strong>{selectedNote.subtopic}</strong>
                    </div>
                  )}
                  {Array.isArray(selectedNote.topics) && selectedNote.topics.length > 0 && (
                    <div className="covered-topics-tags-container">
                      {selectedNote.topics.map((t, idx) => {
                        const topicText = typeof t === "string" ? t : (t?.topic || `Topic ${idx + 1}`);
                        const subtopicText =
                          typeof t === "object" && t?.subtopic && t.subtopic !== topicText ? t.subtopic : "";
                        return (
                          <span key={idx} className="covered-topic-tag">
                            <span className="covered-topic-tag-name">{topicText}</span>
                            {subtopicText && (
                              <span className="covered-topic-tag-subtopic">({subtopicText})</span>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <div className="detail-date-label">
                Created: {selectedNote.createdAt ? new Date(selectedNote.createdAt).toLocaleString() : "Recent"}
              </div>
            </div>

            <div className="detail-markdown-body" ref={contentRef}>
              <ReactMarkdown components={markdownComponents}>
                {selectedNote.notes || selectedNote.content || ""}
              </ReactMarkdown>
            </div>

            <div className="detail-bottom-cta" style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
              <button onClick={handleContinueToFlashcards} className="saas-btn-secondary">
                Continue to Flashcards →
              </button>
              <button onClick={handleContinueToQuiz} className="saas-btn-primary">
                Take AI Quiz →
              </button>
            </div>

          </div>
        ) : (
          /* LIST VIEW */
          <div>
            <div className="smart-notes-header">
              <div>
                <div className="saas-badge">📄 AI Learning Workspace</div>
                <h1 className="smart-notes-title">Smart Notes Collection</h1>
                <p className="smart-notes-subtext">
                  Your AI-generated summaries and focused weak-topic revision decks.
                </p>
              </div>

              <Link to="/upload" className="saas-btn-primary">
                + Upload New Material
              </Link>
            </div>

            {/* FILTER TABS */}
            <div className="notes-filter-bar">
              <button
                className={filter === "all" ? "filter-tab active" : "filter-tab"}
                onClick={() => setFilter("all")}
              >
                All Notes ({notes.length})
              </button>
              <button
                className={filter === "standard" ? "filter-tab active" : "filter-tab"}
                onClick={() => setFilter("standard")}
              >
                Standard Notes ({notes.filter((n) => !isRevisionNote(n)).length})
              </button>
              <button
                className={filter === "revision" ? "filter-tab active" : "filter-tab"}
                onClick={() => setFilter("revision")}
              >
                🎯 Revision Notes ({notes.filter((n) => isRevisionNote(n)).length})
              </button>
            </div>

            {filteredNotes.length === 0 ? (
              <div className="empty-notes-card">
                <div className="empty-icon">📄</div>
                <h3>No Smart Notes Found</h3>
                <p>Upload a study material or generate a revision note from Weak Topics to see it here.</p>
                <Link to="/upload" className="saas-btn-secondary empty-btn">
                  Upload Material Now
                </Link>
              </div>
            ) : (
              <div className="notes-cards-grid">
                {filteredNotes.map((note, index) => {
                  const isRev = isRevisionNote(note);
                  return (
                    <div
                      key={`${note.id}-${index}`}
                      className={`note-card-item ${isRev ? "revision-card" : ""}`}
                      onClick={() => openNote(note)}
                    >
                      <div className="note-card-top">
                        <span className={isRev ? "saas-badge-purple" : "saas-badge"}>
                          {isRev ? "🎯 AI REVISION NOTE" : "📄 AI GENERATED NOTE"}
                        </span>
                        <span className="card-arrow">→</span>
                      </div>

                      <div className="note-card-source">
                        Source: {note.sourceFileName || note.fileName || "Study Material"}
                        {(note.youtubeUrl || note.sourceType === "youtube") && (
                          <span style={{
                            display: "inline-block",
                            marginLeft: "8px",
                            background: "rgba(255,0,0,0.08)",
                            color: "#c00",
                            border: "1px solid rgba(255,0,0,0.15)",
                            borderRadius: "999px",
                            padding: "2px 10px",
                            fontSize: "0.72rem",
                            fontWeight: 700,
                          }}>
                            ▶ YouTube
                          </span>
                        )}
                      </div>

                      <h3 className="note-card-title">
                        {note.title}
                      </h3>

                      {isRev && note.subtopic && (
                        <div className="note-card-subtopic">
                          Subtopic: <strong>{note.subtopic}</strong>
                        </div>
                      )}

                      <div className="note-card-footer">
                        <span>{note.createdAt ? new Date(note.createdAt).toLocaleDateString() : "Recent"}</span>
                        <span className="read-more-text">Read Notes</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

      </main>
    </div>
  );
}

export default SmartNotes;