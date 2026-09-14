import { useEffect, useState } from "react";
import { FileText, Pause, Play, Square, Trash2 } from "lucide-react";
import { timecode } from "./timeline";

type Status = { elapsed: number; paused: boolean; notes?: string };

/** Floating bar shown while recording. It is excluded from the capture. */
export function RecordingBar({ marker }: { marker: boolean }) {
  const [status, setStatus] = useState<Status>({ elapsed: 0, paused: false });
  const [notes, setNotes] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  useEffect(
    () =>
      window.studioBar?.onStatus((next) => {
        setStatus((old) => ({ ...old, ...next }));
        if (typeof next.notes === "string") setNotes(next.notes);
      }),
    [],
  );
  const command = (name: "pause" | "resume" | "stop" | "discard") =>
    void window.studioBar?.command(name);
  const toggleNotes = () => {
    const next = !expanded;
    setExpanded(next);
    void window.studioBar?.setExpanded(next);
  };
  return (
    <div className={`rec-bar ${marker ? "test-marker" : ""}`}>
      {expanded && (
        <div className="rec-notes" aria-label="Speaker notes">
          {notes.trim() ? notes : "No notes for this take."}
        </div>
      )}
      <div className="rec-row">
        <span className="rec-grip" aria-hidden="true" />
        <span className={`recording-dot ${status.paused ? "paused" : ""}`} />
        <div className="rec-time">
          <strong>{status.paused ? "Paused" : "Recording"}</strong>
          <span>{timecode(status.elapsed)}</span>
        </div>
        <button
          className="rec-icon"
          aria-label={status.paused ? "Resume recording" : "Pause recording"}
          title={status.paused ? "Resume" : "Pause"}
          onClick={() => command(status.paused ? "resume" : "pause")}
        >
          {status.paused ? <Play size={18} /> : <Pause size={18} />}
        </button>
        <button
          className="rec-icon"
          aria-label="Speaker notes"
          aria-pressed={expanded}
          title="Speaker notes"
          onClick={toggleNotes}
        >
          <FileText size={18} />
        </button>
        {confirmDiscard ? (
          <button
            className="rec-discard confirm"
            onClick={() => command("discard")}
            onMouseLeave={() => setConfirmDiscard(false)}
          >
            Discard take?
          </button>
        ) : (
          <button
            className="rec-icon"
            aria-label="Discard recording"
            title="Discard this take"
            onClick={() => setConfirmDiscard(true)}
          >
            <Trash2 size={18} />
          </button>
        )}
        <button className="rec-finish" onClick={() => command("stop")}>
          <Square size={13} fill="currentColor" />
          Finish
        </button>
      </div>
    </div>
  );
}

/** 3-2-1 overlay before recording starts. Also excluded from the capture. */
export function Countdown({ seconds }: { seconds: number }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    const started = performance.now();
    const timer = setInterval(() => {
      const next = seconds - Math.floor((performance.now() - started) / 1000);
      setLeft(Math.max(1, next));
    }, 50);
    return () => clearInterval(timer);
  }, [seconds]);
  return (
    <div className="countdown" role="timer" aria-live="assertive">
      <span key={left}>{left}</span>
    </div>
  );
}
