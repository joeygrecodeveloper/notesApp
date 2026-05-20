import { useState, useRef, useEffect, useMemo, Fragment } from 'react';
import { createPortal } from 'react-dom';
import type { Note } from '../types';
import { updateNoteExpanded } from '../db';

interface SidebarProps {
  notes: Note[];
  activeNoteId: string | null;
  onSelectNote: (id: string) => void;
  onDeleteNote: (id: string) => void;
  onCreateNote: (title: string) => void;
  onCreateChildNote: (title: string, parentId: string) => void;
  onRenameNote: (id: string, title: string) => void;
  onReorderNotes: (orderedIds: string[]) => void;
  onNestNote: (draggedId: string, targetId: string) => void;
  onUnnestAndReorder: (draggedId: string, orderedIds: string[]) => void;
}

interface FlatItem {
  note: Note;
  isChild: boolean;
  hasChildren: boolean;
}

interface ContextMenuState {
  noteId: string;
  x: number;
  y: number;
}

const GAP_EDGE_PX = 8;

function computeRestrictedDropIndex(
  clientY: number,
  validItems: HTMLElement[],
  flatList: FlatItem[]
): number {
  for (let i = 0; i < validItems.length; i++) {
    const rect = validItems[i].getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) {
      const id = validItems[i].dataset.noteId;
      const idx = flatList.findIndex(item => item.note.id === id);
      return idx !== -1 ? idx : 0;
    }
  }
  if (validItems.length === 0) return 0;
  const lastId = validItems[validItems.length - 1].dataset.noteId;
  const lastIdx = flatList.findIndex(item => item.note.id === lastId);
  if (lastIdx === -1) return flatList.length;
  // Scan forward past any children that visually belong to this group
  let groupEnd = lastIdx;
  while (groupEnd + 1 < flatList.length && flatList[groupEnd + 1].isChild) groupEnd++;
  return groupEnd + 1;
}

function performRootReorder(
  draggedId: string,
  dropFlatIdx: number,
  notes: Note[],
  flatList: FlatItem[],
  onReorder: (ids: string[]) => void
): void {
  const childrenByParent = new Map<string, Note[]>();
  for (const n of notes) {
    if (n.parent_id !== null) {
      const arr = childrenByParent.get(n.parent_id) ?? [];
      arr.push(n);
      childrenByParent.set(n.parent_id, arr);
    }
  }
  const groups: Note[][] = [];
  for (const n of notes) {
    if (n.parent_id === null) {
      groups.push([n, ...(childrenByParent.get(n.id) ?? [])]);
    }
  }

  const sourceGroupIdx = groups.findIndex(g => g[0].id === draggedId);
  if (sourceGroupIdx === -1) return;

  let targetGroupIdx: number;
  if (dropFlatIdx >= flatList.length) {
    targetGroupIdx = groups.length;
  } else {
    const target = flatList[dropFlatIdx];
    if (!target || target.isChild) return;
    targetGroupIdx = groups.findIndex(g => g[0].id === target.note.id);
    if (targetGroupIdx === -1) return;
  }

  if (targetGroupIdx === sourceGroupIdx) return;

  const reordered: Note[][] = [];
  let inserted = false;
  for (let i = 0; i < groups.length; i++) {
    if (i === sourceGroupIdx) continue;
    if (i === targetGroupIdx) { reordered.push(groups[sourceGroupIdx]); inserted = true; }
    reordered.push(groups[i]);
  }
  if (!inserted) reordered.push(groups[sourceGroupIdx]);

  onReorder(reordered.flat().map(n => n.id));
}

