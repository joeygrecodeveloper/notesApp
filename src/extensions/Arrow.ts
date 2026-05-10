import { Node, InputRule, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

function buildSVG(direction: 'right' | 'left' | 'up' | 'down'): string {
  if (direction === 'up' || direction === 'down') {
    const isDown = direction === 'down'
    // viewBox 12×16 renders at 0.75em×1em → 1 SVG unit = 1px (uniform scale)
    const [shaftY1, shaftY2] = isDown ? [2, 13]  : [14, 3]
    const [tipY,   wingY]    = isDown ? [13, 9.25] : [3,  6.75]
    return (
      `<svg viewBox="0 0 12 16" width="0.75em" height="1em" fill="none" ` +
      `xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
      `<line x1="6" y1="${shaftY1}" x2="6" y2="${shaftY2}" ` +
        `stroke="currentColor" stroke-width="1.875" stroke-linecap="round"/>` +
      `<polyline points="3.5,${wingY} 6,${tipY} 8.5,${wingY}" fill="none" ` +
        `stroke="currentColor" stroke-width="1.875" stroke-linecap="round" stroke-linejoin="round"/>` +
      `</svg>`
    )
  }

  // Mirrored coordinates for left arrow (x → 40 - x)
  const isLeft = direction === 'left'
  const [shaftX1, shaftX2] = isLeft ? [34, 11] : [6, 29]
  const [tipX, wingX]      = isLeft ? [11, 19] : [29, 21]
  return (
    `<svg viewBox="0 0 40 16" width="2.2em" height="1em" fill="none" ` +
    `xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
    `<line x1="${shaftX1}" y1="8" x2="${shaftX2}" y2="8" ` +
      `stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>` +
    `<polyline points="${wingX},2 ${tipX},8 ${wingX},14" fill="none" ` +
      `stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>`
  )
}

const arrowUpgradeKey = new PluginKey('arrowUpgrade')

export const Arrow = Node.create({
  name: 'arrow',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      direction: {
        default: 'right',
        parseHTML: el => el.getAttribute('data-direction') ?? 'right',
        renderHTML: attrs => ({ 'data-direction': attrs.direction }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-arrow]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-arrow': '' })]
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('span')
      dom.setAttribute('contenteditable', 'false')
      dom.setAttribute('data-arrow', '')
      dom.setAttribute('data-direction', node.attrs.direction as string)
      dom.style.cssText =
        'display:inline-block;line-height:0;vertical-align:middle;' +
        'user-select:none;-webkit-user-select:none;pointer-events:none'
      dom.innerHTML = buildSVG(node.attrs.direction as 'right' | 'left' | 'up' | 'down')
      return { dom }
    }
  },

  addInputRules() {
    return [
      new InputRule({
        // Skip when >> is the entire paragraph (ArrowList handles that case).
        // Return index pointing at just ">>" so range covers only those 2 chars.
        find: (text) => {
          if (!text.endsWith('>>') || text === '>>') return null
          return { index: text.length - 2, text: '>>' }
        },
        handler: ({ state, range }) => {
          state.tr.replaceWith(range.from, range.to, this.type.create({ direction: 'right' }))
        },
      }),
      new InputRule({
        find: /<<$/,
        handler: ({ state, range }) => {
          state.tr.replaceWith(range.from, range.to, this.type.create({ direction: 'left' }))
        },
      }),
      new InputRule({
        find: /\^\^$/,
        handler: ({ state, range }) => {
          state.tr
            .replaceWith(range.from, range.to, this.type.create({ direction: 'up' }))
            .insertText(' ', range.from + 1)
        },
      }),
    ]
  },

  addProseMirrorPlugins() {
    const type = this.type
    return [
      new Plugin({
        key: arrowUpgradeKey,
        props: {
          // ^^ inserts [up-arrow][space], so cursor sits after: [up-arrow][space]|
          // Check for that pattern and swap the up-arrow for a down-arrow,
          // leaving the existing space in place.
          handleTextInput(view, from, _to, text) {
            if (text !== '^' || from < 2) return false
            const { state } = view
            const charBefore = state.doc.textBetween(from - 1, from, '')
            if (charBefore !== ' ') return false
            const nodeBefore = state.doc.nodeAt(from - 2)
            if (nodeBefore?.type === type && nodeBefore.attrs.direction === 'up') {
              view.dispatch(
                state.tr.replaceWith(from - 2, from - 1, type.create({ direction: 'down' }))
              )
              return true
            }
            return false
          },
        },
      }),
    ]
  },
})
