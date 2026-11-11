import { useState, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import Navbar from "../components/Navbar";
import "../styles/UploadMaterial.css";

function UploadMaterial() {
  const navigate = useNavigate();
  const isProcessingRef = useRef(false);
  const [file, setFile] = useState(null);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [activeTab, setActiveTab] = useState("file"); // 'file' or 'youtube'

  const [processing, setProcessing] = useState(false);
  const [processStep, setProcessStep] = useState(0); // 1: Extract, 2: Notes, 3: Flashcards/Quiz

  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const [transcript, setTranscript] = useState("");
  const [notes, setNotes] = useState("");

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    setSuccessMessage("");
    setErrorMessage("");
    setTranscript("");
    setNotes("");

    if (!selectedFile) {
      setFile(null);
      return;
    }

    const allowedExtensions = [".pdf", ".doc", ".docx", ".ppt", ".pptx", ".txt"];
    const fileExtension = selectedFile.name.substring(selectedFile.name.lastIndexOf(".")).toLowerCase();

    if (!allowedExtensions.includes(fileExtension)) {
      setErrorMessage("Please upload PDF, DOC, DOCX, PPT, PPTX or TXT files.");
      e.target.value = "";
      setFile(null);
      return;
    }

    if (selectedFile.size > 10 * 1024 * 1024) {
      setErrorMessage("File size must be less than 10 MB.");
      e.target.value = "";
      setFile(null);
      return;
    }

    setFile(selectedFile);
    setYoutubeUrl("");
    setSuccessMessage(`Selected ${selectedFile.name} successfully.`);
  };

  const cleanMarkdown = (text) => {
    if (!text) return "";
    let cleaned = String(text);
    cleaned = cleaned.replace(/^```markdown\s*/i, "");
    cleaned = cleaned.replace(/^```md\s*/i, "");
    cleaned = cleaned.replace(/^```\s*/i, "");
    cleaned = cleaned.replace(/\s*```$/i, "");
    return cleaned.trim();
  };

  const saveNotesToStorage = (generatedNotes, materialData) => {
    try {
      const existingNotes = JSON.parse(localStorage.getItem("smartNotes") || "[]");
      const materialId = String(materialData?.materialId || Date.now().toString());
      const noteId = String(materialData?.notesId || materialId);
      const fileName = materialData?.fileName || materialData?.file || file?.name || "Study Material";

      const newNote = {
        id: noteId,
        materialId: materialId,
        title: fileName,
        fileName: fileName,
        sourceFileName: fileName,
        notes: generatedNotes,
        type: "standard",
        youtubeUrl: materialData?.youtubeUrl || null,
        sourceType: materialData?.sourceType || null,
        createdAt: materialData?.createdAt || new Date().toISOString(),
      };

      const updatedNotes = [
        newNote,
        ...existingNotes.filter(
          (item) =>
            String(item.id) !== noteId &&
            String(item.id) !== materialId &&
            String(item.materialId) !== materialId
        ),
      ];

      localStorage.setItem("smartNotes", JSON.stringify(updatedNotes));
      localStorage.setItem("activeMaterialId", materialId);
      localStorage.setItem("selectedFlashcardNote", JSON.stringify(newNote));
      localStorage.setItem("selectedQuizNote", JSON.stringify(newNote));
      localStorage.removeItem("quizQuestions");
      localStorage.removeItem("aiQuiz");
      localStorage.removeItem("quizData");
      localStorage.removeItem("generatedQuiz");
      console.log("Saved to Smart Notes:", newNote);
    } catch (error) {
      console.error("Smart Notes save error:", error);
    }
  };

  const processFile = async (token) => {
    if (!file) return;

    setProcessStep(1);
    setSuccessMessage("Extracting material text...");

    const formData = new FormData();
    formData.append("file", file);

    const stepInterval = setInterval(() => {
      setProcessStep((prev) => (prev < 3 ? prev + 1 : prev));
    }, 1500);

    try {
      const response = await fetch("http://localhost:5000/api/process", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      clearInterval(stepInterval);
      setProcessStep(3);

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "File processing failed.");
      }

      if (!data.notes) {
        throw new Error("The AI did not generate any notes.");
      }

      const formattedNotes = cleanMarkdown(data.notes);
      setNotes(formattedNotes);
      saveNotesToStorage(formattedNotes, data);

      if (data.isExisting) {
        setSuccessMessage("Existing Smart Notes loaded for this study material!");
      } else {
        setSuccessMessage("Material processed successfully! Notes saved to Smart Notes.");
      }

      setTimeout(() => {
        document.getElementById("ai-notes")?.scrollIntoView({ behavior: "smooth" });
      }, 300);

    } catch (err) {
      clearInterval(stepInterval);
      throw err;
    }
  };

  const processYoutube = async (token) => {
    const url = youtubeUrl.trim();

    setProcessStep(1);
    setSuccessMessage("Extracting YouTube lecture transcript...");

    const stepInterval = setInterval(() => {
      setProcessStep((prev) => (prev < 3 ? prev + 1 : prev));
    }, 1500);

    try {
      const response = await fetch("http://localhost:5000/api/youtube-transcript", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          url: url,
          youtubeUrl: url,
        }),
      });

      clearInterval(stepInterval);
      setProcessStep(3);

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.message || "Transcript could not be extracted.");
      }

      setTranscript(data.transcript || "");

      if (data.notes) {
        const formattedNotes = cleanMarkdown(data.notes);
        setNotes(formattedNotes);
        saveNotesToStorage(formattedNotes, data);
      }

      if (data.isExisting) {
        setSuccessMessage("Existing Smart Notes loaded for this YouTube video!");
      } else {
        setSuccessMessage("YouTube transcript processed successfully! Notes saved to Smart Notes.");
      }

    } catch (err) {
      clearInterval(stepInterval);
      throw err;
    }
  };

  const handleProcess = async () => {
    if (isProcessingRef.current || processing) return;

    setSuccessMessage("");
    setErrorMessage("");
    setTranscript("");
    setNotes("");

    const token = localStorage.getItem("token") || sessionStorage.getItem("token");

    if (!token) {
      setErrorMessage("Access denied. Please login to continue.");
      return;
    }

    if (activeTab === "file" && !file) {
      setErrorMessage("Please select a file to upload.");
      return;
    }

    if (activeTab === "youtube" && !youtubeUrl.trim()) {
      setErrorMessage("Please enter a YouTube video URL.");
      return;
    }

    if (activeTab === "youtube" && !youtubeUrl.includes("youtube.com") && !youtubeUrl.includes("youtu.be")) {
      setErrorMessage("Please enter a valid YouTube video URL.");
      return;
    }

    try {
      isProcessingRef.current = true;
      setProcessing(true);

      if (activeTab === "youtube") {
        await processYoutube(token);
      } else {
        await processFile(token);
      }
    } catch (error) {
      console.error("Processing Error:", error);
      setSuccessMessage("");
      setErrorMessage(error.message || "Unable to process the study material.");
    } finally {
      isProcessingRef.current = false;
      setProcessing(false);
    }
  };

  const markdownComponents = {
    h1: ({ children }) => <h1 className="note-h1">{children}</h1>,
    h2: ({ children }) => <h2 className="note-h2">{children}</h2>,
    h3: ({ children }) => <h3 className="note-h3">{children}</h3>,
    p: ({ children }) => <p className="note-paragraph">{children}</p>,
    ul: ({ children }) => <ul className="note-list">{children}</ul>,
    ol: ({ children }) => <ol className="note-number-list">{children}</ol>,
    li: ({ children }) => <li className="note-list-item">{children}</li>,
    strong: ({ children }) => <strong className="note-bold">{children}</strong>,
  };

  return (
    <div className="upload-page-wrapper">
      <Navbar />

      <main className="upload-container saas-container">
        
        {/* HEADER BAR */}
        <div className="upload-page-header">
          <div>
            <div className="saas-badge">✨ AI Learning Pipeline</div>
            <h1 className="upload-page-title">Upload Study Material</h1>
            <p className="upload-page-subtext">
              Support for PDFs, PowerPoint slides, Word documents, text notes, and YouTube video lectures.
            </p>
          </div>
          <Link to="/dashboard" className="saas-btn-secondary">
            ← Back to Dashboard
          </Link>
        </div>

        {/* MESSAGES */}
        {errorMessage && (
          <div className="upload-alert-box error">
            <span>⚠️</span> {errorMessage}
          </div>
        )}

        {/* INPUT MODE TABS */}
        <div className="upload-mode-card">
          <div className="tab-switcher">
            <button
              className={activeTab === "file" ? "tab-btn active" : "tab-btn"}
              onClick={() => {
                setActiveTab("file");
                setErrorMessage("");
              }}
            >
              📁 File Upload (PDF, PPTX, DOCX, TXT)
            </button>
            <button
              className={activeTab === "youtube" ? "tab-btn active" : "tab-btn"}
              onClick={() => {
                setActiveTab("youtube");
                setErrorMessage("");
              }}
            >
              ▶ YouTube Video Lecture URL
            </button>
          </div>

          {activeTab === "file" ? (
            <div className="dropzone-wrapper">
              <label className="saas-dropzone">
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.ppt,.pptx,.txt"
                  onChange={handleFileChange}
                />
                <div className="dropzone-icon">📤</div>
                <h3 className="dropzone-title">
                  {file ? file.name : "Click or drag file to this area to upload"}
                </h3>
                <p className="dropzone-desc">
                  Supports PDF, PPTX, PPT, DOCX, DOC, TXT (Up to 10MB)
                </p>
              </label>
            </div>
          ) : (
            <div className="youtube-input-wrapper">
              <label className="form-label">Paste Public YouTube Lecture URL</label>
              <div className="input-with-icon">
                <span className="input-icon">▶</span>
                <input
                  type="url"
                  placeholder="https://www.youtube.com/watch?v=..."
                  value={youtubeUrl}
                  onChange={(e) => {
                    setYoutubeUrl(e.target.value);
                    setErrorMessage("");
                  }}
                  className="form-input"
                />
              </div>
              <p className="field-hint">EduGen AI will fetch the transcript and generate structured Smart Notes & Quizzes.</p>
            </div>
          )}

          {/* PROCESS ACTION */}
          <div className="process-action-bar">
            <button
              onClick={handleProcess}
              className="saas-btn-primary process-main-btn"
              disabled={processing || (activeTab === "file" && !file) || (activeTab === "youtube" && !youtubeUrl.trim())}
            >
              {processing ? "AI is Processing Material..." : "Generate AI Learning Material →"}
            </button>
          </div>
        </div>

        {/* PROCESSING STEP INDICATOR */}
        {processing && (
          <div className="processing-progress-card">
            <div className="progress-bar-track">
              <div className={`progress-bar-fill step-${processStep}`}></div>
            </div>
            <div className="progress-steps-row">
              <div className={`step-item ${processStep >= 1 ? "active" : ""}`}>
                <span>1</span> Text Extraction
              </div>
              <div className={`step-item ${processStep >= 2 ? "active" : ""}`}>
                <span>2</span> Groq AI Smart Notes
              </div>
              <div className={`step-item ${processStep >= 3 ? "active" : ""}`}>
                <span>3</span> Flashcards & AI Quiz
              </div>
            </div>
          </div>
        )}

        {/* TRANSCRIPT PREVIEW */}
        {transcript && (
          <div className="transcript-box">
            <h4 className="box-heading">Extracted Video Transcript</h4>
            <div className="transcript-text">{transcript}</div>
          </div>
        )}

        {/* AI GENERATED NOTES & COMPLETION CARD */}
        {notes && (
          <section id="ai-notes" className="generated-notes-card">
            
            <div className="notes-card-header">
              <div>
                <span className="saas-badge">✓ AI Processing Complete</span>
                <h2 className="notes-title">AI Generated Smart Notes</h2>
              </div>
            </div>

            <div className="markdown-rendered-notes">
              <ReactMarkdown components={markdownComponents}>
                {notes}
              </ReactMarkdown>
            </div>

            {/* REQUIRED COMPLETION NAV CARD */}
            <div className="notes-completion-card">
              <div className="completion-card-content">
                <div className="success-icon-badge">✅</div>
                <div>
                  <h3 className="completion-card-heading">These notes are saved in Smart Notes!</h3>
                  <p className="completion-card-subtext">
                    Your material has been fully processed into Smart Notes, interactive Flashcards, and an AI Quiz deck.
                  </p>
                </div>
              </div>

              <div className="completion-actions-row">
                <button
                  onClick={() => navigate("/smart-notes")}
                  className="saas-btn-primary view-smart-notes-btn"
                >
                  View Smart Notes →
                </button>
                <button
                  onClick={() => navigate("/flashcards")}
                  className="saas-btn-secondary"
                >
                  View Flashcards
                </button>
                <button
                  onClick={() => navigate("/quiz")}
                  className="saas-btn-secondary"
                >
                  Take AI Quiz
                </button>
              </div>
            </div>

          </section>
        )}

      </main>
    </div>
  );
}

export default UploadMaterial;