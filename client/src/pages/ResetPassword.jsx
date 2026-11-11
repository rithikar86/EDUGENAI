import { useState, useEffect } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import "../styles/ForgotPassword.css";

function ResetPassword() {
  const { token } = useParams();
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [verifying, setVerifying] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Verify token validity on load
  useEffect(() => {
    let isMounted = true;
    const verifyToken = async () => {
      if (!token) {
        if (isMounted) {
          setErrorMsg("No reset token provided. Please request a new password reset link.");
          setVerifying(false);
          setTokenValid(false);
        }
        return;
      }

      try {
        const response = await fetch(`http://localhost:5000/api/reset-password/${token}`);
        const data = await response.json();

        if (isMounted) {
          if (response.ok && data.success) {
            setTokenValid(true);
            setUserEmail(data.email || "");
          } else {
            setTokenValid(false);
            setErrorMsg(data.message || "Password reset link is invalid or has expired.");
          }
        }
      } catch (err) {
        console.error("Token verification error:", err);
        if (isMounted) {
          setTokenValid(false);
          setErrorMsg("Could not verify password reset link. Please check your network connection.");
        }
      } finally {
        if (isMounted) {
          setVerifying(false);
        }
      }
    };

    verifyToken();

    return () => {
      isMounted = false;
    };
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");

    if (!password || !confirmPassword) {
      setErrorMsg("Please fill in both password fields.");
      return;
    }

    if (password.length < 6) {
      setErrorMsg("Password must be at least 6 characters long.");
      return;
    }

    if (password !== confirmPassword) {
      setErrorMsg("Passwords do not match. Please re-enter.");
      return;
    }

    try {
      setLoading(true);

      const response = await fetch("http://localhost:5000/api/reset-password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          token,
          password,
          confirmPassword,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setErrorMsg(data.message || "Failed to reset password. Please try requesting a new link.");
        return;
      }

      setSuccessMsg("Password reset successfully! Redirecting to login...");
      setTimeout(() => {
        navigate("/login");
      }, 2000);
    } catch (err) {
      console.error("Reset password submission error:", err);
      setErrorMsg("Server connection error. Please try again.");
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
            <div className="auth-badge">🔐 New Password</div>
            <h1 className="auth-title">Create New Password</h1>
            <p className="auth-subtitle">
              {userEmail
                ? `Enter a new password for ${userEmail}`
                : "Choose a strong password with at least 6 characters."}
            </p>
          </div>

          {verifying ? (
            <div style={{ textAlign: "center", padding: "2rem 0" }}>
              <div
                style={{
                  width: "36px",
                  height: "36px",
                  border: "3px solid #ede9fe",
                  borderTopColor: "#7c3aed",
                  borderRadius: "50%",
                  margin: "0 auto 1rem",
                  animation: "spin 0.8s linear infinite",
                }}
              ></div>
              <p style={{ color: "#64748b", fontSize: "0.875rem" }}>Verifying reset link...</p>
            </div>
          ) : !tokenValid ? (
            <div className="reset-success-box">
              <div className="success-icon-badge" style={{ color: "#ef4444" }}>⚠️</div>
              <h3 className="success-heading" style={{ color: "#1e1b4b" }}>Link Expired or Invalid</h3>
              <p className="success-text">{errorMsg}</p>
              <Link to="/forgot-password" className="saas-btn-primary full-width-btn" style={{ display: "inline-block", textAlign: "center" }}>
                Request New Reset Link →
              </Link>
            </div>
          ) : successMsg ? (
            <div className="reset-success-box">
              <div className="success-icon-badge">✅</div>
              <h3 className="success-heading">Password Reset Complete!</h3>
              <p className="success-text">
                Your password has been successfully updated. Redirecting to login page...
              </p>
              <Link to="/login" className="saas-btn-primary full-width-btn" style={{ display: "inline-block", textAlign: "center" }}>
                Log In Now →
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="auth-form">
              {errorMsg && (
                <div
                  className="auth-error-alert"
                  style={{
                    padding: "0.75rem 1rem",
                    backgroundColor: "#fef2f2",
                    border: "1px solid #fecaca",
                    borderRadius: "10px",
                    color: "#dc2626",
                    fontSize: "0.85rem",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                  }}
                >
                  <span>⚠️</span> <span>{errorMsg}</span>
                </div>
              )}

              <div className="form-group">
                <label htmlFor="password" className="form-label">
                  New Password
                </label>
                <div className="input-with-icon" style={{ position: "relative" }}>
                  <span className="input-icon">🔒</span>
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
                    placeholder="At least 6 characters"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="form-input"
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{
                      position: "absolute",
                      right: "0.75rem",
                      background: "none",
                      border: "none",
                      color: "#94a3b8",
                      cursor: "pointer",
                      fontSize: "0.85rem",
                    }}
                    title={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? "👁️" : "👁️‍🗨️"}
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="confirmPassword" className="form-label">
                  Confirm New Password
                </label>
                <div className="input-with-icon">
                  <span className="input-icon">🔒</span>
                  <input
                    id="confirmPassword"
                    type={showPassword ? "text" : "password"}
                    required
                    placeholder="Re-enter new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="form-input"
                    disabled={loading}
                  />
                </div>
              </div>

              <button
                type="submit"
                className="saas-btn-primary form-submit-btn"
                disabled={loading}
              >
                {loading ? "Updating Password..." : "Update Password →"}
              </button>

              <div className="auth-footer-link">
                Remember your password? <Link to="/login">Return to Log In</Link>
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}

export default ResetPassword;