function performSiblingReorder(
  draggedId: string,
  dropFlatIdx: number,
  parentId: string,
  notes: Note[],
  flatList: FlatItem[],
  onReorder: (ids: string[]) => void
): void {
  const siblings = notes.filter(n => n.parent_id === parentId);
  const fromIdx = siblings.findIndex(n => n.id === draggedId);
  if (fromIdx === -1) return;

  const parentFlatIdx = flatList.findIndex(item => item.note.id === parentId);
  if (parentFlatIdx === -1) return;

  const toSiblingIdx = Math.max(0, Math.min(siblings.length, dropFlatIdx - (parentFlatIdx + 1)));

  if (toSiblingIdx === fromIdx || toSiblingIdx === fromIdx + 1) return;

  const reordered = [...siblings];
  reordered.splice(fromIdx, 1);
  const actualTo = toSiblingIdx > fromIdx ? toSiblingIdx - 1 : toSiblingIdx;
  reordered.splice(actualTo, 0, siblings[fromIdx]);

  const siblingPositions: number[] = [];
  for (let i = 0; i < notes.length; i++) {
    if (notes[i].parent_id === parentId) siblingPositions.push(i);
  }
  const reorderedAll = [...notes];
  for (let i = 0; i < siblingPositions.length; i++) {
    reorderedAll[siblingPositions[i]] = reordered[i];
  }
  onReorder(reorderedAll.map(n => n.id));
}

function performUnnestAndInsert(
  draggedId: string,
  dropFlatIdx: number,
  notes: Note[],
  flatList: FlatItem[],
  onUnnest: (draggedId: string, orderedIds: string[]) => void
): void {
  const childrenByParent = new Map<string, Note[]>();
  const roots: Note[] = [];
  for (const n of notes) {
    if (n.id === draggedId) continue;
    if (n.parent_id === null) {
      roots.push(n);
    } else {
      const arr = childrenByParent.get(n.parent_id) ?? [];
      arr.push(n);
      childrenByParent.set(n.parent_id, arr);
    }
  }
  const groups: Note[][] = roots.map(r => [r, ...(childrenByParent.get(r.id) ?? [])]);

  let insertBeforeGroupIdx = groups.length;
  if (dropFlatIdx < flatList.length) {
    const targetNote = flatList[dropFlatIdx].note;
    const targetRootId = targetNote.parent_id === null ? targetNote.id : targetNote.parent_id;
    const groupIdx = groups.findIndex(g => g[0].id === targetRootId);
    if (groupIdx !== -1) insertBeforeGroupIdx = groupIdx;
  }

  const draggedNote = notes.find(n => n.id === draggedId);
  if (!draggedNote) return;

  const newGroups = [...groups];
  newGroups.splice(insertBeforeGroupIdx, 0, [draggedNote]);
  onUnnest(draggedId, newGroups.flat().map(n => n.id));
}

function isInParentChildGapZone(clientY: number, container: HTMLElement): boolean {
  const items = Array.from(container.querySelectorAll<HTMLElement>('.note-item:not(.creating)'));
  for (let i = 0; i + 1 < items.length; i++) {
    if (!items[i].classList.contains('child-note') && items[i + 1].classList.contains('child-note')) {
      const parentRect = items[i].getBoundingClientRect();
      const childRect = items[i + 1].getBoundingClientRect();
      if (clientY > parentRect.bottom - GAP_EDGE_PX && clientY < childRect.top + childRect.height / 2) {
        return true;
      }
    }
  }
  return false;
}

function FolderIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg width="14" height="12" viewBox="0 0 48 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M3.5 37.3923L8.74791 17.9573C9.21911 16.2122 10.802 15 12.6096 15H42.2768C44.9101 15 46.8249 17.5004 46.1385 20.0426L41.5 35.5C40.5 37.5 40.9599 38.4922 38.7664 38.4922H5.5C3.29086 38.4922 1.5 36.7014 1.5 34.4922V5.5C1.5 3.29086 3.29086 1.5 5.5 1.5H18.7412C20.0853 1.5 21.3396 2.1751 22.0799 3.29703L24.3272 6.70297C25.0675 7.82489 26.3218 8.5 27.6659 8.5H38.9877C41.2126 8.5 43.0099 10.3155 42.9875 12.5402V15.0622" stroke="var(--text-muted)" strokeWidth="3"/>
      </svg>
    );
  }
  return (
    <svg width="14" height="12" viewBox="0 0 45 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M1.5 34.4922V5.5C1.5 3.29086 3.29086 1.5 5.5 1.5H18.7412C20.0853 1.5 21.3396 2.1751 22.0799 3.29703L24.3272 6.70297C25.0675 7.82489 26.3218 8.5 27.6659 8.5H38.9877C41.2126 8.5 43.0099 10.3155 42.9875 12.5402L42.7662 34.5325C42.7441 36.7258 40.9599 38.4922 38.7664 38.4922H5.5C3.29086 38.4922 1.5 36.7014 1.5 34.4922Z" stroke="var(--text-muted)" strokeWidth="3"/>
    </svg>
  );
}

