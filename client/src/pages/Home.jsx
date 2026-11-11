import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import Navbar from "../components/Navbar";
import edugenLogo from "../assets/edugen_logo.jpg";
import "../styles/Home.css";

// Vector Illustration: Books with Graduation Cap and Glowing Lightbulb (Panel 4)
function AboutLearningIllustration() {
  return (
    <div className="about-illustration-wrapper">
      <div className="about-glow-circle"></div>
      <svg
        className="about-illustration-svg"
        viewBox="0 0 420 360"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {/* Soft Ground Shadow */}
        <ellipse cx="210" cy="325" rx="150" ry="16" fill="#ede9fe" />

        {/* Bottom Book (Deep Purple) */}
        <g id="about-book-bottom">
          <rect x="90" y="280" width="240" height="32" rx="6" fill="#4338ca" />
          <rect x="96" y="285" width="228" height="22" rx="3" fill="#6366f1" />
          <path d="M96 288 L318 288 L318 304 L96 304 Z" fill="#ffffff" />
          <line x1="320" y1="288" x2="320" y2="304" stroke="#e2e8f0" strokeWidth="2" />
          {/* Spine Accent */}
          <rect x="90" y="280" width="22" height="32" rx="4" fill="#312e81" />
          <line x1="98" y1="285" x2="98" y2="307" stroke="#ffffff" strokeWidth="1.5" strokeOpacity="0.6" />
        </g>

        {/* Top Book (Vibrant Blue/Violet) */}
        <g id="about-book-top">
          <rect x="110" y="244" width="200" height="34" rx="6" fill="#3b82f6" />
          <rect x="115" y="249" width="190" height="24" rx="3" fill="#60a5fa" />
          <path d="M115 252 L298 252 L298 268 L115 268 Z" fill="#ffffff" />
          <line x1="300" y1="252" x2="300" y2="268" stroke="#e2e8f0" strokeWidth="2" />
          {/* Spine Accent */}
          <rect x="110" y="244" width="20" height="34" rx="4" fill="#1d4ed8" />
          <line x1="117" y1="249" x2="117" y2="273" stroke="#ffffff" strokeWidth="1.5" strokeOpacity="0.6" />
        </g>

        {/* Graduation Cap */}
        <g id="about-grad-cap" transform="translate(145, 175)">
          {/* Cap Skull Base */}
          <path d="M30 42 Q65 56 100 42 L100 58 Q65 72 30 58 Z" fill="#1e1b4b" />
          {/* Top Diamond Board */}
          <polygon points="65,8 128,28 65,48 2,28" fill="#312e81" stroke="#4338ca" strokeWidth="2.5" />
          <polygon points="65,8 65,48 2,28" fill="#1e1b4b" />
          {/* Center Button */}
          <circle cx="65" cy="28" r="4.5" fill="#f59e0b" />
          {/* Tassel */}
          <path d="M65 28 Q98 32 104 48" stroke="#f59e0b" strokeWidth="3" fill="none" strokeLinecap="round" />
          <circle cx="104" cy="50" r="4" fill="#f59e0b" />
        </g>

        {/* Radiant Glowing Lightbulb */}
        <g id="about-lightbulb">
          {/* Radiant Energy Rays */}
          <g stroke="#f59e0b" strokeWidth="3" strokeLinecap="round">
            <line x1="210" y1="35" x2="210" y2="48" />
            <line x1="168" y1="52" x2="178" y2="62" />
            <line x1="252" y1="52" x2="242" y2="62" />
            <line x1="150" y1="92" x2="164" y2="92" />
            <line x1="270" y1="92" x2="256" y2="92" />
          </g>

          {/* Lightbulb Glow Backdrop */}
          <circle cx="210" cy="92" r="38" fill="#fef3c7" opacity="0.6" />

          {/* Bulb Body */}
          <path
            d="M190 95 C185 75 195 60 210 60 C225 60 235 75 230 95 C226 107 220 114 220 122 L200 122 C200 114 194 107 190 95 Z"
            fill="#fbbf24"
            stroke="#f59e0b"
            strokeWidth="3"
          />

          {/* Filament */}
          <path d="M204 90 Q210 82 216 90" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" fill="none" />

          {/* Bulb Screw Base */}
          <rect x="202" y="122" width="16" height="5" rx="1.5" fill="#94a3b8" />
          <rect x="203" y="127" width="14" height="4" rx="1.5" fill="#64748b" />
          <path d="M205 131 Q210 135 215 131 Z" fill="#475569" />
        </g>
      </svg>
    </div>
  );
}

