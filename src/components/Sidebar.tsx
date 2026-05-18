import { useState, useRef, useEffect } from 'react';
import type { Note } from '../types';

interface SidebarProps {
  notes: Note[];
  activeNoteId: string | null;
  onSelectNote: (id: string) => void;
  onDeleteNote: (id: string) => void;
  onCreateNote: (title: string) => void;
  onRenameNote: (id: string, title: string) => void;
  onReorderNotes: (orderedIds: string[]) => void;
}

function computeDropIndex(clientY: number, listEl: HTMLElement): number {
  const items = Array.from(listEl.querySelectorAll<HTMLElement>('.note-item:not(.creating)'));
  for (let i = 0; i < items.length; i++) {
    const rect = items[i].getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return i;
  }
  return items.length;
}

export function Sidebar({
  notes,
  activeNoteId,
  onSelectNote,
  onDeleteNote,
  onCreateNote,
  onRenameNote,
  onReorderNotes,
}: SidebarProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [nearDeleteId, setNearDeleteId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const newInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Refs keep event listener callbacks free of stale closures
  const notesRef = useRef<Note[]>(notes);
  const onReorderRef = useRef(onReorderNotes);
  const mouseDownIdRef = useRef<string | null>(null);
  const mouseDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);
  const draggingIdRef = useRef<string | null>(null);
  const dropIndexRef = useRef<number | null>(null);
  const wasDragRef = useRef(false);

  useEffect(() => { notesRef.current = notes; }, [notes]);
  useEffect(() => { onReorderRef.current = onReorderNotes; }, [onReorderNotes]);
  useEffect(() => () => clearTimeout(confirmTimerRef.current), []);

  useEffect(() => {
    if (isCreating) newInputRef.current?.focus();
  }, [isCreating]);

  useEffect(() => {
    if (renamingId) {
      const input = renameInputRef.current;
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }
  }, [renamingId]);

  // Global mouse listeners — mounted once, use refs for all live values
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!mouseDownIdRef.current || !listRef.current) return;

      const { x, y } = mouseDownPosRef.current!;
      const dist = Math.abs(e.clientX - x) + Math.abs(e.clientY - y);
      if (!isDraggingRef.current && dist < 4) return;

      if (!isDraggingRef.current) {
        isDraggingRef.current = true;
        draggingIdRef.current = mouseDownIdRef.current;
        setDraggingId(mouseDownIdRef.current);
      }

      const idx = computeDropIndex(e.clientY, listRef.current);
      if (idx !== dropIndexRef.current) {
        dropIndexRef.current = idx;
        setDropIndex(idx);
      }
    };

    const handleMouseUp = () => {
      document.body.classList.remove('dragging-note');
      listRef.current?.classList.remove('no-select');

      if (isDraggingRef.current) {
        wasDragRef.current = true;
        const id = draggingIdRef.current!;
        const idx = dropIndexRef.current;

        if (idx !== null) {
          const currentNotes = notesRef.current;
          const from = currentNotes.findIndex(n => n.id === id);
          if (from !== -1) {
            const to = idx > from ? idx - 1 : idx;
            if (to !== from) {
              const reordered = [...currentNotes];
              const [removed] = reordered.splice(from, 1);
              reordered.splice(to, 0, removed);
              onReorderRef.current(reordered.map(n => n.id));
            }
          }
        }
      }

      mouseDownIdRef.current = null;
      mouseDownPosRef.current = null;
      isDraggingRef.current = false;
      draggingIdRef.current = null;
      dropIndexRef.current = null;
      setDraggingId(null);
      setDropIndex(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const clearConfirm = () => {
    clearTimeout(confirmTimerRef.current);
    setConfirmDeleteId(null);
  };

  const handleDeleteClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    clearTimeout(confirmTimerRef.current);
    setConfirmDeleteId(id);
    confirmTimerRef.current = setTimeout(() => setConfirmDeleteId(null), 5000);
  };

  const handleConfirmDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    clearConfirm();
    onDeleteNote(id);
  };

  useEffect(() => {
    if (!confirmDeleteId) return;
    const handle = (e: MouseEvent) => {
      const row = listRef.current?.querySelector(`[data-note-id="${confirmDeleteId}"]`);
      if (row && !row.contains(e.target as Node)) clearConfirm();
    };
    document.addEventListener('click', handle, true);
    return () => document.removeEventListener('click', handle, true);
  }, [confirmDeleteId]);

  const startCreating = () => { setIsCreating(true); setNewTitle(''); };

  const commitNewNote = () => {
    if (newTitle.trim()) onCreateNote(newTitle.trim());
    setIsCreating(false);
    setNewTitle('');
  };

  const handleNewKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); commitNewNote(); }
    else if (e.key === 'Escape') { setIsCreating(false); setNewTitle(''); }
  };

  const startRenaming = (id: string, title: string) => { clearConfirm(); setRenamingId(id); setRenameValue(title); };

  const commitRename = () => {
    if (renamingId) onRenameNote(renamingId, renameValue.trim() || 'Untitled');
    setRenamingId(null);
    setRenameValue('');
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
    else if (e.key === 'Escape') { setRenamingId(null); setRenameValue(''); }
  };

  const handleNoteMouseMove = (e: React.MouseEvent<HTMLDivElement>, id: string) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setNearDeleteId(rect.right - e.clientX <= 50 ? id : null);
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        notesApp{import.meta.env.DEV && <span className="dev-badge"> - dev</span>}
      </div>
      <div className="sidebar-list" ref={listRef}>
        {notes.map((note, index) => (
          <div key={note.id}>
            <div className={`drop-indicator${dropIndex === index ? ' active' : ''}`} />
            <div
              data-note-id={note.id}
              className={`note-item${note.id === activeNoteId ? ' active' : ''}${draggingId === note.id ? ' dragging' : ''}${confirmDeleteId === note.id ? ' confirm-delete' : ''}`}
              onMouseDown={e => {
                if (e.button !== 0 || renamingId === note.id) return;
                mouseDownIdRef.current = note.id;
                mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
                document.body.classList.add('dragging-note');
                listRef.current?.classList.add('no-select');
              }}
              onClick={() => {
                if (wasDragRef.current) { wasDragRef.current = false; return; }
                if (renamingId !== note.id) onSelectNote(note.id);
              }}
              onDoubleClick={e => {
                if (wasDragRef.current) { wasDragRef.current = false; return; }
                e.preventDefault();
                startRenaming(note.id, note.title);
              }}
              onMouseMove={e => handleNoteMouseMove(e, note.id)}
              onMouseLeave={() => setNearDeleteId(null)}
            >
              {renamingId === note.id ? (
                <input
                  ref={renameInputRef}
                  className="rename-input"
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onKeyDown={handleRenameKeyDown}
                  onBlur={commitRename}
                  onClick={e => e.stopPropagation()}
                />
              ) : (
                <>
                  <span className="note-title">{note.title || 'Untitled'}</span>
                  <button
                    className={`delete-btn${nearDeleteId === note.id || confirmDeleteId === note.id ? ' visible' : ''}${confirmDeleteId === note.id ? ' confirming' : ''}`}
                    onClick={e => confirmDeleteId === note.id ? handleConfirmDelete(e, note.id) : handleDeleteClick(e, note.id)}
                  >
                    <span className="delete-btn-x">×</span>
                    <span className="delete-btn-text">delete</span>
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
        <div className={`drop-indicator${dropIndex === notes.length ? ' active' : ''}`} />

        {isCreating && (
          <div className="note-item creating">
            <input
              ref={newInputRef}
              className="new-note-input"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={handleNewKeyDown}
              onBlur={commitNewNote}
            />
          </div>
        )}
      </div>

      <button className="add-btn" onClick={startCreating} title="New note">+</button>
    </aside>
  );
}
