import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

interface CollapsibleState {
  collapsed: Map<number, boolean>
  outsidePos: number | null
}

function resolveCollapsedPositions(
  doc: ProseMirrorNode,
  saved: Record<string, boolean>,
): Map<number, boolean> {
  // First pass: count occurrences of each h{level}:{text} key
  const counts = new Map<string, number>()
  doc.forEach((node) => {
    if (node.type.name !== 'heading' || node.attrs.sacrificial) return
    const key = `h${node.attrs.level}:${node.textContent.trim()}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  })

  // Second pass: assign keys and resolve positions
  const result = new Map<number, boolean>()
  const seen = new Map<string, number>()
  doc.forEach((node, offset) => {
    if (node.type.name !== 'heading' || node.attrs.sacrificial) return
    const baseKey = `h${node.attrs.level}:${node.textContent.trim()}`
    const idx = seen.get(baseKey) ?? 0
    seen.set(baseKey, idx + 1)
    const lookupKey = (counts.get(baseKey) ?? 1) > 1 ? `${baseKey}:${idx}` : baseKey
    if (saved[lookupKey]) result.set(offset, true)
  })

  return result
}

function serializeCollapsedPositions(
  doc: ProseMirrorNode,
  collapsed: Map<number, boolean>,
): Record<string, boolean> {
  const counts = new Map<string, number>()
  doc.forEach((node) => {
    if (node.type.name !== 'heading' || node.attrs.sacrificial) return
    const key = `h${node.attrs.level}:${node.textContent.trim()}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  })

  const result: Record<string, boolean> = {}
  const seen = new Map<string, number>()
  doc.forEach((node, offset) => {
    if (node.type.name !== 'heading' || node.attrs.sacrificial) return
    const baseKey = `h${node.attrs.level}:${node.textContent.trim()}`
    const idx = seen.get(baseKey) ?? 0
    seen.set(baseKey, idx + 1)
    const key = (counts.get(baseKey) ?? 1) > 1 ? `${baseKey}:${idx}` : baseKey
    if (collapsed.get(offset)) result[key] = true
  })

  return result
}

const collapsibleKey = new PluginKey<CollapsibleState>('collapsibleHeadings')

function makeCaret(headingPos: number, isCollapsed: boolean): HTMLElement {
  const el = document.createElement('span')
  el.className = 'heading-caret'
  el.setAttribute('contenteditable', 'false')
  el.setAttribute('aria-hidden', 'true')
  el.setAttribute('data-heading-pos', String(headingPos))
  el.innerHTML = isCollapsed
    ? `<svg viewBox="0 0 12 16" width="0.65em" height="0.85em" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3,2 L9,8 L3,14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    : `<svg viewBox="0 0 16 12" width="0.85em" height="0.65em" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2,3 L8,9 L14,3" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  return el
}

