// Shared building blocks for the General Option Scanner help pages, so the
// guide and the per-strategy field reference stay visually consistent.
export const helpImage = filename => `${import.meta.env.BASE_URL}help/${filename}`

// Jump to a section of the guide the button sits in. Not a document-wide id
// lookup: Split View can show the same guide in both panes, and that would
// scroll the other pane.
export const scrollToHelpSection = (event, id) => {
  event.currentTarget.closest('.gos-help-page')
    ?.querySelector(`#${CSS.escape(id)}`)
    ?.scrollIntoView({ behavior: 'smooth' })
}

export function HelpSection({ id, eyebrow, title, children }) {
  return <section className="gos-help-section" id={id}>
    <header><span>{eyebrow}</span><h2>{title}</h2></header>
    {children}
  </section>
}

export function DefinitionList({ rows }) {
  return <dl className="gos-help-definitions">{rows.map(([term, definition]) => <div key={term}><dt>{term}</dt><dd>{definition}</dd></div>)}</dl>
}