export function Sidebar({
  notes,
  activeNoteId,
  onSelectNote,
  onDeleteNote,
  onCreateNote,
  onCreateChildNote,
  onRenameNote,
  onReorderNotes,
  onNestNote,
  onUnnestAndReorder,
}: SidebarProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [nearDeleteId, setNearDeleteId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [nestTargetId, setNestTargetId] = useState<string | null>(null);
  const [expandedOverrides, setExpandedOverrides] = useState<Map<string, boolean>>(new Map());
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [childCreatingParentId, setChildCreatingParentId] = useState<string | null>(null);
  const [childNewTitle, setChildNewTitle] = useState('');

  const newInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const childInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const notesRef = useRef<Note[]>(notes);
  const onReorderRef = useRef(onReorderNotes);
  const onNestNoteRef = useRef(onNestNote);
  const onUnnestAndReorderRef = useRef(onUnnestAndReorder);
  const flatListRef = useRef<FlatItem[]>([]);
  const mouseDownIdRef = useRef<string | null>(null);
  const mouseDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);
  const draggingIdRef = useRef<string | null>(null);
  const draggingIsChildRef = useRef(false);
  const draggingHasChildrenRef = useRef(false);
  const draggingParentIdRef = useRef<string | null>(null);
  const dropIndexRef = useRef<number | null>(null);
  const nestTargetIdRef = useRef<string | null>(null);
  const dropIsRootLevelRef = useRef(false);
  const wasDragRef = useRef(false);

  useEffect(() => { notesRef.current = notes; }, [notes]);
  useEffect(() => { onReorderRef.current = onReorderNotes; }, [onReorderNotes]);
  useEffect(() => { onNestNoteRef.current = onNestNote; }, [onNestNote]);
  useEffect(() => { onUnnestAndReorderRef.current = onUnnestAndReorder; }, [onUnnestAndReorder]);
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

  useEffect(() => {
    if (childCreatingParentId) childInputRef.current?.focus();
  }, [childCreatingParentId]);

  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = () => setContextMenu(null);
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setContextMenu(null); };
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', dismiss);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!mouseDownIdRef.current || !listRef.current) return;

      const { x, y } = mouseDownPosRef.current!;
      const dist = Math.abs(e.clientX - x) + Math.abs(e.clientY - y);
      if (!isDraggingRef.current && dist < 4) return;

      if (!isDraggingRef.current) {
        isDraggingRef.current = true;
        draggingIdRef.current = mouseDownIdRef.current;
        const draggedNote = notesRef.current.find(n => n.id === mouseDownIdRef.current);
        draggingIsChildRef.current = draggedNote?.parent_id !== null && draggedNote?.parent_id !== undefined;
        draggingParentIdRef.current = draggedNote?.parent_id ?? null;
        draggingHasChildrenRef.current = notesRef.current.some(n => n.parent_id === mouseDownIdRef.current);
        setDraggingId(mouseDownIdRef.current);
      }

      const isChild = draggingIsChildRef.current;
      const hasChildren = draggingHasChildrenRef.current;
      const parentId = draggingParentIdRef.current;
      const currentFlatList = flatListRef.current;

      // Check if cursor is in the title area of a note (nest target zone)
      let nestTarget: string | null = null;
      if (!hasChildren) {
        const allItems = Array.from(listRef.current.querySelectorAll<HTMLElement>(
          '.note-item:not(.creating)'
        ));
        for (const item of allItems) {
          const rect = item.getBoundingClientRect();
          if (e.clientY > rect.top + GAP_EDGE_PX && e.clientY < rect.bottom - GAP_EDGE_PX) {
            const noteId = item.dataset.noteId!;
            const isItemChild = item.classList.contains('child-note');
            if (!isItemChild && noteId !== draggingIdRef.current) {
              nestTarget = noteId;
            }
            break;
          }
        }
      }

      if (nestTarget !== null) {
        if (nestTargetIdRef.current !== nestTarget) {
          nestTargetIdRef.current = nestTarget;
          setNestTargetId(nestTarget);
          dropIndexRef.current = null;
          setDropIndex(null);
        }
        return;
      }

      if (nestTargetIdRef.current !== null) {
        nestTargetIdRef.current = null;
        setNestTargetId(null);
      }

      let validItems: HTMLElement[];
      if (!isChild) {
        validItems = Array.from(listRef.current.querySelectorAll<HTMLElement>(
          '.note-item:not(.creating):not(.child-note)'
        ));
      } else {
        // Children can un-nest to root gaps or reorder among siblings
        validItems = Array.from(listRef.current.querySelectorAll<HTMLElement>(
          `.note-item:not(.creating):not(.child-note), .note-item:not(.creating)[data-parent-id="${parentId}"]`
        ));
      }

      const rawIdx = computeRestrictedDropIndex(e.clientY, validItems, currentFlatList);
      const idx = (!isChild && isInParentChildGapZone(e.clientY, listRef.current)) ? null : rawIdx;

      if (isChild) {
        let isRootLevel: boolean;
        if (rawIdx < currentFlatList.length) {
          isRootLevel = currentFlatList[rawIdx].note.parent_id === null;
        } else {
          // Cursor is past all valid items — determine by whether it is physically
          // below the last sibling element (past the group) or still within it
          let lastSibling: HTMLElement | null = null;
          for (let i = validItems.length - 1; i >= 0; i--) {
            if (validItems[i].classList.contains('child-note')) {
              lastSibling = validItems[i];
              break;
            }
          }
          if (lastSibling) {
            isRootLevel = e.clientY > lastSibling.getBoundingClientRect().bottom;
          } else {
            isRootLevel = true;
          }
        }
        dropIsRootLevelRef.current = isRootLevel;
      }

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

        if (nestTargetIdRef.current !== null) {
          onNestNoteRef.current(id, nestTargetIdRef.current);
        } else if (dropIndexRef.current !== null) {
          const idx = dropIndexRef.current;
          const currentNotes = notesRef.current;
          const currentFlatList = flatListRef.current;
          if (!draggingIsChildRef.current) {
            performRootReorder(id, idx, currentNotes, currentFlatList, onReorderRef.current);
          } else if (dropIsRootLevelRef.current) {
            performUnnestAndInsert(id, idx, currentNotes, currentFlatList, onUnnestAndReorderRef.current);
          } else if (draggingParentIdRef.current !== null) {
            performSiblingReorder(id, idx, draggingParentIdRef.current, currentNotes, currentFlatList, onReorderRef.current);
          }
        }
      }

      mouseDownIdRef.current = null;
      mouseDownPosRef.current = null;
      isDraggingRef.current = false;
      draggingIdRef.current = null;
      draggingIsChildRef.current = false;
      draggingHasChildrenRef.current = false;
      draggingParentIdRef.current = null;
      dropIndexRef.current = null;
      nestTargetIdRef.current = null;
      dropIsRootLevelRef.current = false;
      setDraggingId(null);
      setDropIndex(null);
      setNestTargetId(null);
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

  const isNoteExpanded = (note: Note): boolean =>
    expandedOverrides.has(note.id) ? expandedOverrides.get(note.id)! : note.is_expanded;

  const toggleExpanded = (id: string, current: boolean) => {
    const next = !current;
    setExpandedOverrides(prev => new Map(prev).set(id, next));
    updateNoteExpanded(id, next).catch(err => console.error('Failed to persist expanded state:', err));
  };

  const flatList = useMemo((): FlatItem[] => {
    const childrenMap = new Map<string, Note[]>();
    const roots: Note[] = [];
    for (const note of notes) {
      if (note.parent_id === null) {
        roots.push(note);
      } else {
        const arr = childrenMap.get(note.parent_id) ?? [];
        arr.push(note);
        childrenMap.set(note.parent_id, arr);
      }
    }
    const result: FlatItem[] = [];
    for (const root of roots) {
      const children = childrenMap.get(root.id) ?? [];
      const expanded = expandedOverrides.has(root.id) ? expandedOverrides.get(root.id)! : root.is_expanded;
      result.push({ note: root, isChild: false, hasChildren: children.length > 0 });
      if (expanded) {
        for (const child of children) {
          result.push({ note: child, isChild: true, hasChildren: false });
        }
      }
    }
    return result;
  }, [notes, expandedOverrides]);

  useEffect(() => { flatListRef.current = flatList; }, [flatList]);

  const childInputAfterIdx = useMemo(() => {
    if (!childCreatingParentId) return -1;
    let afterIdx = -1;
    for (let i = 0; i < flatList.length; i++) {
      const { note, isChild } = flatList[i];
      if (note.id === childCreatingParentId) afterIdx = i;
      if (isChild && note.parent_id === childCreatingParentId) afterIdx = i;
    }
    return afterIdx;
  }, [flatList, childCreatingParentId]);

  const handleAddChildNote = (parentId: string) => {
    setContextMenu(null);
    const parentNote = notes.find(n => n.id === parentId);
    if (!parentNote) return;
    if (!isNoteExpanded(parentNote)) {
      setExpandedOverrides(prev => new Map(prev).set(parentId, true));
      updateNoteExpanded(parentId, true).catch(err => console.error('Failed to expand parent:', err));
    }
    setChildCreatingParentId(parentId);
    setChildNewTitle('');
  };

  const commitChildNote = () => {
    if (childNewTitle.trim() && childCreatingParentId) {
      onCreateChildNote(childNewTitle.trim(), childCreatingParentId);
    }
    setChildCreatingParentId(null);
    setChildNewTitle('');
  };

  const handleChildKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); commitChildNote(); }
    else if (e.key === 'Escape') { setChildCreatingParentId(null); setChildNewTitle(''); }
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        notesApp{import.meta.env.DEV && <span className="dev-badge"> - dev</span>}
      </div>
      <div className="sidebar-list" ref={listRef}>
        {flatList.map(({ note, isChild, hasChildren }, index) => (
          <Fragment key={note.id}>
            <div>
              <div className={`drop-indicator${dropIndex === index ? ' active' : ''}`} />
              <div
                data-note-id={note.id}
                data-parent-id={note.parent_id ?? undefined}
                className={[
                  'note-item',
                  isChild ? 'child-note' : '',
                  note.id === activeNoteId ? 'active' : '',
                  draggingId === note.id ? 'dragging' : '',
                  confirmDeleteId === note.id ? 'confirm-delete' : '',
                  nestTargetId === note.id ? 'nest-target' : '',
                ].filter(Boolean).join(' ')}
                onContextMenu={e => {
                  e.preventDefault();
                  if (!isChild) setContextMenu({ noteId: note.id, x: e.clientX, y: e.clientY });
                }}
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
                    {!isChild && hasChildren && (
                      <button
                        className="folder-toggle"
                        onClick={e => {
                          e.stopPropagation();
                          toggleExpanded(note.id, isNoteExpanded(note));
                        }}
                      >
                        <FolderIcon open={isNoteExpanded(note)} />
                      </button>
                    )}
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
            {index === childInputAfterIdx && (
              <div className="note-item creating child-note">
                <input
                  ref={childInputRef}
                  className="new-note-input"
                  placeholder="new note..."
                  value={childNewTitle}
                  onChange={e => setChildNewTitle(e.target.value)}
                  onKeyDown={handleChildKeyDown}
                  onBlur={commitChildNote}
                />
              </div>
            )}
          </Fragment>
        ))}
        <div className={`drop-indicator${dropIndex === flatList.length ? ' active' : ''}`} />

        {isCreating && (
          <div className="note-item creating">
            <input
              ref={newInputRef}
              className="new-note-input"
              placeholder="new note..."
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={handleNewKeyDown}
              onBlur={commitNewNote}
            />
          </div>
        )}
      </div>

      <button className="add-btn" onClick={startCreating} title="New note">+</button>

      {contextMenu && createPortal(
        <div
          className="context-menu"
          style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 9999 }}
          onMouseDown={e => e.stopPropagation()}
        >
          <div
            className="context-menu-item"
            onClick={() => handleAddChildNote(contextMenu.noteId)}
          >
            Add child note
          </div>
        </div>,
        document.body
      )}
    </aside>
  );
}
