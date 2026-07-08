import { createContext, useContext, useId, useState } from "react";
import styles from "./Card.module.css";

const CardCtx = createContext(null);

/**
 * Card — a themeable, self-sizing surface.
 *
 * Flexibility guarantees:
 *  - `container-type: inline-size` means children can respond to the card's
 *    own width (not the viewport), so the same card adapts wherever it's placed.
 *  - The body height is content-driven and animates open/closed via the
 *    grid-template-rows 0fr↔1fr technique — no fixed/max heights, so any
 *    amount of content fits without clipping.
 */
export function Card({
  children,
  collapsible = false,
  expandable = false,
  defaultCollapsed = false,
  className = "",
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [fullWidth, setFullWidth] = useState(false);
  const bodyId = useId();
  const ctx = {
    collapsible,
    collapsed,
    setCollapsed,
    expandable,
    fullWidth,
    setFullWidth,
    bodyId,
  };
  return (
    <CardCtx.Provider value={ctx}>
      <section
        className={`${styles.card} ${className}`}
        data-collapsed={collapsed || undefined}
        data-fullwidth={fullWidth || undefined}
      >
        {children}
      </section>
    </CardCtx.Provider>
  );
}

function Head({ icon, title, badge, meta, right }) {
  const ctx = useContext(CardCtx);
  const clickable = ctx?.collapsible;
  const toggle = () => clickable && ctx.setCollapsed((c) => !c);
  return (
    <header
      className={styles.head}
      data-clickable={clickable || undefined}
      onClick={toggle}
      role={clickable ? "button" : undefined}
      aria-expanded={clickable ? !ctx.collapsed : undefined}
      aria-controls={clickable ? ctx.bodyId : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={(e) => {
        if (clickable && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          toggle();
        }
      }}
    >
      {icon != null && <span className={styles.icon}>{icon}</span>}
      <span className={styles.title}>{title}</span>
      {badge}
      {meta != null && <span className={styles.meta}>{meta}</span>}
      {right}
      {ctx?.expandable && (
        <button
          type="button"
          className={styles.expandBtn}
          title={ctx.fullWidth ? "Collapse to column" : "Expand to full width"}
          aria-pressed={ctx.fullWidth}
          onClick={(e) => {
            e.stopPropagation();
            ctx.setFullWidth((f) => !f);
          }}
        >
          {ctx.fullWidth ? "⤡" : "⤢"}
        </button>
      )}
      {clickable && (
        <span className={styles.chevron} aria-hidden>
          ▾
        </span>
      )}
    </header>
  );
}

function Body({ children, padded = false }) {
  const ctx = useContext(CardCtx);
  return (
    <div className={styles.body} id={ctx?.bodyId}>
      <div className={`${styles.bodyInner} ${padded ? styles.padded : ""}`}>
        {children}
      </div>
    </div>
  );
}

Card.Head = Head;
Card.Body = Body;
