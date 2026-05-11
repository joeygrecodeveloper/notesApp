import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

interface CollapsibleState {
  collapsed: Map<number, boolean>
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

  addProseMirrorPlugins() {
    return [
      new Plugin<CollapsibleState>({
        key: collapsibleKey,

        state: {
          init(): CollapsibleState {
            return { collapsed: new Map() }
          },

          apply(tr, prev): CollapsibleState {
            const next = new Map<number, boolean>()
            prev.collapsed.forEach((isCollapsed, pos) => {
              const mapped = tr.mapping.map(pos)
              if (tr.doc.nodeAt(mapped)?.type.name === 'heading') {
                next.set(mapped, isCollapsed)
              }
            })
            const meta = tr.getMeta(collapsibleKey) as { type: 'toggle'; pos: number } | undefined
            if (meta?.type === 'toggle') {
              next.set(meta.pos, !(next.get(meta.pos) ?? false))
            }
            return { collapsed: next }
          },
        },

        props: {
          handleClick(view, _pos, event) {
            const target = event.target as HTMLElement
            const caret = target.closest('[data-heading-pos]') as HTMLElement | null
            if (!caret) return false
            const headingPos = parseInt(caret.getAttribute('data-heading-pos') ?? '-1', 10)
            if (headingPos < 0) return false
            view.dispatch(view.state.tr.setMeta(collapsibleKey, { type: 'toggle', pos: headingPos }))
            return true
          },

          decorations(state) {
            const pluginState = collapsibleKey.getState(state)
            if (!pluginState) return DecorationSet.empty

            const { collapsed } = pluginState
            const decos: Decoration[] = []
            let collapsedLevel: number | null = null

            state.doc.forEach((node, offset) => {
              if (node.type.name === 'heading') {
                const level = node.attrs.level as number

                if (collapsedLevel !== null && level > collapsedLevel) {
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
                decos.push(Decoration.node(offset, offset + node.nodeSize, { style: 'display:none' }))
              }
            })

            return DecorationSet.create(state.doc, decos)
          },
        },
      }),
    ]
  },
})
