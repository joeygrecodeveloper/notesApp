import { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { Editor } from './components/Editor';
import { getAllNotes, createNote, updateNote, deleteNote, reorderNotes } from './db';
import type { Note } from './types';
import './App.css';

function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [autoFocusId, setAutoFocusId] = useState<string | null>(null);

  useEffect(() => {
    getAllNotes()
      .then(setNotes)
      .catch(err => console.error('Failed to load notes:', err));
  }, []);

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

  const handleDeleteNote = async (id: string) => {
    try {
      await deleteNote(id);
    } catch (err) {
      console.error(`Failed to delete note (id=${id}):`, err);
      return;
    }
    setNotes(prev => prev.filter(n => n.id !== id));
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
      <Sidebar
        notes={notes}
        activeNoteId={activeNoteId}
        onSelectNote={(id) => { setAutoFocusId(null); setActiveNoteId(id); }}
        onDeleteNote={handleDeleteNote}
        onCreateNote={handleCreateNote}
        onRenameNote={handleRenameNote}
        onReorderNotes={handleReorderNotes}
      />
      <main className="editor-area">
        {activeNote ? (
          <Editor
            key={activeNote.id}
            note={activeNote}
            autoFocus={activeNote.id === autoFocusId}
            onTitleChange={handleTitleChange}
            onSave={handleSaveNote}
          />
        ) : (
          <div className="empty-canvas" />
        )}
      </main>
    </div>
  );
}

export default App;
