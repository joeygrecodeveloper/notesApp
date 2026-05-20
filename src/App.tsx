import { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { Editor } from './components/Editor';
import { getAllNotes, createNote, updateNote, deleteNote, reorderNotes, nestNote, unnestNote, updateNoteExpanded, saveSetting, getSetting } from './db';
import type { Note } from './types';
import './App.css';

function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [autoFocusId, setAutoFocusId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getAllNotes(), getSetting('last_active_note_id').catch(() => null)])
      .then(([loadedNotes, lastId]) => {
        console.log('[App] getAllNotes:', loadedNotes.length, 'notes', loadedNotes.map(n => n.title));
        console.log('[App] last_active_note_id:', lastId);

        let notesToSet = loadedNotes;
        let restoredId: string | null = null;

        if (lastId) {
          const target = loadedNotes.find(n => n.id === lastId);
          console.log('[App] restore target found:', !!target, target?.title ?? '(none)');
          if (target) {
            if (target.parent_id !== null) {
              notesToSet = loadedNotes.map(n =>
                n.id === target.parent_id ? { ...n, is_expanded: true } : n
              );
            }
            restoredId = lastId;
          }
        }

        // Set notes before active ID so the note exists in the array when activeNote is computed
        setNotes(notesToSet);
        if (restoredId !== null) {
          console.log('[App] calling setActiveNoteId with:', restoredId);
          setActiveNoteId(restoredId);
        }
      })
      .catch(err => console.error('Failed to load notes:', err));
  }, []);

  useEffect(() => {
    if (activeNoteId === null) return;
    saveSetting('last_active_note_id', activeNoteId)
      .catch(err => console.error('Failed to save last active note:', err));
  }, [activeNoteId]);

  const activeNote = notes.find(n => n.id === activeNoteId) ?? null;

  const handleCreateNote = async (title: string) => {
    console.log('[App] handleCreateNote START', title);
    const now = new Date().toISOString();
    const note: Note = {
      id: crypto.randomUUID(),
      title,
      body: '',
      created_at: now,
      updated_at: now,
      parent_id: null,
      is_expanded: true,
    };
    try {
      await createNote(note);
    } catch (err) {
      console.error(`[App] createNote THREW — note will not appear:`, err);
      return;
    }
    console.log('[App] createNote succeeded, calling setNotes');
    setNotes(prev => {
      const next = [...prev, note];
      console.log('[App] setNotes updater — new list:', next.map(n => n.title));
      return next;
    });
    setActiveNoteId(note.id);
    setAutoFocusId(note.id);
  };

  const handleCreateChildNote = async (title: string, parentId: string) => {
    const now = new Date().toISOString();
    const note: Note = {
      id: crypto.randomUUID(),
      title,
      body: '',
      created_at: now,
      updated_at: now,
      parent_id: parentId,
      is_expanded: true,
    };
    try {
      await createNote(note);
    } catch (err) {
      console.error('Failed to create child note:', err);
      return;
    }
    setNotes(prev => [...prev, note]);
    setActiveNoteId(note.id);
    setAutoFocusId(note.id);
  };

  const handleDeleteNote = async (id: string) => {
    const children = notes.filter(n => n.parent_id === id);

    if (children.length === 0) {
      try {
        await deleteNote(id);
      } catch (err) {
        console.error(`Failed to delete note (id=${id}):`, err);
        return;
      }
      setNotes(prev => prev.filter(n => n.id !== id));
      if (activeNoteId === id) setActiveNoteId(null);
      return;
    }

    // Parent deletion: promote children to root at the parent's position.
    // Build the new visual order by walking roots in their current array order
    // and replacing the deleted parent with its children (as roots).
    const childrenByParent = new Map<string, Note[]>();
    const roots: Note[] = [];
    for (const note of notes) {
      if (note.parent_id === null) {
        roots.push(note);
      } else if (note.parent_id !== id) {
        const arr = childrenByParent.get(note.parent_id) ?? [];
        arr.push(note);
        childrenByParent.set(note.parent_id, arr);
      }
    }

    const newOrder: Note[] = [];
    for (const root of roots) {
      if (root.id === id) {
        for (const child of children) {
          newOrder.push({ ...child, parent_id: null });
        }
      } else {
        newOrder.push(root);
        for (const child of (childrenByParent.get(root.id) ?? [])) {
          newOrder.push(child);
        }
      }
    }

    const orderedIds = newOrder.map(n => n.id);
    try {
      for (const child of children) await unnestNote(child.id);
      await reorderNotes(orderedIds);
      await deleteNote(id);
    } catch (err) {
      console.error(`Failed to delete parent note (id=${id}):`, err);
      return;
    }

    setNotes(newOrder);
    if (activeNoteId === id) setActiveNoteId(null);
  };

  const handleTitleChange = (id: string, title: string) => {
    setNotes(prev => prev.map(n => n.id === id ? { ...n, title } : n));
  };

  const handleSaveNote = useCallback(async (id: string, title: string, body: string) => {
    try {
      await updateNote(id, title, body);
    } catch (err) {
      console.error(`Failed to save note (id=${id}, title="${title}"):`, err);
      return;
    }
    setNotes(prev =>
      prev.map(n => n.id === id ? { ...n, title, body, updated_at: new Date().toISOString() } : n)
    );
  }, []);

  const handleReorderNotes = useCallback((orderedIds: string[]) => {
    setNotes(prev => {
      const lookup = new Map(prev.map(n => [n.id, n]));
      const reordered = orderedIds.map(id => lookup.get(id)).filter((n): n is Note => n != null);
      const inOrder = new Set(orderedIds);
      const extras = prev.filter(n => !inOrder.has(n.id));
      return [...reordered, ...extras];
    });
    reorderNotes(orderedIds).catch(err => console.error('Failed to reorder notes:', err));
  }, []);

  const handleCollapsedHeadingsChange = (id: string, json: string) => {
    setNotes(prev => prev.map(n => n.id === id ? { ...n, collapsed_headings: json } : n));
  };

  const handleNestNote = async (draggedId: string, targetId: string) => {
    const wasParent = notes.some(n => n.parent_id === targetId);
    try {
      await nestNote(draggedId, targetId);
      if (!wasParent) await updateNoteExpanded(targetId, true);
    } catch (err) {
      console.error('Failed to nest note:', err);
      return;
    }
    setNotes(prev => prev.map(n => {
      if (n.id === draggedId) return { ...n, parent_id: targetId };
      if (n.id === targetId && !wasParent) return { ...n, is_expanded: true };
      return n;
    }));
  };

  const handleUnnestAndReorder = async (draggedId: string, orderedIds: string[]) => {
    try {
      await unnestNote(draggedId);
      await reorderNotes(orderedIds);
    } catch (err) {
      console.error('Failed to unnest note:', err);
      return;
    }
    setNotes(prev => {
      const withParentCleared = prev.map(n => n.id === draggedId ? { ...n, parent_id: null } : n);
      const lookup = new Map(withParentCleared.map(n => [n.id, n]));
      const reordered = orderedIds.map(id => lookup.get(id)).filter((n): n is Note => n != null);
      const inOrder = new Set(orderedIds);
      const extras = withParentCleared.filter(n => !inOrder.has(n.id));
      return [...reordered, ...extras];
    });
  };

  const handleRenameNote = async (id: string, title: string) => {
    const note = notes.find(n => n.id === id);
    if (!note) return;
    try {
      await updateNote(id, title, note.body);
    } catch (err) {
      console.error(`Failed to rename note (id=${id}) to "${title}":`, err);
      return;
    }
    setNotes(prev => prev.map(n => n.id === id ? { ...n, title } : n));
  };

  return (
    <div className="app">
      <div className="titlebar-drag-region" data-tauri-drag-region />
      <Sidebar
        notes={notes}
        activeNoteId={activeNoteId}
        onSelectNote={(id) => { setAutoFocusId(null); setActiveNoteId(id); }}
        onDeleteNote={handleDeleteNote}
        onCreateNote={handleCreateNote}
        onCreateChildNote={handleCreateChildNote}
        onRenameNote={handleRenameNote}
        onReorderNotes={handleReorderNotes}
        onNestNote={handleNestNote}
        onUnnestAndReorder={handleUnnestAndReorder}
      />
      <main className="editor-area">
        {activeNote ? (
          <Editor
            key={activeNote.id}
            note={activeNote}
            autoFocus={activeNote.id === autoFocusId}
            onTitleChange={handleTitleChange}
            onSave={handleSaveNote}
            onCollapsedHeadingsChange={handleCollapsedHeadingsChange}
          />
        ) : (
          <div className="empty-canvas" />
        )}
      </main>
    </div>
  );
}

export default App;
