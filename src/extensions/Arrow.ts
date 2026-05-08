import { Node, InputRule, mergeAttributes } from '@tiptap/core'

function buildSVG(direction: 'right' | 'left'): string {
  // Mirrored coordinates for left arrow (x → 40 - x)
  const isLeft = direction === 'left'
  const [shaftX1, shaftX2] = isLeft ? [34, 11] : [6, 29]
  const [tipX, wingX]      = isLeft ? [11, 19] : [29, 21]
  return (
    `<svg viewBox="0 0 40 16" width="2.2em" height="1em" fill="none" ` +
    `xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
    `<line x1="${shaftX1}" y1="8" x2="${shaftX2}" y2="8" ` +
      `stroke="currentColor" stroke-width="1.875" stroke-linecap="round"/>` +
    `<polyline points="${wingX},2 ${tipX},8 ${wingX},14" fill="none" ` +
      `stroke="currentColor" stroke-width="1.875" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>`
  )
}

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
      dom.style.cssText =
        'display:inline-block;line-height:0;vertical-align:middle;' +
        'user-select:none;-webkit-user-select:none;pointer-events:none'
      dom.innerHTML = buildSVG(node.attrs.direction as 'right' | 'left')
      return { dom }
    }
  },

  addInputRules() {
    return [
      new InputRule({
        find: /->$/,
        handler: ({ state, range }) => {
          state.tr.replaceWith(range.from, range.to, this.type.create({ direction: 'right' }))
        },
      }),
      new InputRule({
        find: /<-$/,
        handler: ({ state, range }) => {
          state.tr.replaceWith(range.from, range.to, this.type.create({ direction: 'left' }))
        },
      }),
    ]
  },
})
