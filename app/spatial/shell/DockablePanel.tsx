/**
 * app/spatial/shell/DockablePanel.tsx
 *
 * Standardized Unified Dockable Panel Shell.
 *
 * Provides consistent operational header:
 * [ICON] PANEL NAME  [BADGE]            [ACTIONS] [MINIMIZE] [CLOSE]
 *
 * Closing hides the panel presentation without destroying internal domain state.
 */

'use client';
import React, { useState } from 'react';
import { Minus, X, Maximize2 } from 'lucide-react';
import { cyberAudio } from '../../cyber-audio';

export interface DockablePanelProps {
  id: string;
  title: string;
  icon: React.ReactNode;
  badge?: React.ReactNode;
  isOpen: boolean;
  defaultMinimized?: boolean;
  onClose: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  maxHeight?: string | number;
}

export function DockablePanel({
  id,
  title,
  icon,
  badge,
  isOpen,
  defaultMinimized = false,
  onClose,
  actions,
  children,
  className = '',
  maxHeight,
}: DockablePanelProps) {
  const [minimized, setMinimized] = useState(defaultMinimized);

  if (!isOpen) return null;

  return (
    <section
      id={`panel-${id}`}
      className={`dockable-panel ${minimized ? 'is-minimized' : ''} ${className}`}
      aria-label={title}
    >
      <header className="dockable-panel-header">
        <div className="dockable-header-left">
          <span className="dockable-panel-icon">{icon}</span>
          <h3 className="dockable-panel-title">{title}</h3>
          {badge && <span className="dockable-panel-badge">{badge}</span>}
        </div>

        <div className="dockable-header-right">
          {actions}
          <button
            className="dockable-ctrl-btn"
            onClick={() => {
              cyberAudio.playClick();
              setMinimized((prev) => !prev);
            }}
            title={minimized ? 'Expand Panel' : 'Minimize Panel'}
            aria-label={minimized ? 'Expand Panel' : 'Minimize Panel'}
          >
            {minimized ? <Maximize2 size={11} /> : <Minus size={11} />}
          </button>
          <button
            className="dockable-ctrl-btn close-btn"
            onClick={() => {
              cyberAudio.playClick();
              onClose();
            }}
            title="Close Panel (Reopen from Dock)"
            aria-label="Close Panel"
          >
            <X size={12} />
          </button>
        </div>
      </header>

      {!minimized && (
        <div className="dockable-panel-content" style={maxHeight ? { maxHeight } : undefined}>
          {children}
        </div>
      )}
    </section>
  );
}
