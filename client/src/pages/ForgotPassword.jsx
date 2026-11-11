import { useState } from "react";
import { Link } from "react-router-dom";
import Navbar from "../components/Navbar";
import "../styles/ForgotPassword.css";

function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successText, setSuccessText] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg("");

    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setErrorMsg("Please enter your email address.");
      return;
    }

    try {
      setLoading(true);

      const response = await fetch("http://localhost:5000/api/forgot-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: cleanEmail }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setErrorMsg(data.message || "Unable to process password reset. Please verify your email.");
        return;
      }

      setSuccessText(data.message || `We've sent password reset instructions to ${cleanEmail}.`);
      setSubmitted(true);
    } catch (err) {
      console.error("Forgot password request error:", err);
      setErrorMsg("Unable to connect to the server. Please check your network connection.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page-wrapper">
      <Navbar />

      <main className="auth-container">
        <div className="auth-card">
          <div className="auth-header">
            <div className="auth-badge">🔑 Password Recovery</div>
            <h1 className="auth-title">Reset Your Password</h1>
            <p className="auth-subtitle">
              Enter the email address associated with your EduGen AI account, and we'll send you a secure link to reset your password.
            </p>
          </div>

          {errorMsg && (
            <div className="auth-error-alert" style={{ marginBottom: "1.25rem", padding: "0.75rem 1rem", backgroundColor: "#fef2f2", border: "1px solid #fecaca", borderRadius: "10px", color: "#dc2626", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span>⚠️</span> <span>{errorMsg}</span>
            </div>
          )}

          {!submitted ? (
            <form onSubmit={handleSubmit} className="auth-form">
              <div className="form-group">
                <label htmlFor="email" className="form-label">Email Address</label>
                <div className="input-with-icon">
                  <span className="input-icon">✉️</span>
                  <input
                    id="email"
                    type="email"
                    required
                    placeholder="student@university.edu"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="form-input"
                  />
                </div>
              </div>

              <button 
                type="submit" 
                className="saas-btn-primary form-submit-btn"
                disabled={loading}
              >
                {loading ? "Sending Instructions..." : "Send Reset Link →"}
              </button>

              <div className="auth-footer-link">
                Remember your password? <Link to="/login">Return to Log In</Link>
              </div>
            </form>
          ) : (
            <div className="reset-success-box">
              <div className="success-icon-badge">✅</div>
              <h3 className="success-heading">Check Your Email</h3>
              <p className="success-text">
                We've sent password reset instructions to <strong>{email}</strong>. Please check your inbox and spam folder.
              </p>
              <Link to="/login" className="saas-btn-secondary full-width-btn">
                ← Back to Log In
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default ForgotPassword;
