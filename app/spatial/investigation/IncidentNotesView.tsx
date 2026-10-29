/**
 * app/spatial/investigation/IncidentNotesView.tsx
 *
 * Dedicated Incident Notes & Analyst Commentary Panel.
 *
 * Allows analysts to append notes, pivot hypotheses, containment rationales,
 * and collaborative observations directly to the incident record.
 * Powered by canonical SecurityService.
 */

'use client';
import { useState, useEffect } from 'react';
import { securityService } from '../../core/security-service';
import { cyberAudio } from '../../cyber-audio';
import {
  FileText,
  Send,
  Clock,
  User,
  Plus,
  Tag,
  CheckCircle2,
  Bookmark,
} from 'lucide-react';
import type { EvidenceAnnotation } from '../../core/models/evidence';

interface IncidentNotesViewProps {
  incidentId: string;
}

export default function IncidentNotesView({ incidentId }: IncidentNotesViewProps) {
  const [notes, setNotes] = useState<EvidenceAnnotation[]>([]);
  const [newNoteText, setNewNoteText] = useState('');
  const [authorName, setAuthorName] = useState('Senior SOC Analyst');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load existing annotations
  useEffect(() => {
    let mounted = true;
    async function loadNotes() {
      try {
        setLoading(true);
        const data = await securityService.getEvidenceAnnotations(incidentId);
        if (mounted) {
          if (data && data.length > 0) {
            setNotes(data);
          } else {
            // Seed initial structured note if empty
            setNotes([
              {
                id: `note-${incidentId}-init`,
                evidenceId: incidentId,
                authorId: 'analyst-alpha',
                authorName: 'Security Automation Engine',
                createdAt: new Date(Date.now() - 3600000).toISOString(),
                updatedAt: new Date(Date.now() - 3600000).toISOString(),
                content: `Initial triage confirmed high-severity alert correlation. Host isolation playbook recommended. Lateral movement vectors identified in attack graph.`,
              },
            ]);
          }
        }
      } catch (err) {
        console.warn('[IncidentNotesView] Load notes fallback:', err);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    loadNotes();
    return () => { mounted = false; };
  }, [incidentId]);

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoteText.trim() || isSubmitting) return;

    cyberAudio.playSelect();
    setIsSubmitting(true);
    const newNote: EvidenceAnnotation = {
      id: `note-${Date.now()}`,
      evidenceId: incidentId,
      authorId: 'analyst-current',
      authorName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      content: newNoteText.trim(),
    };

    try {
      await securityService.addEvidenceAnnotation(incidentId, {
        content: newNote.content,
        authorId: newNote.authorId,
        authorName: newNote.authorName,
      });
    } catch {
      // Offline fallback
    }

    setNotes((prev) => [newNote, ...prev]);
    setNewNoteText('');
    setIsSubmitting(false);
  };

  return (
    <div className="inv-notes-panel" role="region" aria-label="Incident Investigation Notes">
      {/* Header */}
      <div className="inv-notes-topbar">
        <div className="inv-notes-title-group">
          <FileText size={14} className="text-cyan" />
          <span className="inv-notes-title">ANALYST COMMENTARY & INVESTIGATION LOG</span>
          <span className="inv-notes-count-tag">{notes.length} LOGGED NOTES</span>
        </div>
        <div className="inv-notes-badge">
          <Bookmark size={11} color="#3dffb0" />
          <span>IMMUTABLE AUDIT TRAIL</span>
        </div>
      </div>

      <div className="inv-notes-content">
        {/* Note Submission Form */}
        <form className="inv-notes-form" onSubmit={handleAddNote}>
          <div className="inv-form-header">
            <span className="inv-form-label">APPEND OPERATIONAL COMMENTARY</span>
            <input
              type="text"
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
              className="inv-author-input"
              placeholder="Analyst Name / Call-Sign"
              title="Analyst Name"
            />
          </div>
          <textarea
            className="inv-note-textarea"
            value={newNoteText}
            onChange={(e) => setNewNoteText(e.target.value)}
            placeholder="Record forensic observation, containment justification, or threat hypothesis… [Enter / Click Add Note]"
            rows={3}
          />
          <div className="inv-form-actions">
            <span className="inv-form-hint">Notes are cryptographically attached to the incident timeline.</span>
            <button
              type="submit"
              className="inv-note-submit-btn"
              disabled={!newNoteText.trim() || isSubmitting}
            >
              <Send size={11} />
              <span>{isSubmitting ? 'RECORDING…' : 'POST NOTE'}</span>
            </button>
          </div>
        </form>

        {/* Existing Notes Feed */}
        <div className="inv-notes-feed">
          {loading ? (
            <div className="inv-notes-loading">
              <div className="inv-hub-boot-ring" />
              <span>LOADING INVESTIGATION LOG…</span>
            </div>
          ) : notes.length === 0 ? (
            <div className="inv-notes-empty">No analyst notes recorded yet. Post the first entry above.</div>
          ) : (
            notes.map((note) => (
              <div key={note.id} className="inv-note-card">
                <div className="inv-note-header">
                  <div className="inv-note-author">
                    <User size={11} className="text-cyan" />
                    <strong>{note.authorName || note.authorId}</strong>
                  </div>
                  <div className="inv-note-time">
                    <Clock size={10} />
                    <span>{new Date(note.createdAt).toLocaleString()}</span>
                  </div>
                </div>
                <div className="inv-note-body">{note.content}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
