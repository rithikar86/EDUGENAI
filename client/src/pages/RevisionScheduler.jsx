import Navbar from "../components/Navbar";
import PracticeSection from "../components/PracticeSection";
import "../styles/RevisionScheduler.css";

function RevisionScheduler() {
  return (
    <div className="rs-page-wrapper">
      <Navbar />

      <main className="rs-container saas-container">
        <PracticeSection returnPath="/revision-scheduler" embedded={false} />
      </main>
    </div>
  );
}

export default RevisionScheduler;
