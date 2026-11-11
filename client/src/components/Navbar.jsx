import { useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import edugenLogo from "../assets/edugen_logo.jpg";
import "../styles/Navbar.css";

function Navbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const storedUser = localStorage.getItem("user");
    const token = localStorage.getItem("token");
    if (token && storedUser) {
      try {
        setUser(JSON.parse(storedUser));
      } catch (e) {
        setUser(null);
      }
    } else {
      setUser(null);
    }
  }, [location]);

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("user");
    setUser(null);
    navigate("/");
  };

  const isActive = (path) => {
    // Exact route matching for all authenticated application pages
    if (
      path === "/dashboard" ||
      path === "/upload" ||
      path === "/smart-notes" ||
      path === "/flashcards" ||
      path === "/quiz" ||
      path === "/weak-topics"
    ) {
      return location.pathname === path;
    }

    // Public marketing links (with hash support for section scrolling)
    if (path === "/") {
      return (
        (location.pathname === "/" || location.pathname === "") &&
        (!location.hash || location.hash === "#" || location.hash === "#home")
      );
    }
    if (path === "/features") {
      return location.pathname === "/features" || (location.pathname === "/" && location.hash === "#features");
    }
    if (path === "/how-it-works") {
      return location.pathname === "/how-it-works" || (location.pathname === "/" && location.hash === "#how-it-works");
    }
    if (path === "/about") {
      return location.pathname === "/about" || (location.pathname === "/" && location.hash === "#about");
    }
    if (path === "/contact") {
      return location.pathname === "/contact" || (location.pathname === "/" && location.hash === "#contact");
    }

    return location.pathname === path;
  };

  const handleNavClick = (targetPath, targetHash) => {
    setMobileMenuOpen(false);
    if (location.pathname === "/" || location.pathname === targetPath) {
      if (targetHash) {
        const el = document.getElementById(targetHash.replace("#", ""));
        if (el) el.scrollIntoView({ behavior: "smooth" });
      } else {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    }
  };

  return (
    <header className="saas-header">
      <div className="saas-nav-container">
        
        {/* Brand Logo with Official EduGen AI Graduation Cap + Book Logo */}
        <Link to={user ? "/dashboard" : "/"} className="saas-logo">
          <div className="saas-logo-cap-wrapper">
            <img src={edugenLogo} alt="EduGen AI Logo" className="saas-logo-cap-img" />
          </div>
          <span className="saas-logo-text">EduGen<span className="logo-highlight">AI</span></span>
        </Link>

        {/* Navigation Links */}
        <nav className={`saas-nav-links ${mobileMenuOpen ? "active" : ""}`}>
          {!user ? (
            <>
              <Link 
                to="/" 
                className={isActive("/") ? "nav-link active" : "nav-link"}
                onClick={() => handleNavClick("/", null)}
              >
                Home
              </Link>
              <Link 
                to="/features" 
                className={isActive("/features") ? "nav-link active" : "nav-link"}
                onClick={() => handleNavClick("/features", "#features")}
              >
                Features
              </Link>
              <Link 
                to="/how-it-works" 
                className={isActive("/how-it-works") ? "nav-link active" : "nav-link"}
                onClick={() => handleNavClick("/how-it-works", "#how-it-works")}
              >
                How It Works
              </Link>
              <Link 
                to="/about" 
                className={isActive("/about") ? "nav-link active" : "nav-link"}
                onClick={() => handleNavClick("/about", "#about")}
              >
                About
              </Link>
              <Link 
                to="/contact" 
                className={isActive("/contact") ? "nav-link active" : "nav-link"}
                onClick={() => handleNavClick("/contact", "#contact")}
              >
                Contact
              </Link>
            </>
          ) : (
            <>
              <Link 
                to="/dashboard" 
                className={isActive("/dashboard") ? "nav-link active" : "nav-link"}
                onClick={() => setMobileMenuOpen(false)}
              >
                Dashboard
              </Link>
              <Link 
                to="/upload" 
                className={isActive("/upload") ? "nav-link active" : "nav-link"}
                onClick={() => setMobileMenuOpen(false)}
              >
                Upload
              </Link>
              <Link 
                to="/smart-notes" 
                className={isActive("/smart-notes") ? "nav-link active" : "nav-link"}
                onClick={() => setMobileMenuOpen(false)}
              >
                Smart Notes
              </Link>
              <Link 
                to="/flashcards" 
                className={isActive("/flashcards") ? "nav-link active" : "nav-link"}
                onClick={() => setMobileMenuOpen(false)}
              >
                Flashcards
              </Link>
              <Link 
                to="/quiz" 
                className={isActive("/quiz") ? "nav-link active" : "nav-link"}
                onClick={() => setMobileMenuOpen(false)}
              >
                AI Quiz
              </Link>
              <Link 
                to="/weak-topics" 
                className={isActive("/weak-topics") ? "nav-link active" : "nav-link"}
                onClick={() => setMobileMenuOpen(false)}
              >
                Weak Topics
              </Link>
            </>
          )}
        </nav>

        {/* Action Buttons / Profile */}
        <div className="saas-nav-actions">
          {!user ? (
            <>
              <Link to="/login" className="saas-btn-text">
                Log In
              </Link>
              <Link to="/register" className="saas-btn-primary">
                Get Started →
              </Link>
            </>
          ) : (
            <div className="user-profile-menu">
              <div className="user-avatar-pill">
                <span className="user-avatar-circle">
                  {user.name ? user.name.charAt(0).toUpperCase() : "U"}
                </span>
                <span className="user-name-label">{user.name || "Student"}</span>
              </div>
              <button onClick={handleLogout} className="saas-logout-btn" title="Log out">
                Logout
              </button>
            </div>
          )}

          {/* Mobile Menu Toggle */}
          <button 
            className="mobile-menu-btn" 
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle Navigation"
          >
            {mobileMenuOpen ? "✕" : "☰"}
          </button>
        </div>

      </div>
    </header>
  );
}

export default Navbar;