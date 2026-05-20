import Database from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/core';
import type { Note } from './types';

let db: Database | null = null;

async function getDb(): Promise<Database> {
  if (!db) {
    db = await Database.load('sqlite:notes.db');
  }
  return db;
}

export async function getAllNotes(): Promise<Note[]> {
  const conn = await getDb();
  return conn.select<Note[]>('SELECT id, title, body, created_at, updated_at, sort_order, collapsed_headings, parent_id, is_expanded FROM notes ORDER BY sort_order ASC, created_at ASC');
}

export async function createNote(note: Note): Promise<void> {
  console.log('[db] createNote START', note.id, note.title);
  const conn = await getDb();
  let rows: { max_order: number | null }[];
  try {
    rows = await conn.select<{ max_order: number | null }[]>(
      'SELECT MAX(sort_order) as max_order FROM notes'
    );
    console.log('[db] MAX(sort_order) result', rows);
  } catch (err) {
    console.error('[db] SELECT MAX(sort_order) FAILED', err);
    throw err;
  }
  const nextOrder = (rows[0]?.max_order ?? -1) + 1;
  console.log('[db] nextOrder', nextOrder);
  try {
    await conn.execute(
      'INSERT INTO notes (id, title, body, sort_order, created_at, updated_at, parent_id, is_expanded) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
      [note.id, note.title, note.body, nextOrder, note.created_at, note.updated_at, note.parent_id ?? null]
    );
    console.log('[db] INSERT succeeded for', note.id);
  } catch (err) {
    console.error('[db] INSERT FAILED', err);
    throw err;
  }
}

export async function updateNote(id: string, title: string, body: string): Promise<void> {
  const conn = await getDb();
  const updatedAt = new Date().toISOString();
  await conn.execute(
    'UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE id = ?',
    [title, body, updatedAt, id]
  );
}

export async function deleteNote(id: string): Promise<void> {
  const conn = await getDb();
  await conn.execute('DELETE FROM notes WHERE id = ?', [id]);
}

export async function updateCollapsedHeadings(id: string, json: string): Promise<void> {
  const conn = await getDb();
  await conn.execute(
    'UPDATE notes SET collapsed_headings = ? WHERE id = ?',
    [json, id]
  );
}

export async function updateNoteExpanded(id: string, isExpanded: boolean): Promise<void> {
  await invoke('update_note_expanded', { id, isExpanded });
}

export async function reorderNotes(orderedIds: string[]): Promise<void> {
  const conn = await getDb();
  for (let i = 0; i < orderedIds.length; i++) {
    await conn.execute('UPDATE notes SET sort_order = ? WHERE id = ?', [i, orderedIds[i]]);
  }
}

export async function nestNote(id: string, parentId: string): Promise<void> {
  const conn = await getDb();
  const rows = await conn.select<{ max_order: number | null }[]>(
    'SELECT MAX(sort_order) as max_order FROM notes WHERE parent_id = ?',
    [parentId]
  );
  const nextOrder = (rows[0]?.max_order ?? -1) + 1;
  await conn.execute(
    'UPDATE notes SET parent_id = ?, sort_order = ? WHERE id = ?',
    [parentId, nextOrder, id]
  );
}

export async function unnestNote(id: string): Promise<void> {
  const conn = await getDb();
  await conn.execute('UPDATE notes SET parent_id = NULL WHERE id = ?', [id]);
}

export async function saveSetting(key: string, value: string): Promise<void> {
  console.log('[db] saveSetting', key, '=', value);
  const conn = await getDb();
  await conn.execute(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value]
  );
}

export async function getSetting(key: string): Promise<string | null> {
  const conn = await getDb();
  const rows = await conn.select<{ value: string }[]>(
    'SELECT value FROM settings WHERE key = ?',
    [key]
  );
  return rows[0]?.value ?? null;
}