export const CollapsibleHeadings = Extension.create({
  name: 'collapsibleHeadings',

  addOptions() {
    return {
      initialCollapsed: {} as Record<string, boolean>,
      onToggle: (_json: string) => {},
    }
  },

  addGlobalAttributes() {
    return [
      {
        types: ['heading'],
        attributes: {
          sacrificial: {
            default: null,
            parseHTML: el => el.getAttribute('data-sacrificial') || null,
            renderHTML: attrs => (attrs.sacrificial ? { 'data-sacrificial': 'true' } : {}),
          },
        },
      },
    ]
  },

  addProseMirrorPlugins() {
    const initialCollapsed = this.options.initialCollapsed as Record<string, boolean>
    const onToggle = this.options.onToggle as (json: string) => void
    return [
      new Plugin<CollapsibleState>({
        key: collapsibleKey,

        state: {
          init(_config, state): CollapsibleState {
            return {
              collapsed: resolveCollapsedPositions(state.doc, initialCollapsed),
              outsidePos: null,
            }
          },

          apply(tr, prev): CollapsibleState {
            const next = new Map<number, boolean>()
            prev.collapsed.forEach((isCollapsed, pos) => {
              // pos+1 is strictly inside the heading node. If it's marked deleted,
              // the heading itself was removed — don't carry the entry forward.
              if (tr.mapping.mapResult(pos + 1).deleted) return
              const mapped = tr.mapping.map(pos)
              const n = tr.doc.nodeAt(mapped)
              if (n?.type.name === 'heading' && !n.attrs.sacrificial) {
                next.set(mapped, isCollapsed)
              }
            })

            let outsidePos: number | null = null
            if (prev.outsidePos !== null) {
              const mapped = tr.mapping.map(prev.outsidePos)
              if (tr.doc.nodeAt(mapped)?.type.name === 'paragraph') outsidePos = mapped
            }

            const meta = tr.getMeta(collapsibleKey) as
              | { type: 'toggle'; pos: number }
              | { type: 'insert-outside'; pos: number }
              | undefined
            if (meta?.type === 'toggle') {
              next.set(meta.pos, !(next.get(meta.pos) ?? false))
              outsidePos = null
            } else if (meta?.type === 'insert-outside') {
              outsidePos = meta.pos
            }

            return { collapsed: next, outsidePos }
          },
        },

        appendTransaction(transactions, _oldState, newState) {
          if (transactions.some(tr => tr.getMeta('sacrificial-insert'))) return null
          if (!transactions.some(tr => tr.docChanged)) return null

          const { doc, schema } = newState
          const headingType = schema.nodes.heading
          if (!headingType) return null

          // Collect all non-sacrificial headings in document order
          const real: Array<{ offset: number; level: number; nodeSize: number }> = []
          doc.forEach((node, offset) => {
            if (node.type.name === 'heading' && !node.attrs.sacrificial) {
              real.push({ offset, level: node.attrs.level as number, nodeSize: node.nodeSize })
            }
          })
          if (real.length === 0) return null

          const insertions: Array<{ pos: number; level: number }> = []

          for (let i = 0; i < real.length; i++) {
            const h = real[i]

            // Scope ends at the next non-sacrificial heading with level <= h.level, or docEnd
            let scopeEnd = doc.content.size
            for (let j = i + 1; j < real.length; j++) {
              if (real[j].level <= h.level) {
                scopeEnd = real[j].offset
                break
              }
            }

            // Check if a sacrificial heading of this level already exists anywhere in the scope
            let hasSacrificial = false
            doc.forEach((node, offset) => {
              if (
                node.type.name === 'heading' &&
                node.attrs.sacrificial === true &&
                (node.attrs.level as number) === h.level &&
                offset >= h.offset + h.nodeSize &&
                offset < scopeEnd
              ) {
                hasSacrificial = true
              }
            })

            if (!hasSacrificial) insertions.push({ pos: scopeEnd, level: h.level })
          }

          if (insertions.length === 0) return null

          const tr = newState.tr
          tr.setMeta('sacrificial-insert', true)
          // Insert descending so lower positions are unaffected by higher-position inserts
          insertions.sort((a, b) => b.pos - a.pos)
          for (const ins of insertions) {
            tr.insert(ins.pos, headingType.create({ level: ins.level, sacrificial: true }))
          }
          return tr
        },

        props: {
          handleDOMEvents: {
            mousedown(view, event) {
              const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
              const pos = coords?.pos ?? null

              const { doc } = view.state
              const pluginState = collapsibleKey.getState(view.state)

              // Caret toggle — check the DOM event target first
              const target = event.target as HTMLElement
              const caret = target.closest('[data-heading-pos]') as HTMLElement | null
              if (caret) {
                const headingPos = parseInt(caret.getAttribute('data-heading-pos') ?? '-1', 10)
                if (headingPos >= 0) {
                  view.dispatch(view.state.tr.setMeta(collapsibleKey, { type: 'toggle', pos: headingPos }))
                  const newPluginState = collapsibleKey.getState(view.state)
                  if (newPluginState) {
                    const serialized = serializeCollapsedPositions(view.state.doc, newPluginState.collapsed)
                    const json = JSON.stringify(serialized)
                    console.log('[CollapsibleHeadings] writing collapsed_headings for note, json:', json)
                    onToggle(json)
                  }
                  event.preventDefault()
                  event.stopPropagation()
                  event.stopImmediatePropagation()
                  return true
                }
              }

              if (pos === null || !pluginState) return false

              // Collect all top-level nodes with their offsets
              const nodes: Array<{ node: Parameters<Parameters<typeof doc.forEach>[0]>[0]; offset: number }> = []
              doc.forEach((node, offset) => nodes.push({ node, offset }))

              // Find a collapsed heading whose hidden scope contains pos
              for (let i = 0; i < nodes.length; i++) {
                const { node: hNode, offset: hOffset } = nodes[i]
                if (hNode.type.name !== 'heading' || hNode.attrs.sacrificial) continue
                if (!(pluginState.collapsed.get(hOffset) ?? false)) continue

                // Find the sacrificial heading that closes this scope
                let sacrificialIdx = -1
                for (let j = i + 1; j < nodes.length; j++) {
                  const { node: n } = nodes[j]
                  if (n.type.name === 'heading' && n.attrs.sacrificial && (n.attrs.level as number) === (hNode.attrs.level as number)) {
                    sacrificialIdx = j
                    break
                  }
                  // A same-or-higher-level real heading terminates the scope before we find a sacrificial
                  if (n.type.name === 'heading' && !n.attrs.sacrificial && (n.attrs.level as number) <= (hNode.attrs.level as number)) break
                }

                if (sacrificialIdx === -1) continue

                const { node: sNode, offset: sOffset } = nodes[sacrificialIdx]
                const scopeEnd = sOffset + sNode.nodeSize
                const headingEnd = hOffset + hNode.nodeSize

                // Click on the heading itself — let ProseMirror handle normally
                if (pos >= hOffset && pos < headingEnd - 1) return false

                if (pos >= headingEnd - 1 && pos < scopeEnd) {
                  // pos is inside the hidden scope below the heading — redirect cursor
                  const targetPos = sOffset + sNode.nodeSize + 1
                  event.preventDefault()
                  event.stopPropagation()
                  event.stopImmediatePropagation()
                  setTimeout(() => {
                    const $target = view.state.doc.resolve(Math.min(targetPos, view.state.doc.content.size - 1))
                    view.dispatch(view.state.tr.setSelection(TextSelection.near($target)))
                    view.focus()
                  }, 200)
                  return true
                }
              }

              return false
            },
          },

          decorations(state) {
            const pluginState = collapsibleKey.getState(state)
            if (!pluginState) return DecorationSet.empty

            const { collapsed, outsidePos } = pluginState
            const decos: Decoration[] = []
            let collapsedLevel: number | null = null

            state.doc.forEach((node, offset) => {
              if (node.type.name === 'heading') {
                const level = node.attrs.level as number
                const isSacrificial = !!node.attrs.sacrificial

                if (isSacrificial) {
                  // Hidden, and clears collapsedLevel for its matching level so content after it is visible
                  if (collapsedLevel !== null && level === collapsedLevel) collapsedLevel = null
                  decos.push(Decoration.node(offset, offset + node.nodeSize, { style: 'display:none' }))
                } else if (collapsedLevel !== null && level > collapsedLevel) {
                  // Dominated by a collapsed ancestor — hide it, keep its own state intact
                  decos.push(Decoration.node(offset, offset + node.nodeSize, { style: 'display:none' }))
                } else {
                  collapsedLevel = null
                  const isCollapsed = collapsed.get(offset) ?? false
                  const startPos = offset + 1
                  const endPos = offset + node.nodeSize - 1

                  // Caret sits at the start of the heading in the DOM (matches its visual left position)
                  decos.push(
                    Decoration.widget(startPos, makeCaret(offset, isCollapsed), {
                      side: -1,
                      key: `caret-${offset}-${isCollapsed ? 'c' : 'e'}`,
                    })
                  )

                  if (isCollapsed) {
                    collapsedLevel = level
                    const ellipsis = document.createElement('span')
                    ellipsis.textContent = '…'
                    ellipsis.setAttribute('contenteditable', 'false')
                    ellipsis.setAttribute('aria-hidden', 'true')
                    ellipsis.style.cssText = 'opacity:0.5;margin-left:0.3em;user-select:none;pointer-events:none'
                    decos.push(Decoration.widget(endPos, ellipsis, { side: 1 }))
                  }
                }
              } else if (collapsedLevel !== null) {
                // The paragraph inserted via dead-zone click acts as an explicit scope boundary
                if (outsidePos !== null && offset === outsidePos) {
                  collapsedLevel = null
                } else {
                  decos.push(Decoration.node(offset, offset + node.nodeSize, { style: 'display:none' }))
                }
              }
            })

            return DecorationSet.create(state.doc, decos)
          },
        },
      }),
    ]
  },
})
