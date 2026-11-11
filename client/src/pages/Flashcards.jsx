import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import "../styles/Flashcards.css";

function Flashcards() {
  const navigate = useNavigate();

  const [selectedNote, setSelectedNote] = useState(null);
  const [cards, setCards] = useState([]);
  const [currentCard, setCurrentCard] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let savedNote = localStorage.getItem("selectedFlashcardNote");

    if (!savedNote) {
      try {
        const smartNotes = JSON.parse(localStorage.getItem("smartNotes") || "[]");
        if (Array.isArray(smartNotes) && smartNotes.length > 0) {
          savedNote = JSON.stringify(smartNotes[0]);
        }
      } catch (e) {
        // ignore fallback error
      }
    }

    if (!savedNote) {
      setError("No Smart Note selected. Please upload study material or select a Smart Note first.");
      setLoading(false);
      return;
    }

    try {
      const note = JSON.parse(savedNote);
      setSelectedNote(note);
      generateFlashcards(note);
    } catch (err) {
      console.error("Unable to load selected note:", err);
      setError("Unable to load the selected Smart Note.");
      setLoading(false);
    }
  }, []);

  // Keyboard navigation for active recall: Left/Right arrows and Space/Enter to flip
  useEffect(() => {
    if (cards.length === 0) return;

    const handleKeyDown = (e) => {
      if (["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;

      if (e.key === "ArrowRight") {
        if (currentCard < cards.length - 1) {
          setCurrentCard((prev) => prev + 1);
          setShowAnswer(false);
        }
      } else if (e.key === "ArrowLeft") {
        if (currentCard > 0) {
          setCurrentCard((prev) => prev - 1);
          setShowAnswer(false);
        }
      } else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setShowAnswer((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentCard, cards.length]);

  const generateFlashcards = async (note) => {
    try {
      setLoading(true);
      setError("");

      const token = localStorage.getItem("token") || sessionStorage.getItem("token");

      if (!token) {
        setError("Your session has expired. Please login again.");
        setLoading(false);
        return;
      }

      const response = await fetch("http://localhost:5000/api/generate-flashcards", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: note.title || "Study Material",
          notes: note.notes || note.content || "",
          materialId: note.materialId || note.id || localStorage.getItem("activeMaterialId") || "",
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error || "Failed to generate flashcards.");
      }

      if (!data.flashcards || !Array.isArray(data.flashcards) || data.flashcards.length === 0) {
        throw new Error("No flashcards were generated.");
      }

      setCards(data.flashcards);
      setCurrentCard(0);
      setShowAnswer(false);
    } catch (err) {
      console.error("Flashcard generation error:", err);
      setError(err.message || "Unable to generate flashcards.");
    } finally {
      setLoading(false);
    }
  };

  const handleNext = () => {
    if (currentCard < cards.length - 1) {
      setCurrentCard(currentCard + 1);
      setShowAnswer(false);
    }
  };

  const handlePrevious = () => {
    if (currentCard > 0) {
      setCurrentCard(currentCard - 1);
      setShowAnswer(false);
    }
  };

  const handleShuffle = () => {
    if (cards.length <= 1) return;
    const shuffledCards = [...cards];
    for (let i = shuffledCards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledCards[i], shuffledCards[j]] = [shuffledCards[j], shuffledCards[i]];
    }
    setCards(shuffledCards);
    setCurrentCard(0);
    setShowAnswer(false);
  };

  const handleContinueToQuiz = () => {
    if (!selectedNote) return;
    localStorage.setItem("selectedQuizNote", JSON.stringify(selectedNote));
    localStorage.setItem("generatedFlashcards", JSON.stringify(cards));
    navigate("/quiz");
  };

  /* ── LOADING ── */
  if (loading) {
    return (
      <div className="flashcards-page-wrapper">
        <Navbar />
        <main className="flashcards-container">
          <div className="flashcards-loading-box">
            <div className="spinner"></div>
            <h2>Generating Flashcard Deck...</h2>
            <p>Groq AI is processing your Smart Notes into active-recall flashcards.</p>
          </div>
        </main>
      </div>
    );
  }

  /* ── ERROR ── */
  if (error || cards.length === 0) {
    return (
      <div className="flashcards-page-wrapper">
        <Navbar />
        <main className="flashcards-container">
          <div className="flashcards-error-box">
            <div className="error-icon">⚠️</div>
            <h2>Flashcards Unavailable</h2>
            <p>{error || "No flashcards were found for this study material."}</p>
            <Link to="/smart-notes" className="saas-btn-primary">
              ← Back to Smart Notes
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const card = cards[currentCard];
  const progressPercent = Math.round(((currentCard + 1) / cards.length) * 100);

  return (
    <div className="flashcards-page-wrapper">
      <Navbar />

      <main className="flashcards-container">

        {/* ── HEADER ── */}
        <header className="flashcards-header">
          <div className="flashcards-header-top-row">
            <span className="saas-badge flashcards-badge">▣ Active Recall Training</span>
            <Link to="/smart-notes" className="saas-btn-secondary back-to-notes-btn">
              ← Back to Smart Notes
            </Link>
          </div>

          <h1 className="flashcards-title">Flashcards Deck</h1>

          <p className="flashcards-material-label">
            Study Material: <strong>{selectedNote?.title || "Smart Notes"}</strong>
          </p>
        </header>

        {/* ── PROGRESS SECTION ── */}
        <section className="flashcards-progress-section" aria-label="Deck Progress">
          <div className="progress-labels-row">
            <span className="card-count">Card {currentCard + 1} of {cards.length}</span>
            <span className="progress-percent">{progressPercent}% Completed</span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${progressPercent}%` }}></div>
          </div>
        </section>

        {/* ── 3D FLIP FLASHCARD ── */}
        <div
          className="flip-card-wrapper"
          onClick={() => setShowAnswer(!showAnswer)}
          role="button"
          tabIndex={0}
          aria-label={showAnswer ? "Showing answer. Click to reveal question." : "Showing question. Click to reveal answer."}
        >
          <div className={`flip-card-inner ${showAnswer ? "is-flipped" : ""}`}>

            {/* FRONT FACE (Question) */}
            <div className="flip-card-front">
              <div className="card-header-row">
                <span className="saas-badge card-badge-question">QUESTION</span>
                {card.topic && <span className="card-topic-tag">{card.topic}</span>}
              </div>

              <div className="card-content-area">
                <h2 className="card-text">{card.question}</h2>
              </div>

              <div className="card-footer-divider">
                <span className="flip-hint-icon">↻</span> Click card to reveal answer
              </div>
            </div>

            {/* BACK FACE (Answer) */}
            <div className="flip-card-back">
              <div className="card-header-row">
                <span className="saas-badge-purple card-badge-answer">ANSWER</span>
                {card.topic && <span className="card-topic-tag">{card.topic}</span>}
              </div>

              <div className="card-content-area">
                <div className="card-text-answer">{card.answer}</div>
              </div>

              <div className="card-footer-divider">
                <span className="flip-hint-icon">↻</span> Click card to see question
              </div>
            </div>

          </div>
        </div>

        {/* ── CONTROLS ROW ── */}
        <div className="flashcards-controls-row">
          <button
            onClick={handlePrevious}
            disabled={currentCard === 0}
            className="saas-btn-secondary control-btn"
            title="Previous card (Left Arrow)"
          >
            ← Previous
          </button>

          <button
            onClick={handleShuffle}
            className="saas-btn-secondary control-btn"
            title="Shuffle deck"
          >
            🔀 Shuffle
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowAnswer(!showAnswer);
            }}
            className="saas-btn-secondary control-btn flip-toggle-btn"
            title="Flip card (Spacebar)"
          >
            {showAnswer ? "Show Question" : "Reveal Answer"}
          </button>

          <button
            onClick={handleNext}
            disabled={currentCard === cards.length - 1}
            className="saas-btn-primary control-btn"
            title="Next card (Right Arrow)"
          >
            Next Card →
          </button>
        </div>

        {/* ── KEYBOARD SHORTCUTS HINT ── */}
        <div className="keyboard-shortcuts-hint">
          <span>Keyboard shortcuts:</span> Use <kbd>←</kbd> <kbd>→</kbd> to navigate • <kbd>Space</kbd> to flip
        </div>

        {/* ── DECK COMPLETED BANNER ── */}
        {currentCard === cards.length - 1 && (
          <div className="deck-completed-banner">
            <div className="banner-text">
              <h3>🎉 Flashcard Deck Completed!</h3>
              <p>
                You have reviewed all {cards.length} cards in this material. Test your knowledge with the AI Quiz!
              </p>
            </div>
            <button onClick={handleContinueToQuiz} className="saas-btn-primary quiz-continue-btn">
              Take AI Practice Quiz →
            </button>
          </div>
        )}

      </main>
    </div>
  );
}

export default Flashcards;