function Home() {
  const location = useLocation();
  const [contactForm, setContactForm] = useState({ name: "", email: "", subject: "", message: "" });
  const [contactSubmitted, setContactSubmitted] = useState(false);
  const [contactSubmittedEmail, setContactSubmittedEmail] = useState("");
  const [contactLoading, setContactLoading] = useState(false);
  const [contactError, setContactError] = useState("");

  // Smooth scroll to sections when URL hash or pathname changes
  useEffect(() => {
    const pathToId = {
      "/features": "features",
      "/how-it-works": "how-it-works",
      "/about": "about",
      "/contact": "contact",
    };
    const targetId = pathToId[location.pathname] || (location.hash ? location.hash.replace("#", "") : null);
    if (targetId) {
      setTimeout(() => {
        const el = document.getElementById(targetId);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }, 50);
    } else if (location.pathname === "/") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [location.pathname, location.hash]);

  const handleContactSubmit = async (e) => {
    e.preventDefault();
    setContactError("");

    const name = (contactForm.name || "").trim();
    const email = (contactForm.email || "").trim();
    const subject = (contactForm.subject || "").trim();
    const message = (contactForm.message || "").trim();

    if (!name) {
      setContactError("Please enter your name.");
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      setContactError("Please enter a valid email address.");
      return;
    }

    if (!message) {
      setContactError("Please write your message before sending.");
      return;
    }

    setContactLoading(true);

    try {
      const response = await fetch("http://localhost:5000/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, subject, message }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setContactSubmittedEmail(email);
        setContactSubmitted(true);
        setContactForm({ name: "", email: "", subject: "", message: "" });
        setContactError("");
      } else {
        setContactError(data.message || "Failed to send message. Please try again later.");
      }
    } catch (err) {
      console.error("Contact submission error:", err);
      setContactError("Unable to connect to the server. Please verify your internet connection and try again.");
    } finally {
      setContactLoading(false);
    }
  };

  return (
    <div className="home-page-container">
      <Navbar />

      <main className="home-main-content">
        
        {/* =========================================================
            PANEL 1: HOME (HERO SECTION)
            ========================================================= */}
        <section className="home-section-card hero-section-card" id="home">
          <div className="hero-grid-layout">
            
            {/* Left Content */}
            <div className="hero-left-content">
              <div className="saas-badge hero-badge">
                <span className="badge-icon">✨</span> AI-Powered Learning Assistant
              </div>

              <h1 className="hero-heading">
                Transform Your Study Material Into{" "}
                <span className="text-purple-highlight">Interactive Learning</span>
              </h1>

              <p className="hero-subheading">
                Upload PDFs, lecture slides, documents, or YouTube videos to instantly generate
                smart notes, active-recall flashcards, AI quizzes, and targeted weak-topic revision notes.
              </p>

              <div className="hero-cta-group">
                <Link to="/register" className="saas-btn-primary hero-main-btn">
                  Get Started Free →
                </Link>
                <a href="#features" className="saas-btn-secondary hero-sec-btn">
                  Explore Features
                </a>
              </div>
            </div>

            {/* Right Visual: 3 Realistic Product Preview Cards */}
            <div className="hero-right-visual">
              <div className="hero-preview-cards-stack">
                
                {/* 1. AI Generated Note Preview Card */}
                <div className="preview-card-hero preview-notes-card">
                  <div className="preview-notes-header">
                    <span className="preview-notes-badge">
                      <span className="preview-doc-icon">📄</span> AI GENERATED NOTE
                    </span>
                    <span className="preview-notes-source">Source: EduGen_Lecture.pdf</span>
                  </div>
                  <h4 className="preview-notes-title">Process Scheduling & Normalization</h4>
                  <p className="preview-notes-text">
                    Shortest Remaining Time First (SRTF) is the preemptive version of SJF scheduling. 3NF removes transitive dependencies to ensure zero data redundancy.
                  </p>
                  <div className="preview-notes-tags">
                    <span className="preview-tag-pill">Preemptive</span>
                    <span className="preview-tag-pill">CPU Scheduling</span>
                    <span className="preview-tag-pill">3NF Normalization</span>
                  </div>
                </div>

                {/* 2. Quiz Mastery Score Preview Card */}
                <div className="preview-card-hero preview-score-card">
                  <div className="preview-score-accent-bar"></div>
                  <div className="preview-score-content">
                    <div className="preview-score-icon-wrap">
                      <span className="preview-score-emoji">🎯</span>
                    </div>
                    <div className="preview-score-info">
                      <span className="preview-score-label">Quiz Mastery Score</span>
                      <div className="preview-score-metric">
                        <span className="preview-score-number">92%</span>
                        <span className="preview-score-trend">+18% vs last week</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 3. Flashcard Preview Card */}
                <div className="preview-card-hero preview-flashcard-card">
                  <div className="preview-flashcard-badge">
                    <span className="preview-card-icon-shape">▣</span> FLASHCARD
                  </div>
                  <h4 className="preview-flashcard-question">
                    Q: What is 3NF in Database Management?
                  </h4>
                  <p className="preview-flashcard-hint">
                    Click card to flip answer ↻
                  </p>
                </div>

              </div>
            </div>

          </div>

          {/* Decorative Corner Ambient Waves matching reference visual style */}
          <div className="hero-wave-decoration hero-wave-bottom-left" aria-hidden="true"></div>
          <div className="hero-wave-decoration hero-wave-bottom-right" aria-hidden="true"></div>
        </section>

        {/* =========================================================
            PANEL 2: FEATURES SECTION
            ========================================================= */}
        <section className="home-section-card features-section-card" id="features">
          <div className="section-header-center">
            <div className="saas-badge section-badge">
              <span className="badge-icon">⚙️</span> Core Features
            </div>
            <h2 className="section-title">Everything You Need to Master Any Subject</h2>
            <p className="section-subtitle">
              An all-in-one AI learning workspace designed to cut study time in half and maximize exam recall.
            </p>
          </div>

          <div className="features-6-grid">
            
            {/* 1. AI Smart Notes */}
            <div className="feature-card-modern">
              <div className="feature-icon-box">📄</div>
              <h3 className="feature-title">AI Smart Notes</h3>
              <p className="feature-desc">
                Convert your study material into clear, structured and concise notes automatically.
              </p>
            </div>

            {/* 2. Interactive Flashcards */}
            <div className="feature-card-modern">
              <div className="feature-icon-box">📚</div>
              <h3 className="feature-title">Interactive Flashcards</h3>
              <p className="feature-desc">
                Auto-generate active recall flashcards with simple and animated flips.
              </p>
            </div>

            {/* 3. AI Quiz & Mock Tests */}
            <div className="feature-card-modern">
              <div className="feature-icon-box">🎯</div>
              <h3 className="feature-title">AI Quiz & Mock Tests</h3>
              <p className="feature-desc">
                Generate topic-wise quizzes and full mock tests with instant score analysis.
              </p>
            </div>

            {/* 4. Weak Topic Analysis */}
            <div className="feature-card-modern">
              <div className="feature-icon-box">📊</div>
              <h3 className="feature-title">Weak Topic Analysis</h3>
              <p className="feature-desc">
                Identify low-scoring topics and get targeted revision notes.
              </p>
            </div>

            {/* 5. Revision Scheduler */}
            <div className="feature-card-modern">
              <div className="feature-icon-box">📅</div>
              <h3 className="feature-title">Revision Scheduler</h3>
              <p className="feature-desc">
                Plan your study, set reminders and stay consistent.
              </p>
            </div>

            {/* 6. Mistake Notebook */}
            <div className="feature-card-modern">
              <div className="feature-icon-box">📋</div>
              <h3 className="feature-title">Mistake Notebook</h3>
              <p className="feature-desc">
                Automatically track your mistakes and revise them anytime.
              </p>
            </div>

          </div>
        </section>

        {/* =========================================================
            PANEL 3: HOW IT WORKS SECTION
            ========================================================= */}
        <section className="home-section-card how-it-works-section-card" id="how-it-works">
          <div className="section-header-center">
            <div className="saas-badge section-badge">
              <span className="badge-icon">⚙️</span> How It Works
            </div>
            <h2 className="section-title">Master Any Material in 3 Simple Steps</h2>
            <p className="section-subtitle">
              No complicated setup. Just upload your study material and let EduGenAI handle the rest.
            </p>
          </div>

          <div className="steps-3-grid-connected">
            
            {/* Step 1 */}
            <div className="step-card-modern">
              <div className="step-num-pill">01</div>
              <div className="step-icon-wrapper">☁️</div>
              <h3 className="step-title">Upload Study Material</h3>
              <p className="step-desc">
                Drop your PDF, slide deck, document, or paste a YouTube URL...
              </p>
            </div>

            {/* Connecting Arrow 1 */}
            <div className="step-arrow-connector" aria-hidden="true">→</div>

            {/* Step 2 */}
            <div className="step-card-modern">
              <div className="step-num-pill">02</div>
              <div className="step-icon-wrapper">⚙️</div>
              <h3 className="step-title">AI Generates Notes & Quizzes</h3>
              <p className="step-desc">
                Get structured notes, flashcards, and quizzes instantly.
              </p>
            </div>

            {/* Connecting Arrow 2 */}
            <div className="step-arrow-connector" aria-hidden="true">→</div>

            {/* Step 3 */}
            <div className="step-card-modern">
              <div className="step-num-pill">03</div>
              <div className="step-icon-wrapper">📊</div>
              <h3 className="step-title">Fix Weak Topics & Excel</h3>
              <p className="step-desc">
                Review weak-topic notes, practice quizzes, and improve your score.
              </p>
            </div>

          </div>
        </section>

        {/* =========================================================
            PANEL 4: ABOUT SECTION
            ========================================================= */}
        <section className="home-section-card about-section-card" id="about">
          <div className="about-grid-layout">
            
            {/* Left Content */}
            <div className="about-left-col">
              <div className="saas-badge section-badge">
                <span className="badge-icon">ℹ️</span> About EduGenAI
              </div>

              <h2 className="section-title about-main-title">
                Empowering Students with Next-Gen AI Learning
              </h2>

              <p className="about-paragraph">
                EduGenAI was built to solve a major problem faced by college and university students:
                spending endless hours creating revision notes instead of actively understanding core concepts.
              </p>

              <p className="about-paragraph">
                Our platform leverages advanced AI models (Groq) to automatically parse complex lecture materials
                into high-yield Smart Notes, 3D Flashcard decks, and topic-specific diagnostic quizzes.
              </p>

              {/* 2 Feature Highlight Cards */}
              <div className="about-highlights-grid">
                
                <div className="about-highlight-card">
                  <div className="highlight-icon">🧠</div>
                  <div className="highlight-content">
                    <h4 className="highlight-title">Active Recall & Retention</h4>
                    <p className="highlight-desc">
                      Flashcards and adaptive quizzes reinforce key concepts for long-term memory.
                    </p>
                  </div>
                </div>

                <div className="about-highlight-card">
                  <div className="highlight-icon">🎯</div>
                  <div className="highlight-content">
                    <h4 className="highlight-title">Weak Topic Mastery</h4>
                    <p className="highlight-desc">
                      Pinpoint exact subtopics scoring under 70% and generate separate targeted revision notes.
                    </p>
                  </div>
                </div>

              </div>
            </div>

            {/* Right Visual: Books + Graduation Cap + Lightbulb */}
            <div className="about-right-visual">
              <AboutLearningIllustration />
            </div>

          </div>
        </section>

        {/* =========================================================
            PANEL 5: CONTACT SECTION
            ========================================================= */}
        <section className="home-section-card contact-section-card" id="contact">
          <div className="section-header-center">
            <div className="saas-badge section-badge">
              <span className="badge-icon">✉️</span> Contact Us
            </div>
            <h2 className="section-title">Have Questions or Need Help?</h2>
            <p className="section-subtitle">
              Reach out to our support team and we will get back to you promptly.
            </p>
          </div>

          <div className="contact-grid-layout">
            
            {/* Left: Contact Info */}
            <div className="contact-info-col">
              <h3 className="contact-info-heading">Get In Touch</h3>

              <div className="contact-items-list">
                
                <div className="contact-info-item">
                  <div className="contact-icon-box">✉️</div>
                  <div className="contact-text-box">
                    <strong className="contact-item-label">Email Support</strong>
                    <p className="contact-item-val">support@edugenai.edu</p>
                  </div>
                </div>

                <div className="contact-info-item">
                  <div className="contact-icon-box">🏛️</div>
                  <div className="contact-text-box">
                    <strong className="contact-item-label">Campus Office</strong>
                    <p className="contact-item-val">
                      EduGenAI Student Tech Hub, Department of Computer Science
                    </p>
                  </div>
                </div>

                <div className="contact-info-item">
                  <div className="contact-icon-box">🕒</div>
                  <div className="contact-text-box">
                    <strong className="contact-item-label">Working Hours</strong>
                    <p className="contact-item-val">Monday - Friday, 9:00 AM - 5:00 PM</p>
                  </div>
                </div>

              </div>
            </div>

            {/* Right: Contact Form */}
            <div className="contact-form-col">
              <div className="contact-form-card">
                {contactSubmitted ? (
                  <div className="contact-success-state">
                    <div className="success-icon-badge">✅</div>
                    <h3 className="success-title">Message Sent Successfully!</h3>
                    <p className="success-subtext">
                      Thank you for reaching out. A member of the EduGenAI team will respond to {contactSubmittedEmail} shortly.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setContactSubmitted(false);
                        setContactError("");
                      }}
                      className="saas-btn-secondary"
                    >
                      Send Another Message
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleContactSubmit} className="contact-styled-form">
                    
                    {contactError && (
                      <div className="contact-error-banner" role="alert">
                        <span className="error-icon" aria-hidden="true">⚠️</span>
                        <span className="error-text">{contactError}</span>
                      </div>
                    )}

                    <div className="form-field-wrapper">
                      <span className="field-prefix-icon" aria-hidden="true">👤</span>
                      <input
                        type="text"
                        required
                        disabled={contactLoading}
                        placeholder="Your Name"
                        value={contactForm.name}
                        onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                        className="form-input-with-icon"
                      />
                    </div>

                    <div className="form-field-wrapper">
                      <span className="field-prefix-icon" aria-hidden="true">✉️</span>
                      <input
                        type="email"
                        required
                        disabled={contactLoading}
                        placeholder="Email Address"
                        value={contactForm.email}
                        onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                        className="form-input-with-icon"
                      />
                    </div>

                    <div className="form-field-wrapper">
                      <span className="field-prefix-icon" aria-hidden="true">🏷️</span>
                      <input
                        type="text"
                        disabled={contactLoading}
                        placeholder="Subject"
                        value={contactForm.subject}
                        onChange={(e) => setContactForm({ ...contactForm, subject: e.target.value })}
                        className="form-input-with-icon"
                      />
                    </div>

                    <div className="form-field-wrapper form-textarea-wrapper">
                      <span className="field-prefix-icon textarea-icon" aria-hidden="true">✏️</span>
                      <textarea
                        required
                        disabled={contactLoading}
                        rows="4"
                        placeholder="Write your message here..."
                        value={contactForm.message}
                        onChange={(e) => setContactForm({ ...contactForm, message: e.target.value })}
                        className="form-textarea-with-icon"
                      ></textarea>
                    </div>

                    <button 
                      type="submit" 
                      disabled={contactLoading}
                      className="saas-btn-primary contact-submit-btn"
                    >
                      {contactLoading ? "⏳ Sending Message..." : "✈️ Send Message"}
                    </button>

                  </form>
                )}
              </div>
            </div>

          </div>
        </section>

      </main>

      {/* FOOTER */}
      <footer className="saas-footer">
        <div className="footer-container">
          <div className="footer-content-grid">
            
            <div className="footer-brand-col">
              <div className="saas-logo">
                <div className="saas-logo-cap-wrapper">
                  <img src={edugenLogo} alt="EduGenAI Logo" className="saas-logo-cap-img" />
                </div>
                <span className="saas-logo-text">EduGen<span className="logo-highlight">AI</span></span>
              </div>
              <p className="footer-brand-desc">
                Your intelligent AI-powered study assistant for note generation, flashcards, adaptive quizzes, and weak topic revision.
              </p>
            </div>

            <div className="footer-links-col">
              <h4 className="footer-heading">Platform</h4>
              <a href="#home">Home</a>
              <a href="#features">Features</a>
              <a href="#how-it-works">How It Works</a>
              <a href="#about">About</a>
              <a href="#contact">Contact</a>
            </div>

            <div className="footer-links-col">
              <h4 className="footer-heading">Learning Tools</h4>
              <Link to="/smart-notes">Smart Notes</Link>
              <Link to="/flashcards">Flashcards</Link>
              <Link to="/quiz">AI Quiz</Link>
              <Link to="/weak-topics">Weak Topics</Link>
            </div>

            <div className="footer-links-col">
              <h4 className="footer-heading">Account</h4>
              <Link to="/login">Log In</Link>
              <Link to="/register">Sign Up</Link>
              <Link to="/forgot-password">Forgot Password</Link>
            </div>

          </div>

          <div className="footer-bottom-bar">
            <p>© {new Date().getFullYear()} EduGenAI. All rights reserved.</p>
            <p>Designed for academic excellence ✨</p>
          </div>
        </div>
      </footer>

    </div>
  );
}

export default Home;
