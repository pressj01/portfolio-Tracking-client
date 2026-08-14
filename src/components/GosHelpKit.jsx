// Shared building blocks for the General Option Scanner help pages, so the
// guide and the per-strategy field reference stay visually consistent.
export const helpImage = filename => `${import.meta.env.BASE_URL}help/${filename}`

export function HelpSection({ id, eyebrow, title, children }) {
  return <section className="gos-help-section" id={id}>
    <header><span>{eyebrow}</span><h2>{title}</h2></header>
    {children}
  </section>
}

export function DefinitionList({ rows }) {
  return <dl className="gos-help-definitions">{rows.map(([term, definition]) => <div key={term}><dt>{term}</dt><dd>{definition}</dd></div>)}</dl>
}
