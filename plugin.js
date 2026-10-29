/**
 * Smart Searches — save the queries you type into a collection view's filter
 * field, give each one a title, and re-run it from a bookmark button in the
 * view's toolbar.
 *
 * Thymer has pinned searches for the global search panel, but nothing for the
 * per-view filter field, so a query you spent a minute composing is gone the
 * moment you clear it. This plugin adds a bookmark button next to the filter
 * and sort buttons; it opens the query builder, whose saved-search row is the
 * library of searches saved for the collection you're in (the current view's
 * first). A saved search in the filter field shows as a chip.
 *
 * How it talks to Thymer:
 *  - the filter field is a real <input class="query-input--field is-collection-filter">
 *    (transparent text, with .query-input--highlight painting the syntax colours
 *    on top). Writing .value and dispatching a bubbling "input" event runs the
 *    search exactly as typing does — verified against the live app.
 *  - the collection is identified by the guid on .panel-heading[data-banner-drop],
 *    falling back to the collection name on .panel-bar[data-plugin] if a
 *    collection has no heading. The active view is
 *    .records-view-switcher-button[aria-pressed="true"] → data-view.
 *
 * Storage: the plugin's own config (conf.custom.savedSearches), so the list
 * syncs to the web client and other devices. saveConfiguration() reloads the
 * plugin, which would yank the builder out from under you mid-click, so writes
 * are held in memory (plus localStorage as a crash net) and flushed once the
 * builder closes.
 *
 * No `export` keyword — pushed straight into Thymer's plugin store.
 */

const CSS = `
/* Toolbar button — same shape as Thymer's own toolbar icons, so it sits in the
   row without announcing itself as third-party. */
.ssq-btn { display: flex; }
/* Filled bookmark is an inline SVG (no filled glyph in the icon font); size it to
   the surrounding icons so it sits level with the filter and sort buttons. */
.ssq-ico { width: 1em; height: 1em; display: block; }

/* Refresh button on a live search block.
   The icon and the click feedback are Thymer's own: its global search panel
   refreshes with a "ti ti-refresh" control and spins it with .animate__spin-once.
   Everything else is copied from the "query" pill this button sits beside —
   .block-nstype-button, which Thymer draws on this same box — because the two
   have to read as ONE control (Parham, 2026-08-10: "hover for this button must
   match hover for query button"). That means the same resting fill, border and
   radius, the same .7 reveal, and the same --ed-container-label-hover-* pair on
   hover. Borrowing the toolbar shell instead (button-minimal-hover) gave it a
   plain grey fill that did not match the pill at all.
   NOT done by wearing the .block-nstype-button class itself: Thymer's drag
   handler treats that class as a drag grip and would start dragging the block. */
/* The pair of chips on a block: edit-in-builder + refresh. The WRAPPER is what
   gets measured and placed (one rect to keep aligned to the native pill); the
   chips inside carry the pill's own look. Hidden as the native pill is —
   visibility, never display, so it keeps a layout box and can be placed before
   it is ever shown. */
.ssq-qwrap {
	position: absolute; box-sizing: border-box;
	display: flex; align-items: stretch; gap: 4px;
	visibility: hidden; opacity: 0;
}
.ssq-qwrap.ssq-on { visibility: visible; opacity: 1; }
.ssq-qchip {
	box-sizing: border-box;
	display: flex; align-items: center; justify-content: center;
	padding: 2px 6px; cursor: pointer; opacity: .7;
	font-size: var(--ed-font-size-sm, 12px);
	border-radius: var(--ed-radius-normal, 5px);
	color: var(--ed-container-label-color, inherit);
	background-color: var(--ed-container-label-bg, transparent);
	border: 1px solid var(--ed-container-label-border, transparent);
}
.ssq-qchip:hover {
	opacity: 1;
	background-color: var(--ed-container-label-hover-bg);
	color: var(--ed-container-label-hover-color);
}
/* Reaching for the refresh button takes the pointer off .container-border, so
   the app's own ".container-border:hover > .block-nstype-button" stops matching
   and the "query" pill blinks out from under the cursor. Hold it lit for as
   long as our button is hovered, so the pair behaves as one control. */
.block-nstype-button.ssq-peer-hot { visibility: visible; opacity: .7; }

/* ── Chips over the filter field ───────────────────────────────────────────
   Drawn over the field's text area while it is not focused; above Thymer's
   highlight layer (z-index 1), below its clear and warning icons. */
.ssq-chips { position: absolute; z-index: 2; display: flex; cursor: text; }
.ssq-chips-in { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; overflow: hidden; white-space: pre; }
.ssq-chips-text { flex: 0 0 auto; white-space: pre; }
.ssq-chip {
	flex: 0 0 auto; display: inline-flex; align-items: center; height: 24px; box-sizing: border-box;
	border-radius: 4px; cursor: default;
	border: 1px solid color-mix(in srgb, var(--color-primary-500, #4caea1) 45%, transparent);
	background: color-mix(in srgb, var(--color-primary-500, #4caea1) 14%, transparent);
}
.ssq-chip-main {
	display: inline-flex; align-items: center; gap: 6px; height: 100%; padding: 0 7px;
	background: none; border: 0; cursor: pointer; font: inherit; font-size: 13px; font-weight: 600;
	color: var(--text-color, #e0e0e0);
}
.ssq-chip-main .ti { font-size: 13px; color: var(--color-primary-500, #4caea1); }
.ssq-chip-main:hover { filter: brightness(1.2); }
.ssq-chip-x {
	display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 100%; padding: 0;
	background: none; border: 0; cursor: pointer; font-size: 11px; color: var(--text-muted, #9aa0a8);
	border-left: 1px solid color-mix(in srgb, var(--color-primary-500, #4caea1) 30%, transparent);
}
.ssq-chip-x:hover { color: var(--text-color, #e0e0e0); }

/* ── Query builder ────────────────────────────────────────────────────────
   Anchored under the toolbar rather than centred, because it applies live:
   the rows it filters must stay visible while you edit. */
.qb-pop {
	position: fixed; z-index: 99998;
	width: min(760px, calc(100vw - 16px));
	max-height: calc(100dvh - 16px);
	display: flex; flex-direction: column;
	background: var(--cmdpal-bg-color, var(--app-bg, #26262b));
	color: var(--cmdpal-fg-color, var(--text-color, #ddd));
	font-family: var(--font-mono, inherit);
	font-size: var(--text-size-small, .875rem);
	border: 1px solid color-mix(in srgb, var(--text-color, #ddd) 30%, transparent);
	border-radius: 4px;   /* his standing rule: 4px on our surfaces too (2026-08-12) */
	box-shadow: 0 16px 48px rgba(0,0,0,.5), 0 2px 6px rgba(0,0,0,.3);
	overflow: hidden;
}
.qb-head {
	flex: 0 0 auto; display: flex; align-items: center; gap: 8px;
	padding: 9px 8px 9px 14px; border-bottom: 1px solid rgba(127,127,127,.18);
}
.qb-head-title { font-size: 10.5px; letter-spacing: .04em; text-transform: uppercase; opacity: .45; font-weight: 600; }
.qb-head-sub { font-size: 11px; opacity: .45; margin-left: 2px; }
/* The ? takes the auto margin, so it and Clear Search sit together on the right. */
/* Centred on both axes explicitly: a button centres its text horizontally but the
   vertical placement follows the line box, and the inherited .qb-btn line-height
   left the glyph sitting high in a square 24px button. */
.qb-help-btn {
	margin-left: auto; width: 24px; height: 24px; padding: 0; font-weight: 600;
	display: inline-flex; align-items: center; justify-content: center; line-height: 1;
}
.qb-headclear { height: 24px; padding: 0 9px; font-weight: 400; }
/* The help popover. Its surface is the Clear Search button's fill (his call), not
   the panel's darker one, so it reads as something laid ON the builder rather than
   part of it. Body-parented, so it states its own typography — it would otherwise
   inherit the document's. */
.qb-help-pop {
	position: fixed; z-index: 100002;
	width: min(430px, calc(100vw - 16px));
	max-height: calc(100dvh - 24px); overflow-y: auto;
	background: var(--ed-button-bg, rgba(127,127,127,.08));
	color: var(--cmdpal-fg-color, var(--text-color, #ddd));
	border: 1px solid rgba(127,127,127,.28);
	border-radius: 4px;   /* his standing rule: 4px on our surfaces too (2026-08-12) */
	box-shadow: 0 12px 34px rgba(0,0,0,.45), 0 2px 6px rgba(0,0,0,.3);
	padding: 12px 14px;
	font-family: var(--font-mono, inherit);
	font-size: var(--text-size-small, .875rem);
}
.qb-help-pop .qb-help { padding: 0; }
/* The help text itself: prose, not UI. */
.qb-help { font-size: var(--text-size-smaller, .8125rem); line-height: 1.5; }
.qb-help-h { font-size: 10.5px; letter-spacing: .04em; text-transform: uppercase; opacity: .45;
	font-weight: 600; margin: 10px 0 4px; }
.qb-help-h:first-child { margin-top: 0; }
.qb-help-p { margin: 0; opacity: .75; }
.qb-help-list { margin: 0; padding-left: 18px; opacity: .75; }
.qb-help-list li { margin-bottom: 5px; }
/* Nothing to clear reads as nothing to press, exactly as in the saved-searches popup. */
.qb-btn.qb-btn-off { opacity: .35; cursor: default; pointer-events: none; }
.qb-x {
	width: 24px; height: 24px; border-radius: 4px; cursor: pointer;
	display: inline-flex; align-items: center; justify-content: center; opacity: .55;
}
/* A source that cannot be changed reads exactly like the pickers beside it — same
   fill, same text — and loses only the affordances: no chevron, no hover, no
   pointer. It was dimmed before, which made the row look half-disabled when it is
   simply answered. */
.qb-sel.qb-locked { cursor: default; }
.qb-sel.qb-locked:hover { filter: none; }
.qb-x:hover { background: rgba(127,127,127,.18); opacity: 1; }
.qb-body { flex: 1 1 auto; overflow-y: auto; padding: 10px 14px 4px; min-height: 0; }
.qb-row { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
/* Fixed-width lead cell so every row's field picker starts on the same x. */
/* Just wide enough for "Where" and the and/or control — any more is dead space. */
/* Everything in the lead column is CENTRED on one axis: the and/or button fills the
   cell and centres its own content, and the plain words ("Where", the echoed AND)
   centre in the same cell. Aligning their LEFT edges instead never looked right,
   because the words are different lengths and the button's label is inset. */
.qb-lead { flex: 0 0 58px; font-size: 11.5px; text-align: center; padding-right: 10px; }
.qb-leadtxt { opacity: .6; }

/* One control shell for every picker. The chevron carries the SAME padding as the
   label (--qb-pad on both sides), so each control is symmetric left to right. */
.qb-sel, .qb-val {
	--qb-pad: 9px;
	height: 28px; border-radius: 4px; font-family: inherit; font-size: 11.5px;
	background: var(--ed-button-bg, rgba(127,127,127,.08));
	color: var(--ed-button-color, var(--text-color, #ddd));
	border: 1px solid rgba(127,127,127,.28); outline: none; min-width: 0;
}
.qb-sel {
	display: flex; align-items: center; gap: 6px; cursor: pointer; text-align: left;
	padding: 0 var(--qb-pad) 0 var(--qb-pad);
}
.qb-val { padding: 0 var(--qb-pad); }
.qb-sel-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qb-sel-label.qb-placeholder { opacity: .45; }
.qb-chev { flex: 0 0 auto; font-size: 10px; opacity: .55; margin-left: auto; }
.qb-sel:hover, .qb-val:hover { filter: brightness(1.15); }
.qb-sel.qb-open, .qb-val:focus { border-color: var(--ed-button-primary-bg, #4caea1); }
.qb-src { flex: 0 0 128px; }
/* The keyword strip. Chips wear the same shell as every picker cell, sized to
   their word (capped), never the whole row — his call. */
.qb-strip { flex: 1 1 auto; min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.qb-sel.qb-kwchip { flex: 0 1 auto; max-width: 230px; position: relative; }
.qb-kwchip .qb-kwx {
	position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
	width: 16px; height: 16px; border-radius: 4px; display: none;
	align-items: center; justify-content: center; font-size: 10px; cursor: pointer;
}
.qb-kwchip:hover .qb-kwx { display: inline-flex; }
.qb-kwchip:hover .qb-chev { opacity: 0; }
.qb-kwx:hover { background: rgba(127,127,127,.25); }
.qb-sel.qb-gap { flex: 0 0 auto; width: auto; padding: 0 8px; font-weight: 600; letter-spacing: .04em; }
.qb-sel.qb-gap .qb-sel-label { flex: 0 0 auto; }
.qb-sel.qb-gap .qb-chev { display: none; }
.qb-gap.qb-gap-not .qb-sel-label { color: var(--enum-red-fg, #e06c6c); }
.qb-sel.qb-stripadd { flex: 0 0 auto; width: 28px; justify-content: center; padding: 0; opacity: .7; }
/* the label span keeps its flex-grow from the shared shell — undo it, or the
   glyph hugs the left edge of the square */
.qb-stripadd .qb-sel-label { flex: 0 0 auto; text-align: center; }
.qb-stripadd:hover { opacity: 1; }
/* The first row's "Show" is the same control (its menu holds Show / NOT), in
   the plain voice the word has always had. Negated it reads NOT, in the
   joiner's weight. (A ghost-quiet AND was tried and rejected the same day —
   "det dämpade AND var inte bra" — every lead is a plainly clickable button.) */
.qb-join.qb-join-lead { font-weight: 400; letter-spacing: 0; }
.qb-join.qb-join-lead.qb-join-not { font-weight: 600; letter-spacing: .04em; }
/* Tabbing needs a place to BE: .qb-sel ships outline:none, so keyboard focus
   was invisible (his report). :focus-visible only — a mouse click should not
   leave a lit border behind. */
.qb-sel:focus-visible, .qb-val:focus-visible, .qb-add:focus-visible, .qb-btn:focus-visible {
	border-color: var(--ed-button-primary-bg, #4caea1);
	box-shadow: 0 0 0 1px var(--ed-button-primary-bg, #4caea1);
}
.qb-striprow { align-items: flex-start; }
/* The lead is a 28px BUTTON now (every joiner cell is live), same height as the
   chips, so it top-aligns bare. The old 6px padding was tuned for the echoed
   WORD and pushed the button below the chips ("AND Page alignar inte") — the
   word alone keeps that inset. */
.qb-striprow > .qb-lead { padding-top: 0; }
.qb-striprow > .qb-lead .qb-leadtxt { display: inline-block; padding-top: 6px; }
.qb-striprow > .qb-del { margin-top: 4px; }
.qb-field { flex: 1 1 150px; }
.qb-op { flex: 0 0 148px; }
.qb-val, .qb-sel.qb-val-sel { flex: 1 1 150px; }
/* A compact keyed row ([Due][≤][Value], [Hashtag][Value]) has fewer cells, and
   an unbounded value control swallowed the whole row's width — it keeps a
   normal column's width instead (his report: "det räcker med en kolumn
   bredd som förut"). */
.qb-row.qb-compact .qb-val, .qb-row.qb-compact .qb-sel.qb-val-sel { flex: 0 1 220px; }
/* Row drag (his ask): the grip shows on hover; the drop line marks the gap a
   row will land in; the zone at the bottom takes a row OUT into a new group. */
.qb-body { position: relative; }
/* The grip lives in the SAME column as the fold buttons, past the trash — it
   used to sit mid-row and ate the value controls' width. It is faintly visible
   at rest rather than hover-only: that column holds nothing else on a condition
   row, so showing the handle costs no clutter and stops the drag from being a
   secret. */
.qb-grip { flex: 0 0 auto; width: 16px; opacity: .18; cursor: grab; display: inline-flex;
	align-items: center; justify-content: center; font-size: 13px; }
/* Condition rows carry a 6px flex gap that header rows do not, so the two
   row kinds need DIFFERENT margins to land the trash on one line: 0 here,
   6 on the header rows fold. Measured with probe-align4.js. */
.qb-row > .qb-grip:last-child, .qb-gripgap { width: 22px; margin-left: 0; }
.qb-gripgap { flex: 0 0 auto; }
.qb-row:hover .qb-grip, .qb-joinrow:hover .qb-grip { opacity: .5; }
.qb-grip:hover { opacity: 1; }
/* A box that kept its own fold chevron (only one with no header row of its
   own) has it sitting over the first row's slot — that row shows no grip. */
.qb-boxfold + .qb-row > .qb-grip:last-child { visibility: hidden; }
.qb-row.qb-dragrow { opacity: .35; }
.qb-dropline { position: absolute; height: 2px; border-radius: 1px; z-index: 6; pointer-events: none;
	background: var(--ed-button-primary-bg, #4caea1); }
.qb-dropzone { margin: 8px 0 4px; padding: 10px; border: 1px dashed rgba(127,127,127,.4);
	border-radius: 4px; text-align: center; opacity: .55; font-size: 11.5px; }
.qb-dropzone.qb-dropzone-hot { border-color: var(--ed-button-primary-bg, #4caea1);
	color: var(--ed-button-primary-bg, #4caea1); opacity: 1; }
/* Collapsible groups: the chevron folds a group to one line, whose chip reads
   the group's own compiled text (his pick over "Group A/B" — the string IS
   what you navigate on). Fold state is session-local, never in the model. */
.qb-foldsum {
	flex: 1 1 auto; min-width: 0;
	overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
	font-size: 11.5px; line-height: 26px; padding: 0 9px; cursor: pointer;
	background: var(--ed-button-bg, rgba(127,127,127,.08));
	border: 1px solid rgba(127,127,127,.28); border-radius: 4px; opacity: .8;
}
.qb-foldsum:hover { opacity: 1; }
/* The and/or control: the WORD is centred in the button, on the same axis as
   "Where" above it. The chevron is taken out of the flex flow to get there — while
   it was part of the centred pair it pushed the word 6px off-centre (measured), so
   the column never quite lined up however the padding was tuned. */
.qb-join {
	width: 100%; position: relative; justify-content: center;
	font-weight: 600; letter-spacing: .04em;
	/* The cell's padding-right nudges the whole column left, but it also SHRINKS
	   this button, and a 48px box cannot hold a centred "AND" plus a chevron with
	   air on both sides — the chevron ended up on the border. calc() + the negative
	   margin give the button the cell's full width back (width:100% alone resolves
	   against the padded content box, which is why an earlier attempt did nothing),
	   and the asymmetric padding puts its label back on the column's axis. */
	width: calc(100% + 10px); margin-right: -10px; padding: 0 14px 0 4px;
}
.qb-join .qb-sel-label { flex: 0 0 auto; text-align: center; }
.qb-join .qb-chev { position: absolute; right: 6px; margin-left: 0; }

/* A date value: free text plus a calendar button, in one control shell. */
.qb-val-date { flex: 1 1 auto; min-width: 0; padding-right: 26px; }

/* The carried-over search, as a chip on the Where line. */
.qb-base {
	flex: 1 1 auto; min-width: 0; height: 28px; display: flex; align-items: center; gap: 6px;
	padding: 0 6px 0 9px; border-radius: 4px;
	background: var(--ed-button-bg, rgba(127,127,127,.08));
	border: 1px solid var(--ed-button-primary-bg, #4caea1);
	color: var(--ed-button-color, var(--text-color, #ddd)); font-size: 11.5px;
}
.qb-base-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qb-base-x {
	flex: 0 0 auto; width: 18px; height: 18px; border-radius: 4px; cursor: pointer; opacity: .55;
	display: inline-flex; align-items: center; justify-content: center; font-size: 12px;
}
.qb-base-x:hover { opacity: 1; background: rgba(127,127,127,.22); }
.qb-del {
	flex: 0 0 auto; width: 26px; height: 26px; border-radius: 4px; cursor: pointer;
	display: inline-flex; align-items: center; justify-content: center; opacity: .4; font-size: 13px;
}
.qb-del:hover { opacity: 1; background: rgba(127,127,127,.22); }
.qb-del-gap { cursor: default; }
.qb-del-gap:hover { background: none; }

/* A saved search as one row: the picker spans the four value columns, the fold
   sits in the grip column past the trash. */
.qb-sel.qb-saved { flex: 1 1 auto; }
.qb-saved-icon { flex: 0 0 auto; font-size: 13px; color: var(--color-primary-500, var(--ed-button-primary-bg, #4caea1)); }
.qb-edited { flex: 0 0 auto; font-size: 10.5px; opacity: .55; }
.qb-row > .qb-rowfold { margin-left: 0; }

/* The saved-search library: Thymer's picker rows plus section headers. */
.qb-menu.qb-lib { padding-bottom: 6px; }
.qb-lib-scroll { overflow-y: auto; scrollbar-width: none; }
.qb-lib-scroll::-webkit-scrollbar { width: 0; height: 0; }
.qb-lib-sec {
	display: flex; align-items: center; gap: 6px; height: 26px; margin-top: 4px; padding: 0 10px;
	cursor: pointer; font-size: 10.5px; letter-spacing: .04em; text-transform: uppercase; font-weight: 600; opacity: .45;
}
.qb-lib-sec:hover { opacity: .75; }
/* The chevron gets the rows' 16px icon box, and the rows step in by that box plus
   the gap, so every bookmark sits under its section's name. */
.qb-lib-sec .ti { flex: 0 0 16px; width: 16px; display: inline-flex; justify-content: center; font-size: 11px; }
.qb-lib .qb-lib-item, .qb-lib .qb-lib-new { padding-left: 32px; }
.qb-lib-count { margin-left: auto; font-size: 11px; font-weight: 400; letter-spacing: 0; }
.qb-lib-item .autocomplete--option-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qb-lib-icon .ti, .qb-lib-new .ti { color: var(--color-primary-500, var(--ed-button-primary-bg, #4caea1)); }
.autocomplete--option-selected .qb-lib-icon .ti, .qb-lib-new.autocomplete--option-selected .ti { color: inherit; }
.qb-lib-sub { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: .5; font-size: 11px; }
/* Present on every row and shown on the highlighted one, so nothing reflows as
   the highlight moves; the negative margin keeps the 22px buttons inside the
   native 26px row. */
.qb-lib-act, .qb-lib-grip {
	display: inline-flex; visibility: hidden; flex: 0 0 auto; width: 22px; height: 22px; margin: -3px 0;
	border-radius: 4px; align-items: center; justify-content: center; font-size: 13px; opacity: .85; cursor: pointer;
}
.autocomplete--option-selected .qb-lib-act, .autocomplete--option-selected .qb-lib-grip { visibility: visible; }
.qb-lib-act:hover { opacity: 1; background: rgba(255,255,255,.15); }
html.is-light .qb-lib-act:hover { background: rgba(0,0,0,.08); }
.qb-lib-grip { cursor: grab; opacity: .6; }
.autocomplete--option-selected .qb-lib-grip.qb-lib-grip-off { visibility: hidden; }
.qb-lib-rename {
	flex: 1 1 auto; min-width: 0; height: 22px; padding: 0 6px; border-radius: 4px; outline: none;
	font: inherit; color: inherit; background: transparent; border: 1px solid rgba(255,255,255,.45);
}
html.is-light .qb-lib-rename { border-color: rgba(0,0,0,.3); }
.qb-lib-dragging { opacity: .35; }
.qb-lib-dropline { height: 2px; margin: 0 10px; border-radius: 1px; background: var(--color-primary-500, var(--ed-button-primary-bg, #4caea1)); }
.qb-lib-foot { border-top: 1px solid rgba(127,127,127,.18); margin-top: 4px; padding-top: 4px; }

/* ── Dropdown menus ──────────────────────────────────────────────────────
   Aligned to the control they belong to. Opaque #3B3B42 surface, 4px radius.
   Selected row #313E44 with contrast text; unselected #AFAFB0. */
/* The menus are built from Thymer's OWN picker markup (cmdpal--inline >
   cmdpal--inline-input + autocomplete > vscroll-node > vcontent >
   autocomplete--option), so every surface, row metric, selected fill, scroll
   behaviour and hover comes from the app itself. Nothing here restyles them —
   this block only positions them and carries the one deliberate exception. */
/* Thymer's own cmdpal--inline ships padding: 5px 0 0 — nothing at the bottom, which
   leaves the last row flush against the edge once the list is sized to its content.
   Mirror the top so the box breathes equally at both ends. (No backticks in here:
   this whole stylesheet lives inside a template literal.) */
.qb-menu { z-index: 100002; padding-bottom: 10px; border-radius: 4px; }
.qb-menu .vscroll-node { overflow-y: auto; scrollbar-width: none; }
.qb-menu .vscroll-node::-webkit-scrollbar { width: 0; height: 0; }
.qb-menu .autocomplete--option { cursor: pointer; }
.qb-menu .autocomplete--option { gap: 11px; }
/* The search box reads BIGGER than the rows below it even though native gives both
   --text-size-small: the input is set in the mono face and the rows inherit the
   menu's, and mono is wider at the same size. One step down the app's own scale
   evens them out. (Matching the FAMILY instead would be the other way to do it.) */
.qb-menu .cmdpal--inline-input { font-size: var(--text-size-smaller, .8125rem); }
.qb-menu-empty { padding: 6px 10px; opacity: .6; }
/* One icon box for every row, whatever is in it: a ti glyph, an operator symbol or
   a colour dot. Without a fixed box each one sized itself and the column came out
   ragged. 16px is native's own icon size (.autocomplete--option-icon in the app's
   stylesheet), and centring is what lines up glyphs of different widths. */
.qb-menu .autocomplete--option-icon {
	flex: 0 0 16px; width: 16px; min-width: 16px; height: 16px;
	display: inline-flex; align-items: center; justify-content: center;
}
.qb-menu .autocomplete--option-icon > .ti { line-height: 1; }
.qb-mi-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: currentColor; }

/* The and/or toggle is the one menu that keeps Parham's own palette. */
.qb-menu.qb-menu-dark .autocomplete--option { color: #AFAFB0; justify-content: center; font-weight: 600; letter-spacing: .04em; }
.qb-menu.qb-menu-dark .autocomplete--option:hover { background: #3B3B42; }
.qb-menu.qb-menu-dark .autocomplete--option-selected,
.qb-menu.qb-menu-dark .autocomplete--option-selected:hover { background: #313E44; color: var(--ed-button-primary-bg, #4caea1); }
/* The same menu on a light theme: the palette above is dark-only. */
html.is-light .qb-menu.qb-menu-dark .autocomplete--option { color: color-mix(in srgb, var(--text-color, #222) 65%, transparent); }
html.is-light .qb-menu.qb-menu-dark .autocomplete--option:hover { background: rgba(0,0,0,.06); }
html.is-light .qb-menu.qb-menu-dark .autocomplete--option-selected,
html.is-light .qb-menu.qb-menu-dark .autocomplete--option-selected:hover { background: color-mix(in srgb, var(--color-primary-500, #4caea1) 16%, transparent); color: var(--color-primary-500, #4caea1); }
/* NOT excludes, so it is marked as the destructive choice — in Thymer's own enum
   red rather than a hex, both in the menu and on the control once it is chosen. */
.qb-menu.qb-menu-dark .autocomplete--option[data-v="NOT"],
.qb-menu.qb-menu-dark .autocomplete--option-selected[data-v="NOT"],
.qb-menu.qb-menu-dark .autocomplete--option-selected[data-v="NOT"]:hover { color: var(--enum-red-fg, #e06c6c); }
.qb-join-not .qb-sel-label, .qb-leadtxt.qb-not { color: var(--enum-red-fg, #e06c6c); opacity: 1; }
.qb-actions { display: flex; align-items: center; gap: 14px; padding: 6px 0 2px; }
.qb-add {
	display: inline-flex; align-items: center; gap: 5px; cursor: pointer;
	font-size: 11.5px; color: var(--ed-button-primary-bg, #4caea1); background: none; border: none;
	font-family: inherit; padding: 4px 0;
}
.qb-add:hover { filter: brightness(1.2); }
.qb-empty { padding: 6px 0 10px; font-size: 11.5px; opacity: .45; }
.qb-foot {
	flex: 0 0 auto; border-top: 1px solid rgba(127,127,127,.18);
	background: rgba(127,127,127,.07); padding: 9px 14px;
	display: flex; align-items: center; gap: 10px;
}
.qb-preview {
	flex: 1 1 auto; min-width: 0; font-size: 11px; opacity: .55;
	white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
/* Takes the slack the query string used to fill, so the buttons keep their place. */
.qb-hitsline { flex: 1 1 auto; min-width: 0; font-size: 11px; opacity: .55; }
.qb-hits { flex: 0 0 auto; font-size: 11px; opacity: .8; font-weight: 600; }
.qb-btn {
	height: 28px; padding: 0 12px; border-radius: 4px; cursor: pointer; white-space: nowrap;
	font-family: inherit; font-size: 11.5px; font-weight: 600;
	border: 1px solid rgba(127,127,127,.28);
	background: var(--ed-button-bg, transparent); color: var(--ed-button-color, var(--text-color, #ddd));
}
.qb-btn:hover { filter: brightness(1.18); }
.qb-btn-primary {
	background: var(--cmdpal-selected-bg-color, var(--ed-button-primary-bg, #3aa37f));
	color: var(--cmdpal-selected-fg-color, #fff); border-color: transparent;
}
.qb-name {
	height: 28px; padding: 0 8px; border-radius: 4px; font-family: inherit; font-size: 11.5px;
	background: transparent; color: var(--cmdpal-fg-color, var(--text-color, #eee));
	border: 1px solid rgba(127,127,127,.28); outline: none; flex: 1 1 190px; min-width: 0;
}
/* Naming stacks: the title on one line, scope and the buttons on the next, so
   "Show in" has room to say a real view name instead of being squeezed out. */
.qb-foot-naming { flex-direction: column; align-items: stretch; gap: 8px; }
.qb-foot-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.qb-foot-spacer { flex: 1 1 auto; }
.qb-scope { display: flex; align-items: center; gap: 8px; min-width: 0; }
.qb-scope-label { flex: 0 0 auto; font-size: 11px; opacity: .55; }
.qb-sel.qb-scope-sel { flex: 0 0 auto; min-width: 150px; max-width: 260px; }

/* Every level is a full-width BOX of the same shape — the level's own conditions
   plus the buttons that add to it. Nested groups are boxes too, not indented ones,
   so every row's controls stay on one grid however deep you go. */
.qb-block {
	border: 1px solid rgba(127,127,127,.28); border-radius: 4px;
	background: #25252A; padding: 10px 12px 2px; margin-bottom: 8px;
	position: relative;
}
/* #25252A is the dark palette; a light theme gets the same step from its own text colour. */
html.is-light .qb-block { background: color-mix(in srgb, var(--text-color, #222) 4%, transparent); }
/* Collapsible BOXES (his correction of the first fold design: every visible
   group folds to its OWN framed one-liner, never merged into a parent's).
   The chevron lives in a slim gutter on the box's right edge. */
/* ONE geometry for the right edge, so the trashes line up in a column and the
   fold buttons line up in the next one — across condition rows, group header
   rows and the root's own box ("aligna alla papperskorgar, även i
   huvudmenyn … samma sak med chevronknapparna"). The numbers are tied: a box
   reserves 25px + its 1px border, a header row 26px, and the fold button is
   22px wide sitting 4px from the edge in both. */
.qb-block:not(.qb-folded) { padding-right: 3px; }
.qb-rowfold, .qb-boxfold, .qb-folded-chev {
	box-sizing: border-box; width: 22px; height: 22px; border-radius: 4px;
	display: inline-flex; align-items: center; justify-content: center;
	font-size: 12px; cursor: pointer; opacity: .55;
	background: var(--ed-button-bg, rgba(127,127,127,.10));
	border: 1px solid rgba(127,127,127,.28);
}
.qb-rowfold:hover, .qb-boxfold:hover, .qb-folded-chev:hover { opacity: 1; }
/* The row's fold sits past the trash; the box's is absolute in the gutter it
   reserved. Both land on the same vertical line. */
.qb-rowfold { flex: 0 0 auto; margin-left: 6px; }
.qb-folded-chev { flex: 0 0 auto; margin-left: 4px; }
.qb-boxfold { position: absolute; top: 13px; right: 3px; }
/* Indent / outdent a GROUP lives ONLY on its header row, next to the reorder
   arrows (his call 2026-08-14 — arrows on the boxes read as duplicate
   controls; a one-child stack's header IS the child's visible handle). */
.qb-block.qb-folded { padding: 6px 3px 6px 12px; cursor: pointer; }
/* NESTING IS VISIBLE now: each depth steps 14px right — boxes and their
   header rows alike. Flat rendering hid which group sat inside which, and it
   misled him three times (last: a group he built as a sibling was actually
   nested, and the wrap button "disappeared"). This is the box EDGE moving,
   not the old width-eating row indentation he rejected. */
/* A SELECTED group (click its header or a box's background): accent ring on
   its header and boxes — a visual "this is one unit". Indent/outdent live on
   the box's own arrows now, not on Tab (the hijack broke column tabbing). */
.qb-joinrow.qb-selected, .qb-block.qb-selected, .qb-row.qb-selected {
	outline: 1px solid var(--ed-button-primary-bg, #4caea1);
	outline-offset: 1px; border-radius: 4px;
}
.qb-block.qb-depth-1, .qb-joinrow.qb-depth-1 { margin-left: 14px; }
.qb-block.qb-depth-2, .qb-joinrow.qb-depth-2 { margin-left: 28px; }
.qb-block.qb-depth-3, .qb-joinrow.qb-depth-3 { margin-left: 42px; }
.qb-block.qb-folded .qb-row { margin-bottom: 0; }

.qb-block .qb-actions { padding: 2px 0 8px; }
/* ONE tone for every box, at every level. The tone difference was mine, an attempt
   to hint at depth in a layout where nothing is indented — but two groups on the
   same level are already told apart by their border and the joiner row between
   them, so a second colour only claimed a difference that is not there (his
   observation, and he is right). The depth classes stay on the elements as the
   hook if a cue is ever needed again. KNOWN CONSEQUENCE: at the second level of
   nesting the boxes are DOM siblings, so nothing now says which one sits inside
   which. If that ever bites, the structural fix is to render a nested group's box
   INSIDE its parent's rather than to bring a colour back. */
/* A level whose children are ALL groups has no box of its own to put its buttons
   in; they sit under the groups, on the same grid as everything else. */

/* ── Narrow screens ──────────────────────────────────────────────────────
   A condition row is five fixed columns that add up to ~650px and do not wrap,
   so on a phone the value control ran off the panel's right edge. Here the row
   STACKS instead: the lead and the delete share the first line, every control
   gets its own full-width line under it. Triggered by Thymer's own device flag
   AND by a width query, so a narrow window on the desktop behaves the same. */
@media (max-width: 640px) {
	.qb-pop { width: calc(100vw - 12px); }
	.qb-row { flex-wrap: wrap; align-items: stretch; gap: 5px; }
	.qb-row > .qb-lead { flex: 1 1 auto; text-align: left; padding: 2px 0 0 2px; }
	.qb-row > .qb-del { margin-left: auto; }
		/* Two per line: collection + field, then operator + value. Stacking all four
	   full width made a single condition five lines tall. */
	.qb-src, .qb-field, .qb-op, .qb-val, .qb-sel.qb-val-sel, .qb-datewrap { flex: 1 1 calc(50% - 3px); min-width: 0; }
	/* the and/or button sizes to its word instead of filling the lead column */
	.qb-join { width: auto; margin-right: 0; padding: 0 10px; min-width: 64px; }
	.qb-join .qb-chev { right: 4px; }
	.qb-block { padding: 8px 8px 2px; }
	.qb-joinrow { padding: 0 9px; }
	.qb-actions { flex-wrap: wrap; gap: 8px 14px; }
	.qb-foot { flex-wrap: wrap; }
	.qb-scope-sel { min-width: 0; }
}
html[data-device=mobile] .qb-pop { width: calc(100vw - 12px); }
html[data-device=mobile] .qb-row { flex-wrap: wrap; align-items: stretch; gap: 5px; }
html[data-device=mobile] .qb-row > .qb-lead { flex: 1 1 auto; text-align: left; padding: 2px 0 0 2px; }
html[data-device=mobile] .qb-row > .qb-del { margin-left: auto; }
html[data-device=mobile] .qb-src,
html[data-device=mobile] .qb-field,
html[data-device=mobile] .qb-op,
html[data-device=mobile] .qb-val,
html[data-device=mobile] .qb-sel.qb-val-sel,
html[data-device=mobile] .qb-join { width: auto; margin-right: 0; padding: 0 10px; min-width: 64px; }
html[data-device=mobile] .qb-join .qb-chev { right: 4px; }
html[data-device=mobile] .qb-block { padding: 8px 8px 2px; }
html[data-device=mobile] .qb-joinrow { padding: 0 9px; }
html[data-device=mobile] .qb-actions { flex-wrap: wrap; gap: 8px 14px; }
html[data-device=mobile] .qb-foot { flex-wrap: wrap; }
html[data-device=mobile] .qb-scope-sel { min-width: 0; }
/* The divider between a box and the group under it: joiner left on the same grid
   as every row's lead, the group's delete right. The padding is the box's own
   inset (12px padding + its 1px border), so the joiner lands on exactly the same x
   as every "Where" inside the boxes above and below it, and its trash lines up
   with theirs. Measured, not guessed: without it the row sat 13px further left. */
.qb-joinrow { display: flex; align-items: center; margin: 0 0 8px; padding: 0 4px 0 13px; }
/* A first child's header exists ONLY to carry its un-indent arrow — no
   joiner, no reorder arrows, no trash. Slimmed and pulled tight against the
   box below so it reads as that box's control, not as the empty band he had
   removed ("det räcker med indenteringen för att visa att det är en stack"). */
.qb-joinrow.qb-joinrow-bare { margin: -4px 0 0; }
.qb-joinrow.qb-joinrow-bare .qb-del { height: 20px; }
.qb-joinrow-fill { flex: 1 1 auto; }
`;

// The full date box for builders' date fields when Supertask cannot open its own
// (see _qbOpenCal). Generated, never edited here; its CSS is SSDB_CSS below.
// <<<SHARED date-box — GENERATED from supertask/plugin.js by ../tools/sync-datebox.py. DO NOT EDIT HERE.

// ── SsDateBox: SUPERTASK'S DATE BOX, EXTRACTED VERBATIM, in a FIELD shell
// (his call 2026-10-29: the full box must be in this plugin for people without
// Supertask). The host opens it only when Supertask cannot open its own box for
// a field (no __rsDateBox.pickField), so there is still ONE box on the page.
// It writes nothing: the picked date goes to the field's onPick, Clear sends
// null. Repeat and + End date are hidden by the host after it opens.
const RECUR_DAYNAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const RECUR_MONTHNAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function recurLabel(rule) {
	const base = recurLabelBase(rule);
	if (!rule || !rule.f || !rule.u) return base;
	return base + ' until ' + (rule.u % 100) + ' ' + RECUR_MONTHNAMES[Math.floor(rule.u / 100) % 100 - 1] + ' ' + Math.floor(rule.u / 10000);
}
function recurNthOccurrence(rule, anchorYmd, n) {
	if (!rule || !rule.f || rule.from === 'c' || !anchorYmd || !n || n < 1) return 0;
	let cur = anchorYmd;
	for (let i = 1; i < Math.min(n, 500); i++) {
		const next = recurNext(rule, cur);
		if (!next || next <= cur) return 0;
		cur = next;
	}
	return cur;
}
function rsRuleKey(r) {
	if (!r || !r.f) return '';
	const k = { f: r.f, n: r.n || 1 };
	if (r.from === 'c') k.from = 'c';
	for (const x of ['wd', 'md', 'mo']) if (Array.isArray(r[x]) && r[x].length) k[x] = r[x].slice().sort((a, b) => a - b);
	if (r.ord) { k.ord = r.ord; k.od = r.od; }
	if (r.aftN) k.aftN = r.aftN; else if (r.u) k.u = r.u;
	if (r.tr) k.tr = r.tr;
	if (r.nt) k.nt = r.nt;
	return JSON.stringify(k, Object.keys(k).sort());
}
function rsTouchUI() {
	try {
		if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return true;
		/* NOT WIDTH (his 2026-10-08 report): Quick Capture's ⌘⇧Y panel is a
		 * narrow web window driven by a mouse, and the old `innerWidth <= 700`
		 * fallback gave it the touch box. The phone fallback is Thymer's own
		 * verdict now, and the capture panel never takes the touch shape. */
		if (document.body && document.body.classList.contains('qc-panel-mode')) return false;
		/* data-mobile-type alone is width (phone under 740 px, playbook), so it
		 * also needs Thymer to call the DEVICE mobile */
		const h = document.documentElement;
		return h.getAttribute('data-device') === 'mobile' && h.getAttribute('data-mobile-type') === 'phone';
	} catch (e) { return false; }
}
function recurLabelBase(rule) {
	if (!rule || !rule.f) return 'Never';
	if (rule.from === 'c') {
		const n2 = Math.max(1, rule.n || 1);
		const unit = { d: 'day', w: 'week', m: 'month', y: 'year' }[rule.f];
		return (n2 === 1 ? 'Every ' + unit : 'Every ' + n2 + ' ' + unit + 's') + ' after completion';
	}
	const n = Math.max(1, rule.n || 1);
	const every = (unit) => (n === 1 ? 'Every ' + unit : 'Every ' + n + ' ' + unit + 's');
	const ordPart = () => RECUR_ORDNAMES[String(rule.ord)] + ' '
		+ (typeof rule.od === 'number' ? RECUR_DAYNAMES[rule.od] : rule.od === 'weekday' ? 'weekday' : rule.od === 'weekendday' ? 'weekend day' : 'day');
	if (rule.f === 'd') return every('day');
	if (rule.f === 'w') {
		const wd = (rule.wd && rule.wd.length ? rule.wd : []).slice().sort((x, y) => x - y);
		return every('week') + (wd.length ? ' on ' + wd.map((i) => RECUR_DAYNAMES[i]).join(', ') : '');
	}
	if (rule.f === 'm') {
		if (rule.ord) return every('month') + ' on the ' + ordPart();
		const md = (rule.md && rule.md.length ? rule.md : []).slice().sort((x, y) => x - y);
		return every('month') + (md.length ? ' on the ' + md.join(', ') : '');
	}
	if (rule.f === 'y') {
		const mo = (rule.mo && rule.mo.length ? rule.mo : []).slice().sort((x, y) => x - y);
		return every('year') + (mo.length ? ' in ' + mo.map((i) => RECUR_MONTHNAMES[i]).join(', ') : '')
			+ (rule.ord ? ' on the ' + ordPart() : '');
	}
	return 'Never';
}
function recurNext(rule, fromYmd) {
	if (!rule || !rule.f) return 0;
	const n = Math.max(1, rule.n || 1);
	const horizon = rule.f === 'y' ? 366 * (n + 1) + 400 : rule.f === 'm' ? 31 * (n + 1) + 400 : 366 * 2;
	let d = recurYmdToDate(Math.max(fromYmd, rule.a || fromYmd));
	if (recurDateToYmd(d) <= fromYmd) d.setDate(d.getDate() + 1);
	for (let i = 0; i < horizon; i++) {
		const ymd = recurDateToYmd(d);
		if (ymd > fromYmd && recurMatches(rule, ymd)) return ymd;
		d.setDate(d.getDate() + 1);
	}
	return 0;
}
const RECUR_ORDNAMES = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', '-2': 'next to last', '-1': 'last' };
function recurDateToYmd(d) { return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }
function recurMatches(rule, ymd) {
	if (!rule || !rule.f || !rule.a) return false;
	const n = Math.max(1, rule.n || 1);
	const d = recurYmdToDate(ymd);
	const a = recurYmdToDate(rule.a);
	if (ymd < rule.a) return false;

	const dayOfMonthOk = () => {
		if (rule.ord) return d.getDate() === recurOrdinalDay(d, rule.ord, rule.od);
		const md = rule.md && rule.md.length ? rule.md : [a.getDate()];
		if (md.indexOf(d.getDate()) >= 0) return true;
		/* a 31st rule still has to fire in a 30-day month, so clamp to the end */
		const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
		return d.getDate() === last && md.some((x) => x > last);
	};

	if (rule.f === 'd') {
		const days = Math.round((d - a) / 86400000);
		return days >= 0 && days % n === 0;
	}
	if (rule.f === 'w') {
		const wd = rule.wd && rule.wd.length ? rule.wd : [recurWeekday(a)];
		if (wd.indexOf(recurWeekday(d)) < 0) return false;
		const weeks = Math.round((recurWeekStart(d) - recurWeekStart(a)) / 604800000);
		return weeks >= 0 && weeks % n === 0;
	}
	if (rule.f === 'm') {
		const months = (d.getFullYear() - a.getFullYear()) * 12 + (d.getMonth() - a.getMonth());
		return months >= 0 && months % n === 0 && dayOfMonthOk();
	}
	if (rule.f === 'y') {
		const years = d.getFullYear() - a.getFullYear();
		if (years < 0 || years % n !== 0) return false;
		const mo = rule.mo && rule.mo.length ? rule.mo : [a.getMonth()];
		if (mo.indexOf(d.getMonth()) < 0) return false;
		return dayOfMonthOk();
	}
	return false;
}
function recurYmdToDate(n) { return new Date(Math.floor(n / 10000), (Math.floor(n / 100) % 100) - 1, n % 100); }
function recurOrdinalDay(d, ord, od) {
	const y = d.getFullYear();
	const m = d.getMonth();
	const last = new Date(y, m + 1, 0).getDate();
	const days = [];
	for (let day = 1; day <= last; day++) {
		const wd = recurWeekday(new Date(y, m, day));
		let ok;
		if (od === 'day') ok = true;
		else if (od === 'weekday') ok = wd <= 4;
		else if (od === 'weekendday') ok = wd >= 5;
		else ok = wd === od;
		if (ok) days.push(day);
	}
	if (!days.length) return 0;
	if (ord > 0) return days[ord - 1] || 0;
	return days[days.length + ord] || 0; /* -1 last, -2 next to last */
}
function recurWeekStart(d) {
	const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
	x.setDate(x.getDate() - recurWeekday(x));
	return x;
}
function recurWeekday(d) { return (d.getDay() + 6) % 7; }
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
class SsDateBox {
	constructor() {
		this.pop = null; this.repMenu = null; this.rule = null; this.sel = null;
		this.view = null; this.rangeEnd = null; this.endMode = false;
		this.popKeys = null; this.outside = null; this.cancelPicker = null;
		this.showPicker = null; this.nameTpl = null; this.nameBase = null;
		this.endPickedAt = 0;
	}
	toast(m) { try { console.warn('[date box] ' + m); } catch (e) {} }
	currentDate(t) { return t.cur || null; }
	targetLabel(t) { return (t && t.label) || 'Date'; }
	async writeDate(t, dt) { t.onPick(dt); return true; }
	async clearDate(t) { t.onPick(null); return true; }
	/* under the field's control, left edges aligned; above it when it does not fit */
	place(pop, t) {
		const w = pop.offsetWidth || 320;
		const h = pop.offsetHeight || 400;
		const a = t.anchorEl && t.anchorEl.isConnected ? t.anchorEl.getBoundingClientRect() : null;
		if (!a) {
			pop.style.left = Math.max(8, (window.innerWidth - w) / 2) + 'px';
			pop.style.top = '90px';
			return;
		}
		const left = Math.max(8, Math.min(a.left, window.innerWidth - w - 8));
		let top = a.bottom + 4;
		if (top + h > window.innerHeight - 8) top = a.top - h - 4;
		pop.style.left = left + 'px';
		pop.style.top = Math.max(8, Math.min(top, window.innerHeight - h - 8)) + 'px';
	}
	/* The calendar is built from Thymer's OWN datepicker markup and class names
	 * (.datepicker-wrapper > .datepicker-calendar > .datepicker-header /
	 * -weekdays / -days, day cells as <div class="day current-month selected
	 * today"><span class="day-inner">), because those rules live in the app's
	 * global stylesheet and are not scoped to a shadow root. Reusing them means
	 * Thymer styles this picker itself — verified live: with the wrapper present
	 * the cells pick up --day-height, the selected day gets
	 * --button-primary-bg-color and today gets --text-hilite. Style nothing here
	 * that Thymer already styles, or the two will drift apart on a theme change.
	 * `.datepicker-compact` is the in-menu density, which is what the native
	 * "Assign due date" popup uses. */
	openPicker(t) {
		this.closePicker();

		const pop = document.createElement('div');
		pop.className = 'rs-pop';
		/* the wrapper lives INSIDE the popup, never on it: .datepicker-compact
		 * carries width:100% and would otherwise stretch the box to the window */
		pop.innerHTML = `
			<div class="rs-head"></div>
			<input class="rs-input" type="text" spellcheck="false" placeholder="today, Aug 1, monday 3pm">
			<div class="datepicker-wrapper datepicker-compact"><div class="datepicker-calendar">
				<div class="datepicker-header">
					<span class="current-month" style="flex:1"></span>
					<span style="display:flex; gap:10px">
						<button class="button-none button-small button-minimal-hover prev-month"><span class="ti ti-chevron-left"></span></button>
						<button class="button-none button-small button-minimal-hover go-to-today"><span class="ti ti-point"></span></button>
						<button class="button-none button-small button-minimal-hover next-month"><span class="ti ti-chevron-right"></span></button>
					</span>
				</div>
				<div class="datepicker-weekdays"></div>
				<div class="datepicker-days"></div>
				<div class="datepicker-time">
					<div class="rs-timerow">
						<div class="rs-timetoggle">
							<input-switch class="rs-switch switch-compact"></input-switch>
							<span class="rs-timelbl">Set time</span>
							<input class="rs-time" type="time" style="display:none">
						</div>
						<div class="button-minimal-hover button-none button-small rs-addend">+ End date</div>
					</div>
				</div>
			</div></div>
			<div class="rs-reprow rs-repbtn">
				<span style="opacity:.6">Repeat</span>
				<span class="rs-repval"><span class="rs-repnow"></span><span class="ti ti-chevron-right" style="opacity:.45"></span></span>
			</div>
			<div class="rs-custom" style="display:none">
				<label><span>Frequency</span><span class="rs-sel rs-freq" data-v="d"><span class="rs-sel-lbl">Daily</span><span class="ti ti-chevron-down"></span></span></label>
				<label><span>Every</span><input class="rs-int" type="number" min="1" max="99" value="1"><span class="rs-unit">days</span></label>
				<div class="rs-gram rs-gram-w" style="display:none"><div class="rs-days"></div></div>
				<div class="rs-gram rs-gram-m" style="display:none">
					<label><input type="radio" name="rs-mmode" value="each" checked>Each</label>
					<div class="rs-mdays"></div>
					<label><input type="radio" name="rs-mmode" value="ord">On the</label>
					<div class="rs-ordrow rs-mordrow">
						<span class="rs-sel rs-mord" data-v="1"><span class="rs-sel-lbl">first</span><span class="ti ti-chevron-down"></span></span>
						<span class="rs-sel rs-mod" data-v="day"><span class="rs-sel-lbl">day</span><span class="ti ti-chevron-down"></span></span>
					</div>
				</div>
				<div class="rs-gram rs-gram-y" style="display:none">
					<div class="rs-months"></div>
					<label><input type="checkbox" class="rs-ycheck">On the</label>
					<div class="rs-ordrow rs-yordrow">
						<span class="rs-sel rs-yordsel" data-v="1"><span class="rs-sel-lbl">first</span><span class="ti ti-chevron-down"></span></span>
						<span class="rs-sel rs-yod" data-v="day"><span class="rs-sel-lbl">day</span><span class="ti ti-chevron-down"></span></span>
					</div>
				</div>
				<label class="rs-fromrow" title="Day selections always repeat on schedule — Count from applies to plain intervals only"><span>Count From</span><span class="rs-sel rs-from" data-v="a"><span class="rs-sel-lbl">The Due Date</span><span class="ti ti-chevron-down"></span></span></label>
				<label title="When the SERIES stops. + End date up top is different: it makes each occurrence a date RANGE."><span>End Repeat</span><span class="rs-sel rs-endsel" data-v=""><span class="rs-sel-lbl">Never</span><span class="ti ti-chevron-down"></span></span><input class="rs-cnt" type="number" min="1" max="100" value="3" style="display:none"><input class="rs-until" type="text" spellcheck="false" style="display:none"></label>
			</div>
			<div class="rs-foot">
				<span class="rs-result"></span>
				<span class="button-none button-small button-minimal-hover rs-clear">Clear</span>
			</div>`;
		pop.querySelector('.rs-head').textContent = this.targetLabel(t);
		/* TOUCH shape. Appended BEFORE the box is measured, so place() sees the
		 * real height and the box never lands half off-screen. */
		const rsTouch = rsTouchUI();
		if (rsTouch) {
			pop.classList.add('rs-touch');
			const strip = document.createElement('div');
			strip.className = 'rs-tbtns';
			strip.innerHTML = '<div class="rs-tbtn rs-tsave">Save</div><div class="rs-tbtn rs-tclear">Clear</div>';
			pop.appendChild(strip);
		}
		document.body.appendChild(pop);
		this.shieldKeys(pop);
		this.pop = pop;

		const input = pop.querySelector('.rs-input');
		const timeInput = pop.querySelector('.rs-time');
		const sw = pop.querySelector('.rs-switch');
		let cur = this.currentDate(t);

		/* Preselect: the date already set, else TODAY — so opening the box and
		 * pressing Enter schedules today without touching the mouse. */
		let start = cur || new DateTime(new Date());
		let sp = start.getParts();
		/* a TIME-ONLY date (hours without a year) NaN:ed the whole calendar
		 * ("Invalid Date", his split-view screenshot) — treat it as today at
		 * that time */
		let timeOnly = false;
		if (sp.year === undefined) {
			const nd = new Date();
			timeOnly = sp.hours !== undefined;
			start = timeOnly
				? DateTime.dateAndTime(nd.getFullYear(), nd.getMonth(), nd.getDate(), sp.hours, sp.minutes || 0, 0)
				: new DateTime(nd);
			sp = start.getParts();
			cur = null;
		}
		this.view = { y: sp.year, m: sp.month };
		this.sel = cur || DateTime.dateOnly(sp.year, sp.month, sp.day);
		this.endMode = false;
		this.rangeEnd = cur ? cur.getRangeEnd() : null;
		/* a time-only line still SHOWS its time (his report 2026-08-28: the
		 * box opened with Set time off although the row said 11:00 - 12:00) */
		if ((cur || timeOnly) && sp.hours !== undefined) {
			sw.checked = true;
			timeInput.style.display = '';
			timeInput.value = String(sp.hours).padStart(2, '0') + ':' + String(sp.minutes || 0).padStart(2, '0');
		}

		let committed = false;
		const commit = (dt) => {
			if (committed) return; /* one box, one write */
			committed = true;
			/* capture the repeat rule BEFORE closePicker clears the picker state */
			t.pendingRule = this.rule ? { ...this.rule } : null;
			/* ONLY when something in the Repeat part changed (his 2026-10-28
			 * ask, Apple's "this event only"): picking a day writes the date and
			 * leaves the rule, its anchor and a forward trail's copies alone */
			t.ruleChanged = rsRuleKey(this.rule) !== this.ruleSnap;
			t.ruleTouched = t.ruleChanged || !!t.wireTouched;
			this.closePicker();
			this.writeDate(t, dt).catch((e) => this.toast('Failed: ' + ((e && e.message) || e)));
		};

		/* Closing WITHOUT committing: these rows are not editor lines, so
		 * there is no caret to restore — just close. */
		this.cancelPicker = () => { this.closePicker(); };

		/* Whatever is picked or typed, the time toggle and the end date are
		 * re-applied on top, so switching one never silently drops the others. */
		const compose = () => {
			if (!this.sel) return null;
			const p = this.sel.getParts();
			if (p.year === undefined) return this.sel;
			let dt = DateTime.dateOnly(p.year, p.month, p.day);
			if (sw.checked && timeInput.value) {
				const [hh, mm] = timeInput.value.split(':').map(Number);
				dt = DateTime.dateAndTime(p.year, p.month, p.day, hh || 0, mm || 0, 0);
			}
			if (this.rangeEnd) {
				let re = this.rangeEnd;
				try {
					/* A SAME-DAY end is a DURATION, not a second date: when the
					 * picked day moves, it moves along (his broken chip
					 * 2026-08-28, "Fri Aug 28 - Thu Aug 27 22:30": the old end
					 * survived a new start). A multi-day end stays absolute,
					 * and an end at or before the start is never written. */
					const cs = cur && cur.getParts();
					const rp = re.getParts();
					if (cs && cs.year !== undefined && rp.year !== undefined
						&& rp.year === cs.year && rp.month === cs.month && rp.day === cs.day
						&& (p.year !== rp.year || p.month !== rp.month || p.day !== rp.day)) {
						re = rp.hours !== undefined
							? DateTime.dateAndTime(p.year, p.month, p.day, rp.hours, rp.minutes || 0, 0)
							: DateTime.dateOnly(p.year, p.month, p.day);
					}
				} catch (e) {}
				try {
					/* SET TIME OFF strips the END's clock too (his report
					 * 2026-08-29: the start lost its 12:15, the end kept it —
					 * "Fri Aug 28 - Fri Aug 28 12:15"). Without a clock a
					 * same-day end is no range at all and is dropped; a
					 * multi-day end survives as a plain date. */
					if (!sw.checked) {
						const rp2 = re.getParts();
						if (rp2.year !== undefined) {
							if (rp2.year === p.year && rp2.month === p.month && rp2.day === p.day) re = null;
							else if (rp2.hours !== undefined) re = DateTime.dateOnly(rp2.year, rp2.month, rp2.day);
						}
					}
				} catch (e) {}
				if (re && re.toDate() > dt.toDate()) dt.setRangeEnd(re);
			}
			return dt;
		};

		const show = () => {
			this.renderCal(pop);
			const dt = compose();
			const res = pop.querySelector('.rs-result');
			/* The field itself mirrors the selection (as its PLACEHOLDER, so the
			 * value stays empty — a real value would stop ←/→ driving the
			 * calendar and would have to be cleared before typing). He read the
			 * static syntax hint as a wrong date; the selection is more useful. */
			if (!input.value) input.placeholder = dt ? this.label(dt) : 'today, Aug 1, monday 3pm';
			if (this.endMode) {
				/* the OLD placement of this hint was inside the no-date branch, which
				 * never runs (today is always preselected) — so arming end-date mode
				 * gave no feedback at all and read as a dead button (his report) */
				res.textContent = 'Pick the end date in the calendar';
				res.classList.add('rs-bad');
			} else if (dt) {
				/* the footer mirrors the COMPOSED value, not this.rangeEnd raw:
				 * compose can drop or move the end (Set time off, a moved day)
				 * and the old preview kept showing an end that would never be
				 * written (his 12:15 report, 2026-08-29) */
				const de = dt.getRangeEnd ? dt.getRangeEnd() : null;
				res.textContent = this.label(dt) + (de ? ' → ' + this.label(de) : '');
				res.classList.remove('rs-bad');
			} else {
				res.textContent = input.value.trim() ? 'Not a date' : 'Pick a day or type a date';
				res.classList.add('rs-bad');
			}
			const addend = pop.querySelector('.rs-addend');
			addend.textContent = this.rangeEnd ? '− End date' : '+ End date';
			addend.classList.toggle('rs-armed', this.endMode);
			pop.querySelector('.rs-clear').style.display = cur ? '' : 'none';
			const tclr = pop.querySelector('.rs-tclear');
			if (tclr) tclr.style.display = cur ? '' : 'none';
		};
		this.showPicker = show;

		/* The time switch remembers whether TYPING turned it on. Every keystroke is
		 * parsed, and a half-typed year reads as a time: "25 aug 2" is 14:00,
		 * "25 aug 202" is 14:02, and the finished "25 aug 2026" has no time at all,
		 * yet the switch stayed on at 14:02 (his recording, 2026-10-11). When the
		 * text no longer holds a time, the switch and clock go back to what they
		 * were before the text took over (off, or the time already set); one he
		 * set himself (switch or clock) is his and stays. */
		let typedTime = false, beforeTyped = null;
		input.addEventListener('input', () => {
			const raw = input.value.trim();
			const parsed = raw ? DateTime.parseDateTimeString(raw)
				: (cur || DateTime.dateOnly(sp.year, sp.month, sp.day));
			if (parsed) {
				const p = parsed.getParts();
				if (p.year !== undefined) this.view = { y: p.year, m: p.month };
				/* typing "monday 3pm" should flip the time switch on by itself */
				if (p.hours !== undefined) {
					if (raw && !typedTime) beforeTyped = { on: sw.checked, v: timeInput.value };
					sw.checked = true;
					timeInput.style.display = '';
					timeInput.value = String(p.hours).padStart(2, '0') + ':' + String(p.minutes || 0).padStart(2, '0');
					typedTime = !!raw;
				} else if (typedTime) {
					sw.checked = !!(beforeTyped && beforeTyped.on);
					timeInput.style.display = sw.checked ? '' : 'none';
					timeInput.value = (beforeTyped && beforeTyped.v) || '';
					typedTime = false;
				}
			}
			/* Always mirror what is typed. Latching the range end here is what made
			 * "Aug 5" produce Aug 1–31: the keystrokes pass through "Aug", which
			 * parses as a whole-month RANGE, and the end date then survived into
			 * the finished single date. "5 aug" never passes through a range,
			 * which is why that spelling looked fine. */
			this.rangeEnd = parsed ? parsed.getRangeEnd() : null;
			this.sel = parsed;
			show();
		});
		const ARROWS = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
		/* Enter and Escape are handled on WINDOW (capture), not on the box: the
		 * native macOS <select> menu can close WITHOUT firing change (Esc, or
		 * re-picking the same value), and focus then ends up on <body> — a
		 * handler on the box never sees those keys, which is exactly "Enter goes
		 * dead after using Custom". On window it commits no matter where focus
		 * fell. Removed in closePicker. */
		this.popKeys = (e) => {
			if (!this.pop) return;
			if (e.key !== 'Enter' && e.key !== 'Escape') return;
			e.stopPropagation();
			/* an OPEN POPOVER (repeat menu, After-count, Name Copies) is a
			 * sub-state exactly like endMode: Enter and Escape close just the
			 * popover, never commit or close the box. The close must happen
			 * HERE — the stopPropagation above kills the event before the
			 * popover input's own handler would see it (live-verified: Enter
			 * in the count popover did nothing at all before this). */
			if (this.repMenu && this.repMenu.isConnected) {
				e.preventDefault();
				try { this.repMenu.remove(); } catch (e2) {}
				this.repMenu = null;
				input.focus({ preventScroll: true });
				return;
			}
			this.repMenu = null; /* a closed menu must not eat the next key (live-caught) */
			if (e.key === 'Escape') {
				e.preventDefault();
				/* an armed end-date mode is a sub-state: Escape backs out of IT
				 * first, and only a second Escape closes the box */
				if (this.endMode) { this.endMode = false; this.endHover = null; show(); return; }
				this.cancelPicker();
				return;
			}
			e.preventDefault();
			const dt = compose();
			if (dt) commit(dt);
		};
		window.addEventListener('keydown', this.popKeys, true);

		/* Enter and Escape live on the window handler above — do NOT also handle
		 * them here, or one keypress commits twice and the second pass overwrites
		 * the first with the state the first one already cleared. */
		input.addEventListener('keydown', (e) => {
			e.stopPropagation();
			if (e.key === 'Enter' || e.key === 'Escape') return;
			/* Arrows walk the calendar: ←/→ a day, ↑/↓ a week. Left and right are
			 * left alone once something is typed, so the text field stays
			 * editable; up and down never do anything useful in a one-line field
			 * so they always drive the calendar. */
			const step = ARROWS[e.key];
			if (step === undefined) return;
			const horizontal = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
			if (horizontal && input.value.length) return;
			e.preventDefault();
			const base = this.sel && this.sel.getParts().year !== undefined ? this.sel : new DateTime(new Date());
			const moved = this.shiftParts(base, step);
			if (!moved) return;
			this.sel = moved;
			const p = moved.getParts();
			this.view = { y: p.year, m: p.month };
			show();
		}, true);

		pop.querySelector('.datepicker-header').addEventListener('click', (e) => {
			const b = e.target.closest('button');
			if (!b) return;
			if (b.classList.contains('go-to-today')) { const d = new Date(); this.view = { y: d.getFullYear(), m: d.getMonth() }; }
			else {
				const d = new Date(this.view.y, this.view.m + (b.classList.contains('prev-month') ? -1 : 1), 1);
				this.view = { y: d.getFullYear(), m: d.getMonth() };
			}
			show();
		});

		pop.querySelector('.datepicker-days').addEventListener('click', (e) => {
			const cell = e.target.closest('.day[data-date]');
			if (!cell) return;
			if (cell.classList.contains('rs-dis')) return; /* not a legal end */
			const [y, m, d] = cell.getAttribute('data-date').split('-').map(Number);
			if (this.endMode) {
				this.rangeEnd = DateTime.dateOnly(y, m - 1, d);
				this.endMode = false;
				this.endHover = null;
				this.endPickedAt = Date.now();
				show();
				return;
			}
			/* the SECOND click of a double that just picked the end date must not
			 * fall through here — it would move the START to the end day and
			 * commit a collapsed range */
			if (e.detail >= 2 && this.endPickedAt && Date.now() - this.endPickedAt < 500) return;
			/* Clicking a day only SELECTS it. Committing on the click made Repeat
			 * unreachable with a mouse — the box was already gone. Enter commits,
			 * and so does a double click for anyone who never leaves the trackpad. */
			this.sel = DateTime.dateOnly(y, m - 1, d);
			show();
			if (e.detail >= 2) { const dt = compose(); if (dt) commit(dt); }
		});
		/* the hover preview drives the calendar only while END mode is armed */
		pop.querySelector('.datepicker-days').addEventListener('mousemove', (e) => {
			if (!this.endMode) return;
			const cell = e.target.closest('.day[data-date]');
			if (!cell || cell.classList.contains('rs-dis')) return;
			const [y, m, d] = cell.getAttribute('data-date').split('-').map(Number);
			const nd = new Date(y, m - 1, d);
			if (!this.endHover || this.endHover.getTime() !== nd.getTime()) { this.endHover = nd; show(); }
		});
		pop.querySelector('.datepicker-days').addEventListener('mouseleave', () => {
			if (this.endHover) { this.endHover = null; if (this.endMode) show(); }
		});

		sw.addEventListener('change', () => {
			typedTime = false;
			timeInput.style.display = sw.checked ? '' : 'none';
			if (sw.checked && !timeInput.value) timeInput.value = '09:00';
			show();
		});
		pop.querySelector('.rs-timelbl').addEventListener('click', () => {
			sw.checked = !sw.checked;
			sw.dispatchEvent(new Event('change'));
		});
		timeInput.addEventListener('input', () => { typedTime = false; show(); });
		/* + End date arms the mode (and shows it); clicking again disarms; once an
		 * end is set the same control reads "− End date" and removes it — there
		 * was previously no way to undo an end date short of retyping. */
		pop.querySelector('.rs-addend').addEventListener('click', () => {
			if (this.rangeEnd) { this.rangeEnd = null; this.endMode = false; }
			else this.endMode = !this.endMode;
			this.endHover = null;
			show();
		});
		pop.querySelector('.rs-clear').addEventListener('click', () => {
			this.closePicker();
			this.clearDate(t).catch((e) => this.toast('Failed: ' + ((e && e.message) || e)));
		});
		/* the touch pair does exactly what Enter and Clear do — one commit
		 * path, one clear path, no second implementation to drift */
		const tsave = pop.querySelector('.rs-tsave');
		if (tsave) tsave.addEventListener('click', () => { const dt = compose(); if (dt) commit(dt); });
		const tclear = pop.querySelector('.rs-tclear');
		if (tclear) tclear.addEventListener('click', () => {
			this.closePicker();
			this.clearDate(t).catch((e) => this.toast('Failed: ' + ((e && e.message) || e)));
		});

		/* ---- Repeat ---------------------------------------------------- */
		const repBtn = pop.querySelector('.rs-repbtn');
		const custom = pop.querySelector('.rs-custom');
		const freq = pop.querySelector('.rs-freq');
		const intv = pop.querySelector('.rs-int');
		const from = pop.querySelector('.rs-from');
		const UNITS = { d: 'day', w: 'week', m: 'month', y: 'year' };
		const FREQOPTS = [['d', 'Daily'], ['w', 'Weekly'], ['m', 'Monthly'], ['y', 'Yearly']];
		const FROMOPTS = [['a', 'The Due Date'], ['c', 'When I Tick It']];
		const ORDOPTS = [['1', 'first'], ['2', 'second'], ['3', 'third'], ['4', 'fourth'], ['5', 'fifth'], ['-2', 'next to last'], ['-1', 'last']];
		const ODOPTS = [['day', 'day'], ['weekday', 'weekday'], ['weekendday', 'weekend day'],
			['0', 'Monday'], ['1', 'Tuesday'], ['2', 'Wednesday'], ['3', 'Thursday'], ['4', 'Friday'], ['5', 'Saturday'], ['6', 'Sunday']];
		const odParse = (v) => (v === 'day' || v === 'weekday' || v === 'weekendday') ? v : +v;
		const selVal = (el) => el.getAttribute('data-v');
		const setSel = (el, v, opts) => {
			const o = opts.find((x) => x[0] === v) || opts[0];
			el.setAttribute('data-v', o[0]);
			el.querySelector('.rs-sel-lbl').textContent = o[1];
		};
		/* the three multi-select grids; single letters for days, like Apple's */
		pop.querySelector('.rs-days').innerHTML = RECUR_DAYNAMES.map((d, i) => '<div class="rs-cell" data-i="' + i + '">' + d[0] + '</div>').join('');
		let mdHtml = '';
		for (let d2 = 1; d2 <= 31; d2++) mdHtml += '<div class="rs-cell" data-i="' + d2 + '">' + d2 + '</div>';
		pop.querySelector('.rs-mdays').innerHTML = mdHtml;
		pop.querySelector('.rs-months').innerHTML = RECUR_MONTHNAMES.map((m2, i) => '<div class="rs-cell" data-i="' + i + '">' + m2 + '</div>').join('');
		this.rule = t.kind === 'line' && t.rule ? { ...t.rule } : null;
		/* what the rule was when the box opened: commit compares against it */
		this.ruleSnap = rsRuleKey(this.rule);
		t.wireTouched = false;
		this.nameTpl = null;
		/* Repeat is offered on TODO LINES only here (his ruling 2026-08-28):
		 * without Supertask a page cannot be ticked in the calendar, so a page
		 * rule could never advance — hide the row instead of lying. Supertask's
		 * own box covers page repeats whenever that plugin exists. */
		if (t.kind === 'record') {
			const rr = pop.querySelector('.rs-reprow');
			if (rr) rr.style.display = 'none';
		}

		const paintRepeat = () => {
			/* the value is ALWAYS shown, "Never" included, and styled as a button so
			 * it reads as the current setting you can change rather than a label —
			 * and a real rule lights up in the accent (his request) */
			const now = pop.querySelector('.rs-repnow');
			now.textContent = recurLabel(this.rule)
				+ (this.rule && this.rule.aftN && !this.rule.u ? ', ' + this.rule.aftN + ' times' : '');
			now.classList.toggle('rs-set', !!(this.rule && this.rule.f));
			const n = Math.max(1, (this.rule && this.rule.n) || 1);
			pop.querySelector('.rs-unit').textContent = UNITS[(this.rule && this.rule.f) || 'd'] + (n === 1 ? '' : 's');
		};
		const openRepeatMenu = () => {
			this.refreshMenuColors();
		document.querySelectorAll('.rs-repmenu').forEach((m) => m.remove());
			const menu = document.createElement('div');
			menu.className = 'rs-repmenu';
			const presets = [['', 'Never'], ['d', 'Every Day'], ['w', 'Every Week'], ['m', 'Every Month'], ['y', 'Every Year']];
			const cur = this.rule || {};
			/* a preset row is "on" only for the PLAIN version of its frequency; any
			 * grammar (weekdays, month days, ordinals, until, interval, mode)
			 * belongs to Custom */
			const plain = (cur.n || 1) === 1 && !cur.from && !cur.wd && !cur.md && !cur.mo && !cur.ord && !cur.u;
			menu.innerHTML = presets.map(([f, lbl]) =>
				'<div data-f="' + f + '"' + ((cur.f || '') === f && plain ? ' class="rs-on"' : '') + '>' + lbl + '</div>').join('')
				+ '<div data-f="custom"' + (cur.f && !plain ? ' class="rs-on"' : '')
				+ ' style="border-top:1px solid rgba(127,127,127,.25); margin-top:3px; padding-top:6px">Custom…</div>';
			document.body.appendChild(menu);
			const br = repBtn.getBoundingClientRect();
			const mh = menu.offsetHeight;
			const top = br.bottom + 4 + mh > window.innerHeight - 8 ? br.top - mh - 4 : br.bottom + 4;
			menu.style.top = Math.max(8, top) + 'px';
			menu.style.left = Math.max(8, Math.min(br.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8)) + 'px';
			this.repMenu = menu;
			menu.addEventListener('click', (e) => {
				const row = e.target.closest('div[data-f]');
				if (!row) return;
				const f = row.getAttribute('data-f');
				if (f === 'custom') {
					if (!this.rule) this.rule = { f: 'd', n: 1 };
					custom.style.display = '';
					primeCustom(this.rule);
				} else {
					this.rule = f ? { f, n: 1 } : null;
					this.nameTpl = null; /* presets discard the custom extras, template included */
					custom.style.display = 'none';
				}
				menu.remove();
				if (this.repMenu === menu) this.repMenu = null;
				paintRepeat();
				/* deliberately NOT re-placing the box: place() re-anchors to the
				 * caret, and by now the caret element has moved or gone, so the box
				 * jumped across the screen. Position once, on open, and let it grow
				 * downward. */
				this.fit(pop);
				input.focus({ preventScroll: true });
			});
		};
		repBtn.addEventListener('click', openRepeatMenu);

		const until = pop.querySelector('.rs-until');
		const mOrdRadio = pop.querySelector('input[name="rs-mmode"][value="ord"]');
		const mEachRadio = pop.querySelector('input[name="rs-mmode"][value="each"]');
		const yCheck = pop.querySelector('.rs-ycheck');

		/* Show the grammar section for the chosen frequency, grey the half of the
		 * monthly/yearly choice that is not active, and hide the lot in
		 * count-from-completion mode, where the engine ignores day selections. */
		const updateGrammar = () => {
			const f = selVal(freq);
			const fromC = selVal(from) === 'c';
			pop.querySelector('.rs-gram-w').style.display = !fromC && f === 'w' ? '' : 'none';
			pop.querySelector('.rs-gram-m').style.display = !fromC && f === 'm' ? '' : 'none';
			pop.querySelector('.rs-gram-y').style.display = !fromC && f === 'y' ? '' : 'none';
			pop.querySelector('.rs-mdays').classList.toggle('rs-dim', mOrdRadio.checked);
			pop.querySelector('.rs-mordrow').classList.toggle('rs-dim', !mOrdRadio.checked);
			pop.querySelector('.rs-yordrow').classList.toggle('rs-dim', !yCheck.checked);
			/* Grammar and count-from-completion are mutually exclusive: 'c' counts
			 * a plain interval from the tick day, so the engine ignores every day
			 * selection. The grammar already hides in 'c' mode; the mirror image
			 * is dimming Count from once ANY day selection exists — it is
			 * effectively locked to "the due date" then. */
			const hasGrammar = !fromC && (
				(f === 'w' && !!pop.querySelector('.rs-days .rs-cell.is-on'))
				|| (f === 'm' && (mOrdRadio.checked || !!pop.querySelector('.rs-mdays .rs-cell.is-on')))
				|| (f === 'y' && (yCheck.checked || !!pop.querySelector('.rs-months .rs-cell.is-on'))));
			pop.querySelector('.rs-fromrow').classList.toggle('rs-dim', hasGrammar);
			this.fit(pop);
		};

		/* Rebuild the rule from every control. Empty selections are LEFT OUT, so
		 * the engine falls back to the anchor day, same as before. */
		const syncCustom = () => {
			const f = selVal(freq);
			const rule = { f, n: Math.max(1, parseInt(intv.value, 10) || 1) };
			if (selVal(from) === 'c') rule.from = 'c';
			else if (f === 'w') {
				const wd = [...pop.querySelectorAll('.rs-days .rs-cell.is-on')].map((c) => +c.getAttribute('data-i'));
				if (wd.length) rule.wd = wd;
			} else if (f === 'm') {
				if (mOrdRadio.checked) {
					rule.ord = +selVal(pop.querySelector('.rs-mord'));
					rule.od = odParse(selVal(pop.querySelector('.rs-mod')));
				} else {
					const md = [...pop.querySelectorAll('.rs-mdays .rs-cell.is-on')].map((c) => +c.getAttribute('data-i'));
					if (md.length) rule.md = md;
				}
			} else if (f === 'y') {
				const mo = [...pop.querySelectorAll('.rs-months .rs-cell.is-on')].map((c) => +c.getAttribute('data-i'));
				if (mo.length) rule.mo = mo;
				if (yCheck.checked) {
					rule.ord = +selVal(pop.querySelector('.rs-yordsel'));
					rule.od = odParse(selVal(pop.querySelector('.rs-yod')));
				}
			}
			/* End Repeat: After stores the count (compiled to a date at commit);
			 * On Date parses the field (typed text goes through Thymer's own
			 * parser, the picker writes the same format) */
			until.classList.remove('rs-bad-date');
			let endMode = selVal(pop.querySelector('.rs-endsel'));
			if (endMode === 'n' && selVal(from) === 'c') {
				/* completion-counted rules cannot know future days */
				setSel(pop.querySelector('.rs-endsel'), '', [['', 'Never'], ['n', 'After'], ['d', 'On Date']]);
				endMode = '';
			}
			if (endMode === 'n') {
				rule.aftN = Math.max(1, Math.min(100, parseInt(cnt.value, 10) || 1));
			} else if (endMode === 'd') {
				const uraw = until.value.trim();
				if (uraw) {
					const up = DateTime.parseDateTimeString(uraw);
					const upp = up && up.getParts();
					if (upp && upp.year !== undefined) rule.u = upp.year * 10000 + (upp.month + 1) * 100 + upp.day;
					else until.classList.add('rs-bad-date');
				}
			}
			/* No trail UI here (Supertask's copy machinery, his scope call) —
			 * but a rule that CARRIES one must not lose it when edited. */
			if (this.rule && this.rule.tr) rule.tr = this.rule.tr;
			if (this.rule && this.rule.nt) rule.nt = this.rule.nt;
			this.rule = rule;
			paintRepeat();
			paintEnd();
			updateGrammar();
		};

		/* Push an existing rule into every control (the reverse of syncCustom) */
		const primeCustom = (r) => {
			setSel(freq, r.f, FREQOPTS); intv.value = r.n || 1; setSel(from, r.from || 'a', FROMOPTS);
			pop.querySelectorAll('.rs-days .rs-cell').forEach((c) => c.classList.toggle('is-on', !!(r.wd && r.wd.indexOf(+c.getAttribute('data-i')) >= 0)));
			pop.querySelectorAll('.rs-mdays .rs-cell').forEach((c) => c.classList.toggle('is-on', !!(r.md && r.md.indexOf(+c.getAttribute('data-i')) >= 0)));
			pop.querySelectorAll('.rs-months .rs-cell').forEach((c) => c.classList.toggle('is-on', !!(r.mo && r.mo.indexOf(+c.getAttribute('data-i')) >= 0)));
			mOrdRadio.checked = !!r.ord && r.f === 'm';
			mEachRadio.checked = !mOrdRadio.checked;
			yCheck.checked = !!r.ord && r.f === 'y';
			if (r.ord) { setSel(pop.querySelector('.rs-mord'), String(r.ord), ORDOPTS); setSel(pop.querySelector('.rs-yordsel'), String(r.ord), ORDOPTS); }
			if (r.od !== undefined) { setSel(pop.querySelector('.rs-mod'), String(r.od), ODOPTS); setSel(pop.querySelector('.rs-yod'), String(r.od), ODOPTS); }
			const endMode2 = r.aftN ? 'n' : (r.u ? 'd' : '');
			until.value = endMode2 === 'd' && r.u ? (r.u % 100) + ' ' + RECUR_MONTHNAMES[Math.floor(r.u / 100) % 100 - 1] + ' ' + Math.floor(r.u / 10000) : '';
			until.classList.remove('rs-bad-date');
			cnt.value = r.aftN || 3;
			setSel(pop.querySelector('.rs-endsel'), endMode2, [['', 'Never'], ['n', 'After'], ['d', 'On Date']]);
			paintEnd();
			updateGrammar();
		};

		/* Frequency, Count-from and the ordinal pickers are OUR dropdowns, not
		 * <select>: the native macOS menu renders at the system font size
		 * (unstylable — he reported the options too small) and can close without
		 * firing change, stranding focus outside the box, which was the original
		 * Enter-dead bug. A plugin menu keeps focus, keys and typography
		 * in-house. Enter always commits regardless of focus (window handler). */
		const wireSel = (el, opts) => el.addEventListener('click', () =>
			this.openSelMenu(el, opts, selVal(el), (v) => { setSel(el, v, opts); syncCustom(); }));
		wireSel(freq, FREQOPTS);
		wireSel(from, FROMOPTS);
		/* End Repeat is Apple's shape (his screenshots): Never / After n times /
		 * On Date with a real date picker. After compiles to a date at COMMIT
		 * (occurrence #n from the committed anchor, engine-computed) so no
		 * counters ever need mutating on ticks; completion-counted rules
		 * cannot know future days, so After is absent from the menu there. */
		const endSel = pop.querySelector('.rs-endsel');
		const cnt = pop.querySelector('.rs-cnt');
		const ENDOPTS_ALL = [['', 'Never'], ['n', 'After'], ['d', 'On Date']];
		/* the ROW never grows (the Is-set-to lesson): the chip carries the
		 * whole value ("After 3 times" / "9 Sep 2026") and picking After or
		 * On Date opens a POPOVER over the field — a count box or the month
		 * picker — instead of squeezing inputs into the row */
		const paintEnd = () => {
			const v = selVal(endSel);
			const l = endSel.querySelector('.rs-sel-lbl');
			if (v === 'n') l.textContent = 'After ' + (parseInt(cnt.value, 10) || 3) + ' times';
			else if (v === 'd') l.textContent = until.value.trim() || 'On Date';
			else l.textContent = 'Never';
		};
		const endApply = (v) => {
			setSel(endSel, v, ENDOPTS_ALL);
			if (v === 'n') {
				this.openCountPop(endSel, parseInt(cnt.value, 10) || 3, (n2) => {
					cnt.value = n2;
					syncCustom();
				});
			} else if (v === 'd') {
				if (!until.value.trim()) {
					const b = (this.sel || new DateTime(new Date())).getParts();
					const d2 = new Date(b.year, b.month + 1, b.day);
					until.value = d2.getDate() + ' ' + RECUR_MONTHNAMES[d2.getMonth()] + ' ' + d2.getFullYear();
				}
				const up = DateTime.parseDateTimeString(until.value.trim());
				const upp = up && up.getParts();
				this.openMiniCal(endSel, upp && upp.year !== undefined ? upp : null, (y2, m2, d3) => {
					until.value = d3 + ' ' + RECUR_MONTHNAMES[m2] + ' ' + y2;
					syncCustom();
				});
			} else {
				until.value = '';
				until.classList.remove('rs-bad-date');
			}
			syncCustom();
		};
		endSel.addEventListener('click', () => {
			const opts = selVal(from) === 'c' ? ENDOPTS_ALL.filter((o) => o[0] !== 'n') : ENDOPTS_ALL;
			this.openSelMenu(endSel, opts, selVal(endSel), endApply);
		});
		wireSel(pop.querySelector('.rs-mord'), ORDOPTS);
		wireSel(pop.querySelector('.rs-mod'), ODOPTS);
		wireSel(pop.querySelector('.rs-yordsel'), ORDOPTS);
		wireSel(pop.querySelector('.rs-yod'), ODOPTS);
		for (const sel of ['.rs-days', '.rs-mdays', '.rs-months']) {
			pop.querySelector(sel).addEventListener('click', (e) => {
				const c = e.target.closest('.rs-cell');
				if (!c) return;
				c.classList.toggle('is-on');
				syncCustom();
			});
		}
		mOrdRadio.addEventListener('change', syncCustom);
		mEachRadio.addEventListener('change', syncCustom);
		yCheck.addEventListener('change', syncCustom);
		intv.addEventListener('input', syncCustom);
		until.addEventListener('input', syncCustom);
		/* Prime the Custom fields but keep the panel CLOSED. Opening it on load
		 * changed the box height after place() had run, which is why reopening a
		 * line that already had a rule made the box jump, and the extra fields
		 * took the focus off the text input so nothing could be typed. The rule is
		 * already summarised on the Repeat row; the panel is for editing it. */
		if (this.rule) primeCustom(this.rule);
		paintRepeat();

		show();
		this.place(pop, t);
		this.outside = (e) => {
			if (e.target.closest && e.target.closest('.rs-repmenu')) return; /* the menu is a body child now */
			/* a click anywhere else closes the repeat menu — without this, clicking
			 * back into the calendar left the menu floating over the box */
			if (this.repMenu) { try { this.repMenu.remove(); } catch (e2) {} this.repMenu = null; }
			if (this.pop && !this.pop.contains(e.target)) this.closePicker();
		};
		setTimeout(() => document.addEventListener('pointerdown', this.outside, true), 0);
		/* focus last, and once more on the next frame: laying out the repeat row
		 * can move focus, and a box you cannot type into is worse than useless */
		/* On touch the box must NOT grab the field: the keyboard would slam up
		 * over the calendar before a single day has been looked at. Tapping the
		 * field is what asks for it, and then the box climbs above the keyboard. */
		if (!rsTouch) {
			input.focus({ preventScroll: true });
			requestAnimationFrame(() => { if (this.pop === pop && document.activeElement !== input) input.focus({ preventScroll: true }); });
		} else if (window.visualViewport) {
			const vv = window.visualViewport;
			const reanchor = () => {
				/* self-removing: the box outlives no listener of its own */
				if (!document.body.contains(pop)) {
					vv.removeEventListener('resize', reanchor);
					vv.removeEventListener('scroll', reanchor);
					return;
				}
				const h = pop.offsetHeight;
				pop.style.top = Math.max(vv.offsetTop + 8, vv.offsetTop + vv.height - h - 8) + 'px';
			};
			input.addEventListener('focus', () => {
				vv.addEventListener('resize', reanchor);
				vv.addEventListener('scroll', reanchor);
				setTimeout(reanchor, 250);
			});
		}
	}
	/* A small dropdown of options under an anchor, on the repeat menu's surface
	 * (body-parented and fixed for the same overflow:hidden reason). Used by the
	 * Frequency and Count-from controls in place of a native <select>. */
	openSelMenu(anchor, items, cur, onPick) {
		this.refreshMenuColors();
		document.querySelectorAll('.rs-repmenu').forEach((m) => m.remove());
		const menu = document.createElement('div');
		menu.className = 'rs-repmenu';
		menu.innerHTML = items.map(([v, lbl]) =>
			'<div data-v="' + v + '"' + (v === cur ? ' class="rs-on"' : '') + '>' + lbl + '</div>').join('');
		document.body.appendChild(menu);
		const br = anchor.getBoundingClientRect();
		const mh = menu.offsetHeight;
		const top = br.bottom + 4 + mh > window.innerHeight - 8 ? br.top - mh - 4 : br.bottom + 4;
		menu.style.top = Math.max(8, top) + 'px';
		menu.style.left = Math.max(8, Math.min(br.left, window.innerWidth - menu.offsetWidth - 8)) + 'px';
		this.repMenu = menu;
		menu.addEventListener('click', (e) => {
			const row = e.target.closest('div[data-v]');
			if (!row) return;
			menu.remove();
			if (this.repMenu === menu) this.repMenu = null;
			onPick(row.getAttribute('data-v'));
		});
	}

	/* Native's own day-cell shape, so native's CSS lights it up:
	 * <div class="day current-month|prev-month|next-month [today] [selected]
	 * [inrange]" data-date="YYYY-MM-DD"><span class="day-inner">N</span></div> */
	/* A compact month picker for End Repeat: On Date — Thymer's OWN datepicker
	 * markup (wrapper INSIDE the popover, the doctrine) so the app styles and
	 * themes it. Carries .rs-repmenu so the box's outside-click handler
	 * treats it as one of ours. */
	openMiniCal(anchorEl, startParts, onPick) {
		this.refreshMenuColors();
		document.querySelectorAll('.rs-minical').forEach((m) => m.remove());
		const box = document.createElement('div');
		box.className = 'rs-repmenu rs-minical';
		const now = new Date();
		let vy = startParts ? startParts.year : now.getFullYear();
		let vm = startParts ? startParts.month : now.getMonth();
		const selYmd = startParts ? startParts.year * 10000 + (startParts.month + 1) * 100 + startParts.day : 0;
		const paint = () => {
			const first = new Date(vy, vm, 1);
			const lead = (first.getDay() + 6) % 7;
			let days = '';
			for (let i = 0; i < 42; i++) {
				const d = new Date(vy, vm, 1 - lead + i);
				const ymd = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
				const cls = ['day', d.getMonth() === vm ? 'current-month' : (d < first ? 'prev-month' : 'next-month')];
				if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) cls.push('today');
				if (ymd === selYmd) cls.push('selected');
				days += '<div class="' + cls.join(' ') + '" data-ymd="' + ymd + '"><span class="day-inner">' + d.getDate() + '</span></div>';
			}
			box.innerHTML = '<div class="datepicker-wrapper datepicker-compact"><div class="datepicker-calendar">'
				+ '<div class="datepicker-header"><span class="current-month" style="flex:1">'
				+ new Date(vy, vm, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
				+ '</span><span class="rs-mc-nav rs-mc-prev">‹</span><span class="rs-mc-nav rs-mc-next">›</span></div>'
				+ '<div class="datepicker-weekdays">' + DOW.map((d) => '<div class="weekday">' + d + '</div>').join('') + '</div>'
				+ '<div class="datepicker-days">' + days + '</div>'
				+ '</div></div>';
		};
		paint();
		document.body.appendChild(box);
		/* SELF-SQUARING: measure the real rendered content (fonts, UI zoom
		 * and app CSS all bend static values — seven rounds proved it) and
		 * set an exact square with the leftover distributed as equal air. */
		const squareUp = () => {
			try {
				const days2 = box.querySelector('.datepicker-days');
				const header2 = box.querySelector('.datepicker-header');
				const cells2 = box.querySelectorAll('.datepicker-days .day');
				if (!days2 || !header2 || !cells2.length) return;
				box.style.width = 'auto';
				box.style.padding = '0';
				const dr = days2.getBoundingClientRect();
				const hr = header2.getBoundingClientRect();
				const lastR = cells2[cells2.length - 1].getBoundingClientRect();
				const cW = dr.width;
				const cH = lastR.bottom - hr.top;
				const air = 17; /* his call: ~85% of the first square */
				const side = Math.max(cW, cH) + air * 2;
				box.style.width = side + 'px';
				box.style.height = side + 'px';
				box.style.paddingLeft = box.style.paddingRight = ((side - cW) / 2) + 'px';
				box.style.paddingTop = ((side - cH) / 2) + 'px';
				box.style.paddingBottom = '0';
				box.style.boxSizing = 'border-box';
			} catch (e) {}
		};
		squareUp();
		/* ABOVE the anchor row and horizontally inside the box frame (his
		 * call — dropping below the field pushed it to the screen's bottom) */
		const r = anchorEl.getBoundingClientRect();
		const frame = this.pop ? this.pop.getBoundingClientRect() : null;
		let top = r.top - box.offsetHeight - 6;
		if (top < 8) top = Math.min(r.bottom + 4, window.innerHeight - box.offsetHeight - 8);
		let left = r.left;
		if (frame) left = Math.max(frame.left + 4, Math.min(left, frame.right - box.offsetWidth - 4));
		box.style.top = Math.max(8, top) + 'px';
		box.style.left = Math.max(8, Math.min(left, window.innerWidth - box.offsetWidth - 8)) + 'px';
		const outside = (e) => { if (!box.contains(e.target) && e.target !== anchorEl) close(); };
		const close = () => { document.removeEventListener('pointerdown', outside, true); box.remove(); };
		setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
		box.addEventListener('click', (e) => {
			const nav = e.target.closest('.rs-mc-nav');
			if (nav) {
				vm += nav.classList.contains('rs-mc-next') ? 1 : -1;
				if (vm < 0) { vm = 11; vy--; }
				if (vm > 11) { vm = 0; vy++; }
				paint();
				squareUp();
				return;
			}
			const day = e.target.closest('.day');
			if (day) {
				const ymd = +day.getAttribute('data-ymd');
				close();
				onPick(Math.floor(ymd / 10000), Math.floor(ymd / 100) % 100 - 1, ymd % 100);
			}
		});
	}
	/* the After-count popover: writes through live, Enter or an outside
	 * click closes — the chip label always mirrors the value */
	openCountPop(anchorEl, current, onSet) {
		this.refreshMenuColors();
		document.querySelectorAll('.rs-repmenu').forEach((m) => m.remove());
		const box = document.createElement('div');
		box.className = 'rs-repmenu rs-countpop';
		box.innerHTML = '<label style="display:flex;align-items:center;gap:6px;padding:4px 8px;">After <input class="rs-cnt" type="number" min="1" max="100" value="' + (current || 3) + '"> times</label>';
		document.body.appendChild(box);
		this.shieldKeys(box);
		const r = anchorEl.getBoundingClientRect();
		const top = r.bottom + 4 + box.offsetHeight > window.innerHeight - 8 ? r.top - box.offsetHeight - 4 : r.bottom + 4;
		box.style.top = Math.max(8, top) + 'px';
		box.style.left = Math.max(8, Math.min(r.left, window.innerWidth - box.offsetWidth - 8)) + 'px';
		this.repMenu = box;
		const input = box.querySelector('input');
		this.reclaimFocus(input, box);
		input.focus();
		input.select();
		input.addEventListener('input', () => onSet(Math.max(1, Math.min(100, parseInt(input.value, 10) || 1))));
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				e.stopPropagation();
				box.remove();
				if (this.repMenu === box) this.repMenu = null;
			}
		});
	}
	/* anchor the pending rule on the committed day and compile "After n
	 * times" into its concrete end date (occurrence #1 = the anchor) */
	finalizeRule(pending, anchorYmd) {
		if (!pending) return null;
		const rule = { ...pending, a: anchorYmd };
		delete rule.mv; /* a new anchor: nothing was moved off it */
		if (rule.aftN) {
			const nth = recurNthOccurrence(rule, anchorYmd, rule.aftN);
			if (nth) rule.u = nth;
		}
		/* an UNBOUNDED forward trail must never be stored (his call
		 * 2026-08-10: without an End Repeat it would lay out forever) — the
		 * UI auto-arms an End Repeat when the trail is picked, so this is
		 * the belt-and-braces layer for typed-empty Until and old rules */
		if (rule.tr === 'f' && !rule.u) {
			delete rule.tr;
			this.toast('Forward trail needs an End Repeat — trail dropped.');
		}
		return rule;
	}
	renderCal(pop) {
		const { y, m } = this.view;
		pop.querySelector('.current-month').textContent =
			new Date(y, m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
		pop.querySelector('.datepicker-weekdays').innerHTML =
			DOW.map((d) => '<div class="weekday">' + d + '</div>').join('');

		const first = new Date(y, m, 1);
		const lead = (first.getDay() + 6) % 7; // JS weeks start Sunday, ours Monday
		const today = new Date();
		const same = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
		const selD = this.sel && this.sel.getParts().year !== undefined ? this.sel.toDate() : null;
		/* while END mode is armed the HOVERED day previews the range, so the
		 * span is visible as you drag it out (his ask 2026-08-29) */
		const endD = this.rangeEnd ? this.rangeEnd.toDate()
			: (this.endMode && this.endHover ? this.endHover : null);
		const sel0 = selD ? new Date(selD.getFullYear(), selD.getMonth(), selD.getDate()) : null;

		let html = '';
		for (let i = 0; i < 42; i++) {
			const d = new Date(y, m, 1 - lead + i);
			const cls = ['day', d.getMonth() === m ? 'current-month' : (d < first ? 'prev-month' : 'next-month')];
			if (same(d, today)) cls.push('today');
			if (same(d, selD) || same(d, endD)) cls.push('selected');
			if (selD && endD && d > selD && d < endD) cls.push('inrange');
			if (selD && endD) {
				if (same(d, selD)) cls.push('rs-r0');
				if (same(d, endD)) cls.push('rs-r1');
			}
			/* picking an END: a day before the start is not a legal end —
			 * native greys it and refuses the click; ours let it through and
			 * BACKWARDS ranges were born (his report 2026-08-29) */
			if (this.endMode && sel0 && d < sel0) cls.push('rs-dis');
			const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
			html += '<div class="' + cls.join(' ') + '" data-date="' + iso + '"><span class="day-inner">' + d.getDate() + '</span></div>';
		}
		pop.querySelector('.datepicker-days').innerHTML = html;
	}
	/* Keep the box on screen after it changes height, WITHOUT re-anchoring it —
	 * only the top edge moves, and only if it would otherwise hang off. */
	fit(pop) {
		const r = pop.getBoundingClientRect();
		if (r.bottom <= window.innerHeight - 8) return;
		pop.style.top = Math.max(8, window.innerHeight - 8 - r.height) + 'px';
	}

	/* THE FREEZE FIX, from the bundle this time, not a guess: Thymer's key
	 * dispatcher (EL) is registered on WINDOW BUBBLE — its only registration
	 * — and forwards every unmatched key to g_focusedComponent.onKeyDown.
	 * Clicks in plugin UI map to NO Thymer component (Li returns null), so
	 * the component focus stays parked on e.g. the collection TABLE VIEW,
	 * whose handler eats Space and letters even while a plugin input holds
	 * DOM focus. That is why the template field froze in collection views
	 * but never on lines. Stopping propagation at our own surface starves
	 * the bubble dispatcher; the browser default still runs (text lands in
	 * the field), and popKeys is window CAPTURE so Enter/Escape handling is
	 * unaffected. CDP typing bypassed all of this, which is how two rounds
	 * shipped "verified" — the v0.7.1 testing trap, honored at last. */
	/* Menu surface colours, recomputed from the LIVE background: his exact
	 * #2A2A31 / #D5D4D4 on dark themes, and on light ones a surface a touch
	 * darker than the page with the theme's own foreground (the hex would be
	 * a black slab on white). Cheap enough to call on every popover open. */
	refreshMenuColors() {
		try {
			/* THE DISCRIMINATOR IS THE CLASS, not a sampled colour (live-read
			 * 2026-08-10). Two traps killed the first attempt: `document.body`
			 * has NO background at all (`rgba(0,0,0,0)`), so a luminance test
			 * on it always answered "dark" and the menus stayed dark on light
			 * themes; and `--cmdpal-bg-color` is `color(display-p3 .129 …)` on
			 * his dark theme, which no naive digit-parse survives either. The
			 * app stamps `is-dark` / `is-light` on <html> and reruns it on
			 * every theme change — that is the signal. */
			const cl = document.documentElement.classList;
			const dark = cl.contains('is-dark') || (!cl.contains('is-light') && !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches));
			document.documentElement.style.setProperty('--rs-menu-bg', dark
				? '#2A2A31'
				: 'color-mix(in srgb, var(--cmdpal-bg-color, #fff) 94%, var(--cmdpal-fg-color, #000))');
			document.documentElement.style.setProperty('--rs-menu-fg', dark
				? '#D5D4D4'
				: 'var(--cmdpal-fg-color, var(--text-color, #333))');
		} catch (e) {}
	}

	shieldKeys(el) {
		for (const t of ['keydown', 'keypress', 'keyup']) {
			el.addEventListener(t, (e) => {
				const n = e.target;
				if (n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA')) e.stopPropagation();
			});
		}
	}

	/* belt-and-braces for the popover fields: if something yanks DOM focus
	 * to <body> or Thymer's virtual input while the popover is open, take
	 * it back — but never from a legitimate focus move into other UI */
	reclaimFocus(input, box) {
		input.addEventListener('blur', () => {
			setTimeout(() => {
				if (!document.body.contains(box)) return;
				const ae = document.activeElement;
				if (!ae || ae === document.body || ae.id === 'virtualinput-wrapper') input.focus();
			}, 0);
		});
	}
	closePicker() {
		if (this.popKeys) { window.removeEventListener('keydown', this.popKeys, true); this.popKeys = null; }
		if (this.outside) { document.removeEventListener('pointerdown', this.outside, true); this.outside = null; }
		if (this.pop) { try { this.pop.remove(); } catch (e) {} this.pop = null; }
		this.refreshMenuColors();
		document.querySelectorAll('.rs-repmenu').forEach((m) => m.remove());
		this.repMenu = null;
		this.sel = this.view = this.rangeEnd = this.endHover = this.showPicker = this.cancelPicker = null;
		this.nameTpl = this.nameBase = null;
		this.endMode = false;
	}
	shiftParts(dt, days) {
		const p = dt.getParts();
		if (p.year === undefined) return null; // time-only tag: nothing to move
		const d = new Date(p.year, p.month, p.day);
		d.setDate(d.getDate() + days);
		if (p.hours === undefined) return DateTime.dateOnly(d.getFullYear(), d.getMonth(), d.getDate());
		return DateTime.dateAndTime(d.getFullYear(), d.getMonth(), d.getDate(), p.hours, p.minutes || 0, p.seconds || 0);
	}
	/* Show the year whenever it is not the current one. Thymer's parser rolls a
	 * bare "Aug 5" forward to NEXT year once that day has passed, so without this
	 * the preview reads "Thu 5 Aug" for a date twelve months out. */
	label(dt) {
		const d = dt.toDate();
		const parts = dt.getParts();
		const opts = { weekday: 'short', month: 'short', day: 'numeric' };
		if (parts.year !== undefined && parts.year !== new Date().getFullYear()) opts.year = 'numeric';
		const day = d.toLocaleDateString(undefined, opts);
		if (parts.hours === undefined) return day;
		return day + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
	}
}
// >>>SHARED date-box

const SSDB_CSS = `
/* <<<SHARED date-box CSS — GENERATED from supertask/plugin.js. DO NOT EDIT HERE. */
/* ── SsDateBox: Supertask's picker CSS, EXTRACTED VERBATIM; injected only
   while Supertask is absent. */
.rs-pop {
	position: fixed; z-index: 99999; width: 320px;
	background: var(--cmdpal-bg-color, var(--app-bg, #26262b));
	color: var(--cmdpal-fg-color, var(--text-color, #ddd));
	border: 1px solid rgba(127,127,127,.4);
	border-radius: var(--radius-larger, 10px);
	box-shadow: 0 16px 48px rgba(0,0,0,.5);
	overflow: hidden; font-size: 13px; padding-bottom: 2px;
}
.rs-head {
	padding: 8px 12px; border-bottom: 1px solid rgba(127,127,127,.18);
	user-select: none; font-weight: 600; opacity: .75; font-size: 11.5px;
	text-transform: uppercase; letter-spacing: .04em;
	overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.rs-input {
	width: 100%; box-sizing: border-box; border: none; outline: none;
	padding: 9px 12px; font-size: var(--text-size-small, .875rem);
	font-family: inherit; background: transparent;
	color: var(--cmdpal-fg-color, var(--text-color, #eee));
	border-bottom: 1px solid rgba(127,127,127,.18);
}
/* END-DATE MODE (his asks 2026-08-29): the span you drag out is VISIBLE —
 * the hovered-to days band together — and a day before the start is greyed
 * and refuses the click, exactly like native. */
.rs-pop .day { position: relative; }
.rs-pop .day .day-inner { position: relative; }
/* the band is CONTINUOUS and EXACTLY the endpoint chips' height (his calls
 * 2026-08-29). The chip's own padding box is SHORTER than it looks (its
 * ~1.65px borders — measured 16.7 vs 20), but the .day CELL is exactly the
 * chip's border-box height, so the band hangs off the cell with inset 0
 * vertically and bleeds sideways across the grid gaps on an OPAQUE tint
 * (accent mixed into the surface, so overlaps cannot double up). The
 * endpoints' solid chips paint above it. */
.rs-pop .day.rs-r0::before, .rs-pop .day.inrange::before, .rs-pop .day.rs-r1::before {
	content: ''; position: absolute; z-index: 0; top: 0; bottom: 0; left: -7px; right: -7px;
	background: color-mix(in srgb, var(--color-primary-500, #3aa37f) 16%, var(--cmdpal-bg-color, #26262b));
}
/* the ends ANCHOR UNDER the endpoint chips (left/right 50%), so nothing
 * pokes out before the start or after the end, and the radius is the house
 * 4px on the sliver that can show (his call 2026-08-29) */
.rs-pop .day.rs-r0::before { left: 50%; border-radius: 4px 0 0 4px; }
.rs-pop .day.rs-r1::before { right: 50%; border-radius: 0 4px 4px 0; }
/* the app has its OWN .inrange styling (native range support) — under our
 * band it drew a second box (his report 2026-08-29). One drawing: ours. */
.rs-pop .day.inrange { background: transparent; }
.rs-pop .day.inrange .day-inner { background: transparent; }
.rs-pop .day.rs-dis { opacity: .3; pointer-events: none; }
.rs-timerow {
	display: flex; align-items: center; justify-content: space-between;
	padding: 5px; line-height: 1.5;
}
.rs-timetoggle { display: flex; gap: 6px; align-items: center; }
.rs-timelbl { font-size: 13px; cursor: pointer; }
.rs-time {
	background: transparent; color: inherit; font-family: inherit;
	border: 1px solid rgba(127,127,127,.35); border-radius: 4px; padding: 1px 4px;
}
.rs-addend { cursor: pointer; font-size: var(--text-size-smaller); }
/* end-date mode is ARMED: the next day click picks the end, and the control
 * must say so — silently arming the mode looked exactly like a dead button */
.rs-addend.rs-armed {
	color: color-mix(in srgb, var(--color-primary-500, #3aa37f) 60%, var(--text-color, currentColor));
	font-weight: 600;
}
.rs-foot {
	display: flex; align-items: center; justify-content: space-between; gap: 10px;
	padding: 7px 12px; border-top: 1px solid rgba(127,127,127,.18);
	margin-top: 4px;
}
.rs-result { font-weight: 600; }
.rs-result.rs-bad { opacity: .5; font-weight: 400; }
.rs-reprow {
	display: flex; align-items: center; justify-content: space-between; gap: 10px;
	padding: 5px 7px; line-height: 1.5; cursor: pointer; border-radius: 6px;
	margin: 0 5px;
}
.rs-reprow:hover { background: rgba(127,127,127,.16); }
/* right-aligned so a long value ("Every 2 years after completion") wraps away
 * from the Repeat label instead of mashing into it */
.rs-repval { display: inline-flex; align-items: center; gap: 3px; font-size: var(--text-size-smaller); text-align: right; }
.rs-repnow {
	padding: 2px 8px; border-radius: 4px;
	border: 1px solid rgba(127,127,127,.3);
	background: var(--ed-button-bg, transparent);
}
.rs-reprow:hover .rs-repnow { background: rgba(127,127,127,.22); }
/* Never stays quiet; a real rule lights up so it reads at a glance. The accent
 * is mixed 60/40 with the theme's TEXT colour, which darkens it on light
 * themes and lightens it on dark ones — --color-primary-500 alone washed out
 * in light mode. The set chip keeps an accent-tinted background on hover too,
 * because the grey hover plate made the value harder to read. */
.rs-repnow.rs-set {
	color: color-mix(in srgb, var(--color-primary-500, #3aa37f) 60%, var(--text-color, currentColor));
	border-color: color-mix(in srgb, var(--color-primary-500, #3aa37f) 60%, var(--text-color, currentColor));
	background: color-mix(in srgb, var(--color-primary-500, #3aa37f) 12%, transparent);
	font-weight: 600;
}
.rs-reprow:hover .rs-repnow.rs-set { background: color-mix(in srgb, var(--color-primary-500, #3aa37f) 20%, transparent); }
/* fixed and parented to <body>: .rs-pop has overflow:hidden, so a menu inside
 * it gets guillotined at the edge (Parham hit exactly that) */
.rs-repmenu {
	position: fixed; z-index: 100000; min-width: 170px;
	/* a whisper off the surface so the menu never melts into it: 7% of the
	 * fg mixed into the bg = slightly lighter on dark themes, slightly
	 * darker on light ones (his call — subtle, not loud). 4px = the radius
	 * standard. */
	background: var(--rs-menu-bg, #2A2A31); /* set at load: his exact hex on dark themes, a safe mix on light */
	border: 1px solid rgba(127,127,127,.4); border-radius: 4px;
	box-shadow: 0 10px 30px rgba(0,0,0,.5); padding: 4px; overflow: hidden;
	font-size: 13px;
	/* a touch off pure fg — full white popped too hard (his call) */
	color: var(--rs-menu-fg, #D5D4D4); /* set at load: his exact hex on dark, theme fg on light */
}
.rs-repmenu div { padding: 5px 10px; border-radius: 5px; cursor: pointer; white-space: nowrap; }
.rs-repmenu > div[data-v]:hover { background: rgba(127,127,127,.2); } /* real menu ROWS only — never the datepicker wrapper or its cells */
.rs-repmenu div.rs-on { color: color-mix(in srgb, var(--color-primary-500, #3aa37f) 60%, var(--text-color, currentColor)); font-weight: 600; }
.rs-custom { padding: 8px 12px 10px; border-top: 1px solid rgba(127,127,127,.18); }
.rs-custom label { display: flex; align-items: center; gap: 8px; padding: 4px 0; min-width: 0; }
.rs-custom label span:first-child { opacity: .6; min-width: 118px; flex: 0 0 auto; }
/* long chip values ("Lay Out All Occurrences") must ellipsize INSIDE the
 * box, never poke out of it — the full text is always visible in the menu.
 * min-width:0 must sit on the LABEL SPAN too: it is itself a flex item of
 * the inline-flex chip, and its default min-width:auto blocked the shrink
 * (his second overflow report — the chip-level rule alone was not enough) */
.rs-custom .rs-sel { min-width: 0; max-width: 100%; }
/* the HARD CAP is what actually truncates: flex min-width alone let the
 * label keep its full width and the text ran to the box edge (his two
 * reports; live-measured — scrollWidth==clientWidth, no ellipsis) */
.rs-custom .rs-sel .rs-sel-lbl { min-width: 0; max-width: 148px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rs-custom input {
	background: transparent; color: inherit; font-family: inherit; font-size: 13px;
	border: 1px solid rgba(127,127,127,.35); border-radius: 4px; padding: 3px 7px;
}
.rs-custom .rs-int { width: 52px; }
/* the unit label sits in the BOX, not in a menu — using the menu foreground
 * made it near-invisible on light themes (his report: "day" barely readable
 * on white). Box text colour, quietened by opacity, works in both. */
.rs-unit { color: inherit; opacity: .55; }
.rs-custom .rs-until { width: 132px; }
.rs-until.rs-bad-date { border-color: rgba(220,90,90,.7); }
.rs-cnt {
	width: 46px; background: transparent; color: inherit; font-family: inherit; font-size: 13px;
	border: 1px solid rgba(127,127,127,.35); border-radius: 4px; padding: 1px 4px;
}
/* the Name Copies popover: template field + token hint + live preview */
.rs-namepop { padding: 11px 12px; width: 318px; }
/* PROGRESS BAR COLOURS, theme-scoped so no JS is involved. The fill no
 * longer mixes with --text-color: that mix BRIGHTENED the accent on dark
 * themes and darkened it on light ones (measured: fill luma 180 in dark),
 * which is why the bar read minty. Dark themes get his pick, "variant D" —
 * accent knocked 15% toward black against an almost-black track (fill 151,
 * track 22). Light themes keep the plain accent, where a black mix would
 * read heavy. */
:root {
	--rs-prog-fill: var(--color-primary-500, #3aa37f);
	--rs-prog-track: color-mix(in srgb, var(--text-color) 16%, transparent);
}
html.is-dark {
	--rs-prog-fill: color-mix(in srgb, var(--color-primary-500, #3aa37f) 85%, #000);
	/* the track stays at the original 16%: variant D's 7% took the unfilled
	 * half almost down to the page background and it stopped reading as a
	 * bar at all (his report). Only the FILL was meant to get darker. */
	--rs-prog-track: color-mix(in srgb, var(--text-color) 16%, transparent);
}
.rs-namepop input {
	width: 100%; box-sizing: border-box;
	background: transparent; color: inherit; font-family: inherit; font-size: 13px;
	border: 1px solid rgba(127,127,127,.35); border-radius: 4px; padding: 3px 7px;
}
/* neutralize the menu-row styling the popover's divs inherit from
 * .rs-repmenu div (nowrap was clipping the preview text) */
.rs-namepop div { padding: 0; border-radius: 0; cursor: default; white-space: normal; }
/* the token legend, rebuilt to HIS mock (2026-08-10): bordered chips in a
 * two-column grid, token first + a muted example after, hairline under the
 * field, 4px radius everywhere; hovering lights the chip in the accent */
.rs-name-sep { border-top: 1px solid rgba(127,127,127,.22); margin: 9px 0; }
.rs-name-hint { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; font-size: 12px; }
.rs-namepop .rs-tokrow {
	display: flex; align-items: baseline; gap: 6px; min-width: 0;
	border: 1px solid rgba(127,127,127,.3); border-radius: 4px;
	padding: 4px 9px; cursor: pointer; white-space: nowrap;
}
.rs-namepop .rs-tokrow:hover,
.rs-namepop .rs-tokrow.is-on {
	border-color: color-mix(in srgb, var(--color-primary-500, #3aa37f) 60%, var(--text-color, currentColor));
}
.rs-namepop .rs-tokrow:hover .rs-tok-t,
.rs-namepop .rs-tokrow.is-on .rs-tok-t { color: color-mix(in srgb, var(--color-primary-500, #3aa37f) 60%, var(--text-color, currentColor)); }
.rs-tok-t { flex: 0 0 auto; }
.rs-tok-l { opacity: .5; overflow: hidden; text-overflow: ellipsis; }
.rs-name-off { font-size: 11px; opacity: .45; margin-top: 9px; }
/* the live preview sits UNDER THE FIELD (his mock), one example on the
 * generic "Title of Page" stand-in; the chips grid follows it */
.rs-name-prev { font-size: 12px; opacity: .7; margin-bottom: 9px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rs-name .rs-sel-lbl { max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* HIS DRAWN SPEC (2026-08-09), with the plugin owning EVERY dimension —
 * the app's compact-picker cells carry fixed sizes and a fixed grid height
 * that overflowed and clipped anything responsive. Exact arithmetic:
 * 7×30px columns + 6×2px gaps = 222; box = 16 + 222 + 16 = 254. Equal
 * padding on all sides by construction; month nudged right; near-square. */
.rs-minical { width: 254px; } /* provisional — squareUp() measures the render and sets the exact square + equal air */
/* THE root cause of six skewed rounds, read straight from appui.css:
 * .datepicker-compact ships padding-left:10px + padding-right:20px, and its
 * header another 5px — every layout attempt inherited that tilt. Zero them. */
.rs-minical .datepicker-wrapper { width: auto; padding: 0; }
.rs-minical .datepicker-calendar { width: auto; padding: 0; }
.rs-minical .datepicker-header { display: flex; align-items: center; padding: 0 0 0 4px; margin-bottom: 10px; }
.rs-minical .datepicker-weekdays,
.rs-minical .datepicker-days {
	display: grid; grid-template-columns: repeat(7, 25px);
	gap: 3px 2px; width: max-content; height: auto; min-height: 0;
	margin: 0 auto;
}
.rs-minical .datepicker-weekdays { margin-bottom: 7px; }
.rs-minical .weekday { width: 25px; text-align: center; padding: 0; font-size: 11px; }
.rs-minical .day {
	width: 25px; height: 22px; margin: 0; padding: 0;
	display: flex; align-items: center; justify-content: center;
}
.rs-minical .day .day-inner { font-size: 12px; width: 18px; height: 18px; padding: 2px; }
.rs-minical .current-month { font-size: 13px; }
.rs-mc-nav { cursor: pointer; padding: 0 9px; opacity: .55; user-select: none; }
.rs-mc-nav:hover { opacity: 1; }
.rs-custom input[type="radio"], .rs-custom input[type="checkbox"] {
	border: none; padding: 0; width: auto;
	accent-color: var(--color-primary-500, #3aa37f);
}
/* the day / month-day / month grids: multi-select toggle cells */
.rs-days, .rs-mdays, .rs-months { display: grid; gap: 3px; margin: 3px 0 5px; }
.rs-days { grid-template-columns: repeat(7, 1fr); }
.rs-mdays { grid-template-columns: repeat(7, 1fr); }
.rs-months { grid-template-columns: repeat(4, 1fr); }
.rs-cell {
	text-align: center; padding: 2px 0; border-radius: 4px; cursor: pointer;
	user-select: none; border: 1px solid rgba(127,127,127,.25);
}
.rs-cell:hover { background: rgba(127,127,127,.16); }
.rs-cell.is-on {
	color: color-mix(in srgb, var(--color-primary-500, #3aa37f) 60%, var(--text-color, currentColor));
	border-color: color-mix(in srgb, var(--color-primary-500, #3aa37f) 60%, var(--text-color, currentColor));
	background: color-mix(in srgb, var(--color-primary-500, #3aa37f) 14%, transparent);
	font-weight: 600;
}
.rs-ordrow { display: flex; gap: 6px; padding: 2px 0 4px 22px; }
/* the half of the monthly/yearly choice that is not active, greyed like Apple */
.rs-dim { opacity: .4; pointer-events: none; }
/* Plugin-drawn dropdowns replace the native <select>: the macOS menu renders
 * at the SYSTEM font size (unstylable, reported too small) and can close
 * without firing change, stranding focus outside the box — the original
 * Enter-dead bug. Our own menu keeps typography, focus and keys in-house. */
.rs-sel {
	display: inline-flex; align-items: center; gap: 6px; cursor: pointer;
	font-size: 13px; padding: 3px 8px; border-radius: 4px; /* the 4px standard */
	border: 1px solid rgba(127,127,127,.35);
}
.rs-sel:hover { background: rgba(127,127,127,.16); }
.rs-sel .ti-chevron-down { opacity: .5; font-size: .85em; }
/* TOUCH: a tap on a day only SELECTS it, so a finger has no way to commit —
   Enter and the double click are both mouse-and-keyboard affordances. Save and
   Clear go BELOW the footer, full width: the box keeps its own width, and an
   expanded Repeat panel pushes them down instead of past them. */
.rs-tbtns { display: none; flex-direction: column; gap: 8px; padding: 0 10px 10px; }
.rs-pop.rs-touch .rs-tbtns { display: flex; }
/* the footer's own Clear would come back on the next show() (it toggles inline
   display), so the touch shape takes it out in CSS, where nothing overrides it */
.rs-pop.rs-touch .rs-foot .rs-clear { display: none !important; }
.rs-tbtn {
	height: 44px; display: flex; align-items: center; justify-content: center;
	border-radius: 4px; font-size: 13.3px; font-weight: 600; letter-spacing: .02em;
	cursor: pointer; user-select: none;
}
.rs-tsave { background: var(--button-primary-bg-color, #4caea1); color: light-dark(#fff, #0f0f11); }
/* Thymer's OWN red (the enum chip pair), not a pure signal red: it reads as
   destructive without outshouting Save, and it follows the theme both ways. */
.rs-tclear { background: var(--enum-red-bg, #3d2a30); color: var(--enum-red-fg, #e8a0a8); }
.rs-clear {
	cursor: pointer; font-size: 13px; white-space: nowrap;
	padding: 3px 9px; border-radius: 5px;
	border: 1px solid rgba(127,127,127,.3);
}
.rs-clear:hover { background: rgba(127,127,127,.2); }
/* >>>SHARED date-box CSS */
`;

class Plugin extends AppPlugin {

	// Longest query text kept as a title suggestion before it gets truncated.
	static TITLE_SUGGEST_MAX = 40;

	// A search whose viewId is this is collection-global: it shows in every view of
	// the collection rather than being tied to one. Real view ids never look like this.
	static GLOBAL_VIEW = "*";

	// Collection key for Thymer's Task view, which has no collection behind it.
	static TASKS_COL = "__tasks__";

	onLoad() {
		// Dev handle for the CDP loop, only where localStorage holds "ssq_dev":
		// the plugin instance is otherwise unreachable from the page.
		try {
			if (localStorage.getItem("ssq_dev")) {
				window.__ssq = this;
				window.__ssqGen = (window.__ssqGen || 0) + 1;   // Hot Reload proof: rises on every code load
			}
		} catch (e) {}
		// The LIVE instance's number. A reload does not always unload the old
		// instance, and an old one still drawing chips leaves buttons wired to dead
		// code: an instance that is no longer the live one stops drawing.
		this._gen = window.__ssqLiveGen = (window.__ssqLiveGen || 0) + 1;
		// All state as class fields: Thymer can call onUnload() on an instance
		// whose onLoad() never ran (editor validate/preview cycle).
		this._cache = null;   // in-memory store, authoritative for this session
		this._rev = 0;        // timestamp of the last write, used to pick the newer copy
		this._dirty = false;  // pending config write, flushed when the builder closes
		this._foldCache = null; // folded library sections, seeded from localStorage
		// Refresh buttons on live search blocks: the rendered blocks found by the
		// last scan, and the floating button belonging to each.
		this._qBlocks = [];     // [{el, box, guid}] rebuilt on the attach cycle
		this._qBtns = new Map();// scan key → the floating button element
		this._qRaf = 0;
		this._qLoaderCache = null;  // {proto, name} — the loader, found by signature
		this._qLoaderWarned = false;

		this.ui.injectCSS(CSS);
		// A plugin reload doesn't always unload the previous instance, so clear any
		// popup it left behind before this one starts drawing its own.
		// …and any chip wrapper it left on a query block: an unload that never
		// ran (or ran as the old code) must not leave zombies behind.
		document.querySelectorAll(".ssq-pop, .qb-pop, .qb-menu, .qb-help-pop, .ssq-qwrap, .ssq-chips").forEach((p) => p.remove());

		this._onDocDown = this._onDocDown.bind(this);
		this._onKeyDown = this._onKeyDown.bind(this);
		this._onFieldFocus = this._onFieldFocus.bind(this);
		this._onQNudge = this._onQNudge.bind(this);
		document.addEventListener("mousedown", this._onDocDown, true);
		document.addEventListener("keydown", this._onKeyDown, true);
		document.addEventListener("focusin", this._onFieldFocus, true);
		this._onChipPress = this._onChipPress.bind(this);
		window.addEventListener("pointerdown", this._onChipPress, true);
		// Chips are drawn the moment the field's text changes, not on the next
		// debounced attach: that delay was the flash of the full query (his recording).
		this._onFieldInput = (e) => {
			const t = e.target;
			if (t && t.matches && t.matches("input.query-input--field.is-collection-filter")) {
				try { this._chipSync(t); } catch (err) {}
			}
		};
		document.addEventListener("input", this._onFieldInput, true);
		document.addEventListener("focusout", this._onFieldFocus, true);
		// The refresh buttons follow their block every frame: a debounce alone
		// makes a floating chip visibly lag and hop during a scroll (the lesson
		// Supertask's ⋯ chip paid for). Pointer moves are what change the
		// hovered block, so they drive the same cheap measure-only pass.
		window.addEventListener("scroll", this._onQNudge, true);
		window.addEventListener("resize", this._onQNudge);
		window.addEventListener("pointermove", this._onQNudge, true);

		// The toolbar is re-rendered on every view switch and panel change, so the
		// button has to be re-attached rather than added once.
		this._items(); // seed the store now, so a write owed from a previous session is known
		this._observer = new MutationObserver((recs) => {
			this._scheduleAttach();
			// A view switch or remount redraws the filter field with its text: put the
			// chips on it in this same task, before the browser paints the full query.
			const hit = (n) => n && n.nodeType === 1
				&& (n.matches(".records-view-query-wrap") || !!n.querySelector(".records-view-query-wrap"));
			for (const r of recs) {
				if ((r.target.nodeType === 1 && r.target.closest(".records-view-query-wrap"))
					|| [...r.addedNodes].some(hit)) {
					this._chipSyncAll();
					break;
				}
			}
		});
		this._observer.observe(document.body, { childList: true, subtree: true });
		this._attachAll();
		// Our own load is a plugin reload, the very thing that empties a filter's
		// index; check again once Thymer has refilled its collection list.
		this._healTimers = [800, 2500].map((ms) => setTimeout(() => this._healFilterIndexes(), ms));
	}

	onUnload() {
		if (this._observer) { this._observer.disconnect(); this._observer = null; }
		if (this._attachTimer) { clearTimeout(this._attachTimer); this._attachTimer = null; }
		(this._healTimers || []).forEach((t) => clearTimeout(t));
		if (this._qRaf) { cancelAnimationFrame(this._qRaf); this._qRaf = 0; }
		document.removeEventListener("mousedown", this._onDocDown, true);
		document.removeEventListener("keydown", this._onKeyDown, true);
		document.removeEventListener("focusin", this._onFieldFocus, true);
		if (this._onChipPress) window.removeEventListener("pointerdown", this._onChipPress, true);
		if (this._onFieldInput) document.removeEventListener("input", this._onFieldInput, true);
		document.removeEventListener("focusout", this._onFieldFocus, true);
		document.querySelectorAll(".ssq-chips").forEach((c) => c.remove());
		if (this._ssdb && this._ssdb.pop) try { this._ssdb.closePicker(); } catch (e) {}
		document.querySelectorAll("style[data-ssdb]").forEach((x) => x.remove());
		if (this._onQNudge) {
			window.removeEventListener("scroll", this._onQNudge, true);
			window.removeEventListener("resize", this._onQNudge);
			window.removeEventListener("pointermove", this._onQNudge, true);
			// Deliberately NOT nulled: onLoad re-binds from this same property, so
			// clearing it would make a second onLoad on the same instance throw on
			// null.bind() — and this plugin reloads itself on every config write.
			// The other handlers here are left alone for exactly the same reason.
		}
		this._qBlocks = [];
		if (this._qBtns) this._qBtns = null;
		this._closePopup();
		this._qbClose(false);
		document.querySelectorAll(".ssq-btn").forEach((b) => b.remove());
		document.querySelectorAll(".ssq-pop, .qb-pop, .qb-menu, .qb-help-pop").forEach((p) => p.remove());
		// The WHOLE chip wrapper goes, not just the refresh chip inside it. This
		// line predates the wrapper (2026-08-14, when the edit chip joined the
		// refresh one) and removing only .ssq-refresh left an orphaned .ssq-qwrap
		// with a live-looking edit chip on EVERY query block, wired to a dead
		// instance — one per reload, and a plugin reload happens on every config
		// write. His two reports, one cause: an old chip stuck visible
		// ("synlig hela tiden", it kept the .ssq-on a dead handler had set) and
		// the builder opening with no collections (the dead instance's cache was
		// empty and could no longer fill), which parses every row as a raw chip.
		document.querySelectorAll(".ssq-qwrap, .ssq-refresh").forEach((b) => b.remove());
		// our hover class is the only thing we ever put on a Thymer element
		document.querySelectorAll(".ssq-peer-hot").forEach((p) => p.classList.remove("ssq-peer-hot"));
	}

	// ── Store ────────────────────────────────────────────────────────────────
	// Config round-trips are unreliable in the web client (getConfiguration()
	// doesn't reflect a just-written saveConfiguration()), so the in-memory copy
	// is the source of truth once seeded, exactly as PDF Highlighter does it.
	// Both copies carry the timestamp of their last write, and the newer one wins.
	// Saving the plugin's code (from the in-app editor or the CLI) rewrites its
	// config from an older snapshot, which would otherwise resurrect searches you
	// had deleted; a plain union can't fix that, because a deletion looks exactly
	// like an item the other copy hasn't seen yet.
	_items() {
		if (this._cache) return this._cache;
		let cItems = null, cRev = 0, lItems = null, lRev = 0;
		try {
			const c = this.getConfiguration();
			if (c && c.custom && Array.isArray(c.custom.savedSearches)) {
				cItems = c.custom.savedSearches;
				cRev = c.custom.savedSearchesRev || 0;
			}
		} catch (e) { /* config unreadable — localStorage may still have it */ }
		try {
			const raw = JSON.parse(window.localStorage.getItem(this._lsKey("ssq_savedSearches")) || "null");
			if (Array.isArray(raw)) { lItems = raw; lRev = 0; }            // pre-0.2 format
			else if (raw && Array.isArray(raw.items)) { lItems = raw.items; lRev = raw.rev || 0; }
		} catch (e) { /* ignore */ }

		if (cItems && (!lItems || cRev >= lRev)) { this._cache = cItems; this._rev = cRev; }
		else if (lItems) {
			this._cache = lItems; this._rev = lRev;
			// The local copy is ahead: a write is still owed to the config, either
			// because it was deferred past a quit or because a code push rolled the
			// config back. Flush it at the next safe moment.
			this._dirty = true;
		}
		else { this._cache = []; this._rev = 0; }
		return this._cache;
	}

	// localStorage is one per origin, shared by every workspace on it, so each
	// install keeps its copy under its own plugin guid. The unscoped keys of
	// earlier versions are never read: they may hold another workspace's searches.
	_lsKey(name) { return name + ":" + this.getGuid(); }

	_touch() {
		this._dirty = true;
		this._rev = Date.now();
		// Also a crash net: the config is only written when the builder closes.
		try {
			window.localStorage.setItem(this._lsKey("ssq_savedSearches"), JSON.stringify({ rev: this._rev, items: this._items() }));
		} catch (e) {}
		this._repaintButtons(); // a collection may have gained or lost its first saved search
		this._chipSyncAll();    // a rename or delete changes what the chips say
	}

	// A config write reloads the plugin, and a plugin reload wipes whatever is typed
	// in the collection filter field (Thymer's own behaviour, nothing to do with
	// this plugin). Saving a search while a query is on screen would therefore
	// clear the very search you just saved, so the write waits for a moment when no
	// filter field holds anything — until then the change lives in memory and
	// localStorage, and _attachAll retries on the next DOM tick.
	// The Task view is exempt: its query field survives a plugin reload (the view
	// re-applies its own stored query), and it is never empty, so waiting for it to
	// empty would defer the write forever — that's why saving appeared not to work there.
	_canFlush() {
		return ![...document.querySelectorAll("input.query-input--field.is-collection-filter")]
			.some((i) => i.value.trim() && !this._isTaskPanel(i.closest(".panel")));
	}

	// Thymer's Task view: no collection behind it, and its view switcher uses
	// data-task-view (scope:today / scope:all / …) instead of data-view.
	_isTaskPanel(panel) {
		return !!(panel && panel.querySelector(".records-view-switcher-button[data-task-view]"));
	}

	async _flush() {
		// Never write while the builder is open: the write reloads the plugin, which
		// would tear it down mid-interaction (reorder, rename, save in the library).
		// The write lands on close, or on a later attach tick once the field empties.
		if (!this._dirty || this._qb || !this._canFlush()) return;
		this._dirty = false;
		// A write reloads the plugin, and a reload that reads back an OLDER config
		// (Hot Reload re-applies the config it was pushed with; the web client
		// does not read custom back at all) sees the local copy ahead and writes
		// again: a loop that wrote the same 41 KB a thousand times on
		// 2026-10-11. The same revision is written at most once per 10 minutes:
		// that still heals a config a code push rolled back, without the storm.
		const rev = this._rev || 0;
		try {
			const last = JSON.parse(window.localStorage.getItem(this._lsKey("ssq_flushed")) || "null");
			if (last && last.rev === rev && Date.now() - last.at < 600000) return;
			window.localStorage.setItem(this._lsKey("ssq_flushed"), JSON.stringify({ rev, at: Date.now() }));
		} catch (e) { /* no localStorage: no guard, as before */ }
		try {
			const conf = this.getConfiguration() || {};
			conf.custom = conf.custom || {};
			conf.custom.savedSearches = this._items();
			conf.custom.savedSearchesRev = this._rev || Date.now();
			let all = this.data.getAllGlobalPlugins();
			if (all && typeof all.then === "function") all = await all;
			const mine = (all || []).find((g) => g.guid === this.getGuid());
			if (mine && typeof mine.saveConfiguration === "function") mine.saveConfiguration(conf);
		} catch (e) { /* localStorage still holds it */ }
	}

	// ── Toolbar button ───────────────────────────────────────────────────────
	_scheduleAttach() {
		if (this._attachTimer) return;
		this._attachTimer = setTimeout(() => { this._attachTimer = null; this._attachAll(); }, 120);
	}

	_attachAll() {
		// An instance that is no longer the live one goes quiet for good.
		if (window.__ssqLiveGen !== this._gen) {
			if (this._observer) { this._observer.disconnect(); this._observer = null; }
			return;
		}
		if (this._dirty) this._flush(); // retry a write that was waiting for an empty filter field

		document.querySelectorAll(".records-view-toolbar-actions").forEach((bar) => {
			let btn = bar.querySelector(".ssq-btn");
			// A button an older instance made is wired to it: make a new one.
			if (btn && btn._ssqGen !== this._gen) { btn.remove(); btn = null; }
			if (!btn) {
				btn = document.createElement("button");
				btn._ssqGen = this._gen;
				btn.className = "button-none button-small button-minimal-hover tooltip ssq-btn";
				btn.setAttribute("data-tooltip-dir", "top");
				btn.setAttribute("aria-label", "Saved searches");
				btn.addEventListener("click", (e) => {
					e.preventDefault();
					e.stopPropagation();
					this._togglePopup(btn);
				});
				// Grouped with the filter and sort controls rather than the create button.
				const anchor = bar.querySelector(".id--active-filter-button");
				if (anchor) bar.insertBefore(btn, anchor); else bar.appendChild(btn);
			}
			this._paintButton(btn);
		});

		// Never let the query-block work take the toolbar button down with it.
		try { this._qScan(); } catch (e) {}
		this._chipSyncAll();
		this._healFilterIndexes();
	}

	// Focus in the filter field drops its chips at once; leaving it brings them back.
	_onFieldFocus(e) {
		const t = e.target;
		if (!(t && t.matches && t.matches("input.query-input--field.is-collection-filter"))) return;
		// A press on a chip must reach the chip. If the field takes focus in the
		// middle of that press (his recording: the first click on the chip opened
		// the field instead), the chips stay and the focus is handed back, so the
		// click still lands on the chip it started on.
		if (e.type === "focusin" && this._chipPress && this._chipPress.input === t && Date.now() - this._chipPress.at < 800) {
			setTimeout(() => { if (document.activeElement === t) t.blur(); }, 0);
			return;
		}
		setTimeout(() => { try { this._chipSync(t); } catch (err) {} }, 0);
	}

	// Window-capture, so it runs before anything else sees the press.
	_onChipPress(e) {
		const chip = e.target && e.target.closest && e.target.closest(".ssq-chip");
		if (!chip) return;
		const wrap = chip.closest(".query-input--wrapper");
		this._chipPress = { at: Date.now(), input: wrap && wrap.querySelector("input.query-input--field.is-collection-filter") };
	}

	// The bookmark is filled when the collection this button belongs to already has
	// saved searches, so a filled icon reads as "there's something here to reuse".
	_paintButton(btn) {
		const col = this._colOf(btn.closest(".panel"));
		const has = col && this._items().some((s) => s.col === col);
		btn.classList.toggle("ssq-has", !!has);
		btn.setAttribute("data-tooltip", has ? "Saved searches" : "Save this search");
		const want = has ? "filled" : "outline";
		if (btn.getAttribute("data-ssq-icon") === want) return; // avoid needless reflow
		btn.setAttribute("data-ssq-icon", want);
		btn.innerHTML = has
			// Tabler's bookmark-filled path — the icon font's subset has no filled
			// bookmark glyph, so the filled state is an inline SVG at the glyph's size.
			? '<svg class="ssq-ico" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><path d="M14 2a5 5 0 0 1 5 5v14a1 1 0 0 1 -1.555 .832l-5.445 -3.63l-5.444 3.63a1 1 0 0 1 -1.55 -.72l-.006 -.112v-14a5 5 0 0 1 5 -5h5z"/></svg>'
			: '<span class="ti ti-bookmark"></span>';
	}

	// Repaint every button's filled/outline state after the store changes.
	_repaintButtons() {
		document.querySelectorAll(".ssq-btn").forEach((b) => this._paintButton(b));
	}

	// The collection key for a panel: guid if the heading carries one, else the
	// collection name (the fallback for panels rendered without a heading). The
	// Task view has no collection at all, so it gets its own fixed key.
	_colOf(panel) {
		if (!panel) return "";
		if (this._isTaskPanel(panel)) return Plugin.TASKS_COL;
		const heading = panel.querySelector(".panel-heading[data-banner-drop]");
		if (heading) return heading.getAttribute("data-banner-drop");
		const bar = panel.querySelector(".panel-bar[data-plugin]");
		return bar ? "name:" + bar.getAttribute("data-plugin") : "";
	}

	// The view component's config for a panel. NOT read off `g_focusedComponent`
	// directly: clicking the bookmark button moves component focus to the toolbar
	// (`records-view-toolbar-inner`), which carries no viewConfig — so the value was
	// there right up until the user's click and gone by the time the popup asked for
	// it. A SYNTHETIC click does not move focus, which is exactly why this passed
	// verification and failed in his hands. The view is one hop away in the component
	// tree, so walk it: bounded, and only accepting a component rendered INSIDE this
	// panel, which keeps split view honest.
	_viewConfigFor(panel) {
		try {
			const start = window.g_focusedComponent;
			if (!start) return null;
			const seen = new Set();
			const queue = [[start, 0]];
			while (queue.length) {
				const [c, d] = queue.shift();
				if (!c || d > 4 || seen.has(c)) continue;
				seen.add(c);
				const vc = c.options && c.options.viewConfig;
				if (vc && c.node && (!panel || panel === document || panel.contains(c.node))) return vc;
				if (c.parent) queue.push([c.parent, d + 1]);
				if (c.recordsView) queue.push([c.recordsView, d + 1]);
				for (const k of (c.children || [])) queue.push([k, d + 1]);
			}
		} catch (e) { /* internals — never let this take the popup down */ }
		return null;
	}

	// Everything the builder needs to know about where it was opened from.
	_context(btn) {
		const panel = btn.closest(".panel") || document;
		const input = panel.querySelector("input.query-input--field.is-collection-filter");
		if (!input) return null;
		const isTasks = this._isTaskPanel(panel);
		const bar = panel.querySelector(".panel-bar[data-plugin]");
		const colName = isTasks ? "Tasks" : (bar ? bar.getAttribute("data-plugin") : "");
		const col = this._colOf(panel);
		// Collection views mark the active view with aria-pressed and carry data-view;
		// the Task view marks it with .is-active and carries data-task-view (or
		// data-custom-view for a saved task view). Handle both.
		const view = panel.querySelector('.records-view-switcher-button[aria-pressed="true"]')
			|| panel.querySelector(".records-view-switcher-button.is-active");
		let viewId = view ? (view.getAttribute("data-view")
			|| view.getAttribute("data-custom-view")
			|| view.getAttribute("data-task-view") || "") : "";
		let viewName = view ? view.textContent.trim() : "";
		const vc = this._viewConfigFor(panel);
		if (!viewId) {
			// Mobile has no view switcher at all; fall back to the focused view
			// component's config, whose `id` matches the button's data-view.
			if (vc && vc.id) { viewId = vc.id; viewName = vc.label || ""; }
		}
		// A DYNAMIC collection's view names the collections it pulls from, as guids in
		// `source_collections` (read from the live config: Finance's Cashflow lists
		// three, its Incomes view exactly one). That is the only sensible set for the
		// builder's source picker there — offering all 66 is what made it confusing.
		// Trusted only when the config found is the view actually on screen.
		let sourceCols = null;
		if (vc && (!viewId || vc.id === viewId) && Array.isArray(vc.source_collections) && vc.source_collections.length) {
			sourceCols = vc.source_collections.slice();
		}
		return { panel, input, col, colName, viewId, viewName, isTasks, sourceCols };
	}

	// ── Running a search ─────────────────────────────────────────────────────
	// Thymer's filter field is a plain input whose handler listens for "input",
	// so this is exactly what typing does.
	_apply(input, query) {
		input.value = query;
		input.dispatchEvent(new Event("input", { bubbles: true }));
		this._resortAfterQuery(input, query);
	}

	// Thymer bug (2026-10-11, reported): a sorted view keeps its "stable row order"
	// when the filter changes (`onSetQuery` never resets `stableRowOrder`), so rows
	// a new filter brings in land next to a neighbour or at the end instead of by
	// date, and the Resort icon stays hidden. Once the view runs the new query, the
	// plugin presses Resort for it: the view's own `onResortColumn()`. Only table
	// views with a sort; internals, so every step is guarded.
	_resortAfterQuery(input, query) {
		const want = String(query || "").trim();
		const token = (this._resortToken = (this._resortToken || 0) + 1);
		let tries = 0;
		const tick = () => {
			if (token !== this._resortToken || window.__ssqLiveGen !== this._gen) return;   // a newer apply took over
			try {
				const root = window.g_focusedComponent && window.g_focusedComponent.root;
				const qi = root && this._queryInputOf(input, root);
				const vd = qi && qi.parent;
				const rv = vd && vd.recordsView;
				if (!rv || typeof rv.onResortColumn !== "function" || !rv.sortColumn || !rv.sortColumn.fieldId) return;
				if (typeof vd.getQuery === "function" && vd.getQuery() !== want) {
					if (++tries < 40) setTimeout(tick, 50);   // the view applies typed queries after its own 200 ms
					return;
				}
				rv.onResortColumn();
			} catch (e) { /* internals moved: the rows simply keep Thymer's order */ }
		};
		setTimeout(tick, 50);
	}

	// Does a query already contain a boolean operator? Such a query needs wrapping
	// when it's joined to another, or precedence silently changes the meaning
	// (`A OR B` joined with AND becomes `A OR (B AND C)` without brackets).
	_hasBoolOp(q) { return /(^|\s)(and|or|not)(\s|$)/i.test(q) || /&&|\|\|/.test(q); }

	// Brackets are only REQUIRED where precedence would otherwise change the
	// meaning. NOT binds tighter than AND, which binds tighter than OR, so
	// `a AND NOT b AND NOT c` needs none — bracketing everything is what made
	// chained additions nest deeper and deeper.
	_needsWrapLeft(q, op) {
		return op !== "OR" && this._topOps(q).or; // `(a OR b) AND c`
	}
	_needsWrap(q, op) {
		const t = this._topOps(q);
		if (op === "OR") return false;            // OR binds loosest; nothing to protect
		if (op === "NOT") return t.or || t.and;   // NOT would otherwise take only the first term
		return t.or;                              // `a AND (b OR c)`
	}

	// Bracket a side only when it earns them: a single condition needs none, and a
	// query that is already one bracketed group must not gain another layer.
	_wrapSide(q, force, needed) {
		q = (q || "").trim();
		if (!q || (!needed && !force)) return q;
		if (!this._hasBoolOp(q)) return q;
		if (this._isWrapped(q)) return q;
		return "(" + q + ")";
	}

	// Which boolean operators appear at the top level (outside brackets and quotes).
	_topOps(q) {
		const res = { and: false, or: false };
		let depth = 0, inQuote = false, token = "";
		const flush = () => {
			const t = token.toLowerCase();
			if (t === "and" || t === "&&") res.and = true;
			else if (t === "or" || t === "||") res.or = true;
			token = "";
		};
		for (let i = 0; i < (q || "").length; i++) {
			const c = q[i];
			if (c === '"') { inQuote = !inQuote; flush(); continue; }
			if (inQuote) continue;
			if (c === "(") { depth++; flush(); continue; }
			if (c === ")") { depth--; flush(); continue; }
			if (/[a-zA-Z&|]/.test(c)) { if (depth === 0) token += c; else token = ""; }
			else flush();
		}
		flush();
		return res;
	}

	// True when the whole query is one bracketed group, e.g. "(a OR b)" — but not
	// "(a) AND (b)", where the first bracket closes early. Quoted text is skipped so
	// brackets inside a value (`."Bar (x)"`) don't confuse the scan.
	_isWrapped(q) {
		if (q[0] !== "(" || q[q.length - 1] !== ")") return false;
		let depth = 0, inQuote = false;
		for (let i = 0; i < q.length; i++) {
			const c = q[i];
			if (c === '"') { inQuote = !inQuote; continue; }
			if (inQuote) continue;
			if (c === "(") depth++;
			else if (c === ")") {
				depth--;
				if (depth === 0 && i < q.length - 1) return false;
			}
		}
		return depth === 0;
	}

	// ── Recognising saved searches in the field (the chips) ───────────────────
	// The field's text is split at its TOP-LEVEL AND/OR (outside quotes and
	// brackets) into operands with their exact character ranges. An operand is a
	// saved search when it equals one's query, or does once one wrapping bracket
	// is taken off (the form the builder writes when it combines one). A leading
	// NOT stays outside the chip. Snapshot rule: anything else is plain text, so
	// an edited search simply stops being a chip. A saved search that does not
	// stand as a whole unit (the precedence trap `(A) OR (B) AND X`) cannot match.
	_ssSplit(text) {
		const t = text || "";
		const parts = [];
		let depth = 0, inQ = false, start = 0, i = 0;
		const push = (end) => {
			let s = start, e = end;
			while (s < e && /\s/.test(t[s])) s++;
			while (e > s && /\s/.test(t[e - 1])) e--;
			if (s < e) parts.push({ s, e });
		};
		while (i < t.length) {
			const c = t[i];
			if (c === '"') { inQ = !inQ; i++; continue; }
			if (inQ) { i++; continue; }
			if (c === "(") depth++;
			else if (c === ")") depth--;
			else if (depth === 0 && (i === 0 || /\s/.test(t[i - 1]))) {
				const m = /^(and|or|&&|\|\|)(?=\s|$)/i.exec(t.slice(i));
				if (m) { push(i); start = i + m[0].length; i = start; continue; }
			}
			i++;
		}
		push(t.length);
		return parts;
	}

	// [{s, e, cs, item}]: the operand's range, where its chip starts (past any
	// NOT), and the saved search it is. Same-collection searches win a tie.
	_ssMatch(text, items, col) {
		const t = text || "";
		const all = (items || []).filter((x) => x && String(x.query || "").trim());
		const find = (q) => {
			const hits = all.filter((x) => x.query.trim() === q);
			return hits.find((x) => x.col === col) || hits[0] || null;
		};
		const whole = find(t.trim());
		if (whole) {
			const s = t.length - t.trimStart().length;
			return [{ s, e: s + t.trim().length, cs: s, item: whole }];
		}
		const out = [];
		for (const p of this._ssSplit(t)) {
			const op = t.slice(p.s, p.e);
			const m = /^(not\s+|!\s*)/i.exec(op);
			const cs = p.s + (m ? m[0].length : 0);
			const body = t.slice(cs, p.e).trim();
			let item = find(body);
			if (!item && this._isWrapped(body)) item = find(body.slice(1, -1).trim());
			if (item) out.push({ s: p.s, e: p.e, cs, item });
		}
		return out;
	}

	// The field text → a builder model, with every recognised saved search as a
	// saved node. The matches are swapped for placeholder tags the reader turns
	// into hashtag rows, which are then swapped back: the reader keeps doing all
	// the precedence, NOT and bracket work exactly as it does for anything else.
	_qbParseWithSaved(text, items, col, openAt) {
		const t = (text || "").trim();
		const hits = this._ssMatch(t, items, col);
		if (!hits.length) return this._qbParse(t);
		let marked = "", from = 0;
		hits.forEach((h, k) => { marked += t.slice(from, h.cs) + "#__ssq" + k + "__"; from = h.e; });
		marked += t.slice(from);
		const model = this._qbParse(marked);
		if (!model) return null;
		const swap = (g) => {
			g.rows = (g.rows || []).map((n) => {
				if (this._qbHasRows(n)) { swap(n); return n; }
				const m = this._qbKind(n) === "cond" && n.type === "bi-tag" && /^__ssq(\d+)__$/.exec(String(n.value || ""));
				if (!m) return n;
				const k = parseInt(m[1], 10);
				const s = this._qbSavedNode(hits[k].item, openAt === k);
				s.j = n.j; s.neg = n.op === "!=";
				return s;
			});
			return g;
		};
		return swap(model);
	}

	// ── The chip overlay ─────────────────────────────────────────────────────
	// The field's text IS the query, so nothing can shorten it in place. While the
	// field is NOT focused, a plugin layer is drawn over the text area instead:
	// each recognised saved search as a chip, everything else as Thymer's own
	// highlighted text (cloned from its highlight layer, colours and all). Focus
	// the field and the layer goes, leaving the full query exactly as today.
	_chipSyncAll() {
		if (window.__ssqLiveGen !== this._gen) return;
		document.querySelectorAll("input.query-input--field.is-collection-filter").forEach((i) => {
			try { this._chipSync(i); } catch (e) { /* never let the chips take the toolbar down */ }
		});
	}

	_chipSync(input) {
		if (window.__ssqLiveGen !== this._gen) return;
		const wrap = input.parentElement;
		if (!wrap) return;
		let layer = wrap.querySelector(":scope > .ssq-chips");
		// Chips an older instance drew are wired to it: draw them again.
		if (layer && layer._ssqGen !== this._gen) { layer.remove(); layer = null; }
		const text = input.value || "";
		const hits = (document.activeElement === input || !text.trim()) ? []
			: this._ssMatch(text, this._items(), this._colOf(input.closest(".panel")));
		if (!hits.length) { if (layer) layer.remove(); return; }
		const hl = wrap.querySelector(".query-input--highlight");
		// (Whether the highlight layer has caught up is part of the signature, so
		// plain stand-in text is redrawn in colour once it has.)
		const sig = text + "\u0000" + hits.map((h) => h.item.id + ":" + h.item.title).join("|")
			+ "\u0000" + !!(hl && hl.textContent.length === text.length);
		if (layer && layer._ssqSig === sig) return;   // nothing changed: no DOM churn
		if (!layer) {
			layer = document.createElement("div");
			layer.className = "ssq-chips";
			layer._ssqGen = this._gen;
			// Anywhere but a chip puts you in the field, caret at the end.
			layer.addEventListener("mousedown", (e) => {
				if (e.target.closest(".ssq-chip")) return;
				e.preventDefault();
				input.focus();
				const n = input.value.length;
				try { input.setSelectionRange(n, n); } catch (err) {}
			});
			wrap.insertBefore(layer, input.nextSibling);
		}
		layer._ssqSig = sig;
		// The text area of the field: the highlight layer's own padding, and the
		// background of whatever is painted behind the transparent input.
		const hs = getComputedStyle(hl || input);
		const is = getComputedStyle(input);
		layer.style.left = hs.paddingLeft;
		// The layer runs on to the border: Thymer's text continues into the right
		// padding (under the clear button) and showed there as a stray `."` (his
		// screenshot). The content still stops where the text area does; the clear
		// button comes later in the wrapper, so it is drawn on top.
		const br = Math.ceil(parseFloat(is.borderRightWidth) || 0);
		layer.style.right = br + "px";
		layer.style.paddingRight = Math.max(0, (parseFloat(hs.paddingRight) || 0) - br) + "px";
		// Inside the field's border, never over it.
		layer.style.top = Math.ceil(parseFloat(is.borderTopWidth) || 0) + "px";
		layer.style.bottom = Math.ceil(parseFloat(is.borderBottomWidth) || 0) + "px";
		layer.style.background = this._chipBg(input);
		layer.style.font = getComputedStyle(input).font;
		layer.innerHTML = "";
		const box = document.createElement("div");
		box.className = "ssq-chips-in";
		layer.appendChild(box);

		// Character offset → a cloned piece of the highlight layer. If the layer
		// has not caught up with the text yet, plain text stands in.
		const nodes = [];
		if (hl) {
			const w = document.createTreeWalker(hl, NodeFilter.SHOW_TEXT);
			let at = 0, tn;
			while ((tn = w.nextNode())) { nodes.push({ n: tn, s: at }); at += tn.nodeValue.length; }
			if (at !== text.length) nodes.length = 0;
		}
		const piece = (s, e) => {
			if (e <= s) return;
			const span = document.createElement("span");
			span.className = "ssq-chips-text";
			if (nodes.length) {
				const pos = (o) => {
					for (let k = nodes.length - 1; k >= 0; k--) if (o >= nodes[k].s) return [nodes[k].n, Math.min(o - nodes[k].s, nodes[k].n.nodeValue.length)];
					return [nodes[0].n, 0];
				};
				const r = document.createRange();
				const a = pos(s), b = pos(e);
				r.setStart(a[0], a[1]); r.setEnd(b[0], b[1]);
				span.appendChild(r.cloneContents());
			} else span.textContent = text.slice(s, e);
			box.appendChild(span);
		};
		let from = 0;
		hits.forEach((h, k) => {
			piece(from, h.cs);
			const chip = document.createElement("span");
			chip.className = "ssq-chip";
			const main = document.createElement("button");
			main.type = "button";
			main.className = "ssq-chip-main";
			main.setAttribute("title", "Open " + h.item.title + " in the query builder");
			main.innerHTML = '<span class="ti ti-bookmark"></span><span class="ssq-chip-label"></span>';
			main.querySelector(".ssq-chip-label").textContent = h.item.title;
			main.addEventListener("mousedown", (e) => e.preventDefault());
			main.addEventListener("click", (e) => {
				e.preventDefault(); e.stopPropagation();
				const ctx = this._context(input);
				if (ctx) this._qbOpen({ openAt: k }, ctx);
			});
			const x = document.createElement("button");
			x.type = "button";
			x.className = "ssq-chip-x";
			x.setAttribute("title", "Remove " + h.item.title + " from the filter");
			x.innerHTML = '<span class="ti ti-x"></span>';
			x.addEventListener("mousedown", (e) => e.preventDefault());
			x.addEventListener("click", (e) => {
				e.preventDefault(); e.stopPropagation();
				this._apply(input, this._chipWithout(text, h));
			});
			chip.appendChild(main); chip.appendChild(x);
			box.appendChild(chip);
			from = h.e;
		});
		piece(from, text.length);
	}

	// ── Healing a filter whose collection index came out empty ───────────────
	// Thymer bug (measured 2026-10-11, Thymer 1.0.20, reported to them): a plugin
	// reload nulls the sidebar's collection cache (`cachedAllCollections`) and it
	// refills asynchronously. A records view that remounts in that gap builds its
	// query index synchronously from the null cache (`createSearchIndex()`), gets
	// ZERO collections and never rebuilds it: every query then fails validation
	// with `No collection "X"` and the filter is dead until the app is refreshed.
	// Every config write of ours reloads the plugin, so we can set it off. The
	// heal: find each filter's query input, and when its index is empty while the
	// workspace has collections, build a new one exactly as Thymer does (same
	// class, same arguments, the collections from Thymer's own async getter) and
	// re-run the text in the field. Internals throughout, so every step is
	// guarded and it says so once in the console when they move.
	async _healFilterIndexes() {
		if (this._healing || window.__ssqLiveGen !== this._gen) return;
		this._healing = true;
		try {
			const root = window.g_focusedComponent && window.g_focusedComponent.root;
			const sb = root && root.sideBar;
			if (!sb) return;
			for (const input of document.querySelectorAll("input.query-input--field.is-collection-filter")) {
				const qi = this._queryInputOf(input, root);
				const ix = qi && qi.options && qi.options.index;
				if (!ix || !Array.isArray(ix.collections) || ix.collections.length) continue;
				const cache = (sb.getCachedNotTrashedCollections && sb.getCachedNotTrashedCollections())
					|| (sb.getAllCollectionsExceptTrashedByGuid && await sb.getAllCollectionsExceptTrashedByGuid());
				if (!cache || !cache.size) continue;   // the workspace really is empty, or not loaded yet
				const fresh = new ix.constructor(ix.wsguid, ix.userguid, Array.from(cache.values()), ix.users);
				if (!fresh.collections || !fresh.collections.length) continue;
				fresh.resolvePageByName = ix.resolvePageByName;
				qi.options.index = fresh;
				// The input resolved its own collection from the index when it was
				// built (empty then), the same way: look it up again.
				if (qi.singleCollectionGuid && fresh.plugins) {
					for (const k in fresh.plugins) {
						const r = fresh.collection_by_name_or_guid[k];
						if (r && r[0].guid === qi.singleCollectionGuid) { qi.singleCollectionPlugin = r[1]; break; }
					}
				}
				// The text in the field failed validation and was never applied: run
				// it again (not while someone is typing in it; their next key does).
				if (input.value.trim() && document.activeElement !== input) this._apply(input, input.value);
			}
		} catch (e) {
			if (!this._healWarned) { this._healWarned = true; console.warn("[Smart Searches] could not check the filter index (Thymer internals moved?)", e); }
		} finally {
			this._healing = false;
		}
	}

	// The component that owns a filter field's query input, found once per field
	// by walking Thymer's component tree, then remembered.
	_queryInputOf(input, root) {
		const map = this._qiMap || (this._qiMap = new WeakMap());
		if (map.has(input)) {
			const hit = map.get(input);
			if (!hit || (hit.input === input && !hit._destroyed)) return hit;   // a remembered miss stays a miss
		}
		const seen = new Set();
		const queue = [root];
		while (queue.length) {
			const c = queue.shift();
			if (!c || seen.has(c) || seen.size > 20000) continue;
			seen.add(c);
			if (c.queryInput && c.queryInput.input === input) { map.set(input, c.queryInput); return c.queryInput; }
			if (c.recordsView) queue.push(c.recordsView);
			for (const k of (c.children || [])) queue.push(k);
		}
		map.set(input, null);
		return null;
	}

	// The field text with one recognised operand taken out, together with the
	// joiner that tied it to its neighbour. A lone saved search left in brackets
	// loses them, so it reads exactly as if it had been loaded on its own.
	_chipWithout(text, hit) {
		const parts = this._ssSplit(text);
		const pi = parts.findIndex((p) => p.s === hit.s && p.e === hit.e);
		let out;
		if (pi < 0 || parts.length < 2) out = "";
		else if (pi > 0) out = text.slice(0, parts[pi - 1].e) + text.slice(hit.e);
		else out = text.slice(0, hit.s) + text.slice(parts[1].s);
		out = out.trim();
		if (this._isWrapped(out)) {
			const inner = out.slice(1, -1).trim();
			if (this._items().some((x) => (x.query || "").trim() === inner)) out = inner;
		}
		return out;
	}

	// The colour actually painted behind the field (the input itself is often
	// transparent): the first ancestor with a background.
	_chipBg(el) {
		for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
			const c = getComputedStyle(e).backgroundColor;
			if (c && c !== "transparent" && !/rgba\([^)]*,\s*0\)$/.test(c)) return c;
		}
		return "var(--panel-bg-color, #121417)";
	}

	// ── The bookmark ─────────────────────────────────────────────────────────
	// The bookmark opens the builder (his call, 2026-10-11: one panel, the library
	// is the saved row's picker); an empty field opens on the library. A second
	// press closes it, keeping what it applied, like Done.
	_togglePopup(btn) {
		if (this._qb) { this._qbClose(false); return; }
		const ctx = this._context(btn);
		if (!ctx) return;
		this._popBtn = btn;
		this._qbOpen({ library: true }, ctx);
	}

	// What is left of the old popup's teardown: a sweep for one an older build
	// left on screen, and the deferred config write.
	_closePopup() {
		document.querySelectorAll(".ssq-pop").forEach((p) => p.remove());
		this._flush();
	}

	// Fold state lives in localStorage only — it's per-device UI state, and writing
	// it to the synced config would reload the plugin on every toggle.
	_folds() {
		if (!this._foldCache) {
			try { this._foldCache = JSON.parse(window.localStorage.getItem("ssq_folds") || "{}") || {}; }
			catch (e) { this._foldCache = {}; }
		}
		return this._foldCache;
	}
	_saveFolds(f) {
		this._foldCache = f;
		try { window.localStorage.setItem("ssq_folds", JSON.stringify(f)); } catch (e) {}
	}

	// A first guess at a title: the query with its leading "@Collection." dropped,
	// since that part is the same for every search in the collection.
	_suggestTitle(query, ctx) {
		let t = query.replace(/^@[^\s.]+\.?\s*/, "").trim() || query;
		if (t.length > Plugin.TITLE_SUGGEST_MAX) t = t.slice(0, Plugin.TITLE_SUGGEST_MAX - 1).trim() + "…";
		return t;
	}

	// ── Refresh button on live search blocks ─────────────────────────────────
	// A live search block is a line of type "query". It renders as
	// .listitem.listitem-query, and its $line element is
	// .query-container-div.container-border — the bordered, padded box that
	// visually holds the whole block, results included (they are nested inside
	// it, .container-border > .block-content > .listitem). That box IS the line
	// element, so nothing of ours goes inside it: the golden rule is never to
	// insert a node into a line the editor may edit. The button is a floating
	// node parented to the block's own scroll container instead, so it rides
	// the scroll natively at zero lag, and it is placed by measuring the box.
	//
	// Refreshing is Thymer's own work: the container behind the block carries a
	// `queryHelper` (an unminified property, so a plugin can reach it) whose
	// async up() clears the results, paints "(Loading...)", re-runs
	// searchItemsByQuery and rebuilds the rows. That is precisely a refresh.
	// The helper object is Object.seal'ed — call the method, never add to it.

	// Rebuild the list of rendered query blocks. Runs on the debounced attach
	// cycle, so the per-frame pass below only ever measures.
	_qScan() {
		if (!this._qBtns) return;
		// guid → the container helper that owns that block's results.
		const helpers = new Map();
		try {
			const u = window.g_universe;
			// g_universe is null until the user first clicks into an editor, so a
			// scan that comes up empty is normal — the next cycle picks it up.
			for (const lv of (u && u.listviews) || []) {
				for (const c of (lv && lv.containers) || []) {
					const st = c && c.container_state;
					if (!st || st.type !== "query" || st.is_deleted || st.is_trashed) continue;
					// The EDIT chip needs only the block; the REFRESH chip still demands
					// a helper whose loader we can prove (the renamed-method lesson —
					// a rename hides refresh instead of shipping a dud). A NEW block
					// (Thymer's Live Query prompt, or an empty query) has no helper
					// yet, and hiding the pencil there was exactly backwards: the
					// empty block is where the builder helps most (his report,
					// 2026-08-14, after the Live Query update).
					const live = !!(c.queryHelper && this._qLoaderName(c.queryHelper));
					if (live) this._qHelperCtor = Object.getPrototypeOf(c.queryHelper).constructor;
					helpers.set(st.guid, live);
				}
			}
		} catch (e) { /* internals moved; the buttons simply don't appear */ }

		const blocks = [];
		const seen = new Set();
		document.querySelectorAll(".listitem.listitem-query").forEach((el) => {
			// A folded block collapses to a small label and shows no results (and
			// Thymer removes its own pill there), so there is nothing to refresh
			// and nothing to align to.
			if (el.classList.contains("listitem-folded")) return;
			const guid = el.getAttribute("data-guid");
			if (!guid) return;
			const box = el.querySelector(":scope > .query-container-div");
			if (!box) return;
			// One block can be on screen in two panels at once.
			let key = guid, n = 0;
			while (seen.has(key)) key = guid + ":" + (++n);
			seen.add(key);
			blocks.push({ key, guid, el, box, live: helpers.get(guid) === true });
		});
		this._qBlocks = blocks;

		// Retire buttons whose block is gone.
		for (const [key, btn] of this._qBtns) {
			if (!seen.has(key)) { btn.remove(); this._qBtns.delete(key); }
		}
		this._qSync();
	}

	// Coalesce scroll / resize / pointer moves into one measure per frame.
	_onQNudge() {
		if (this._qRaf || !this._qBtns) return;
		this._qRaf = requestAnimationFrame(() => {
			this._qRaf = 0;
			if (!this._qBtns) return;
			// THE COLD-START HOLE (2026-08-10, "refresh knappen har slutat funka"):
			// g_universe is null until the user first clicks into an editor, so a
			// scan that runs while the app is still settling finds no containers
			// and leaves _qBlocks empty. Recovery used to hang off mousedown
			// only — but hovering a block to use the button is not a mousedown,
			// so after a restart the buttons never came back until something
			// unrelated was clicked. Blocks on screen with none known means the
			// last scan was too early: scan again (debounced, so at most one
			// per 120ms, and the querySelector only runs while we know nothing).
			if (!this._qBlocks.length && document.querySelector(".listitem.listitem-query")) this._scheduleAttach();
			this._qSync();
		});
	}

	// Measure every known block and place its button. No DOM reads of anything
	// but rects, so this is cheap enough to run every frame.
	_qSync() {
		if (!this._qBtns) return;
		for (const b of this._qBlocks) {
			if (!b.el.isConnected) { const old = this._qBtns.get(b.key); if (old) { old.remove(); this._qBtns.delete(b.key); } continue; }
			const btn = this._qButton(b);
			if (!btn) continue;
			// The refresh chip only appears once the block has a provable loader.
			const rc = btn.querySelector(".ssq-refresh");
			if (rc) rc.style.display = b.live ? "" : "none";
			const r = b.box.getBoundingClientRect();
			// A folded-away or off-screen block can keep one dimension while the
			// other collapses; either being gone means the block is not showing.
			if (r.width < 2 || r.height < 2) { btn.classList.remove("ssq-on"); continue; }

			// Align to the native "query" pill (.block-nstype-button, which
			// Thymer draws on this same box at top:-10px right:10px and reveals
			// on hover): same top, same height, sitting just to its left, so the
			// two read as one row of controls rather than two loose chips.
			const pill = b.box.querySelector(":scope > .block-nstype-button");
			const pr = pill ? pill.getBoundingClientRect() : null;
			const h = pr && pr.height > 2 ? pr.height : 20;
			const top = pr && pr.height > 2 ? pr.top : r.top - 10;
			const rightEdge = pr && pr.width > 2 ? pr.left - 6 : r.right - 10;

			// OCCLUSION: the button floats over the page, so a block scrolled
			// under a sticky bar or covered by another surface would keep its
			// button drawn on top. Probe the block's own top edge, horizontally
			// centred so the probe lands on the block and never on our own
			// button or the pill; if the topmost element there is not inside
			// this block, the block is not the visible thing at that spot.
			const probe = document.elementFromPoint(
				Math.round(r.left + r.width / 2),
				Math.round(r.top + Math.min(6, r.height / 2))
			);
			const visible = !!probe && (probe === b.el || b.el.contains(probe));

			// PLACE-MEASURE-CORRECT: shift the current offsets by the error in
			// viewport space, whichever coordinate space the parent uses. Skip
			// sub-pixel deltas so a settled button writes no styles at all.
			if (btn.style.height !== h + "px") btn.style.height = h + "px";
			const br = btn.getBoundingClientRect();
			const dx = (rightEdge - br.width) - br.left;
			const dy = top - br.top;
			if (Math.abs(dx) > 0.5) btn.style.left = ((parseFloat(btn.style.left) || 0) + dx) + "px";
			if (Math.abs(dy) > 0.5) btn.style.top = ((parseFloat(btn.style.top) || 0) + dy) + "px";

			// Hover-only, on the same trigger as Thymer's own pill: the pointer
			// over the block, or over the button itself (which straddles the top
			// border, so there is no dead gap to cross between the two). A block
			// nested inside another keeps only the inner one's button, matching
			// the app's own :has(.container-border:hover) rule.
			let hot = false, mine = false;
			try {
				mine = btn.matches(":hover");
				hot = visible
					&& (b.box.matches(":hover") || mine)
					&& !b.box.querySelector(".container-border:hover");
			} catch (e) { /* :hover unsupported in matches() — leave it hidden */ }
			btn.classList.toggle("ssq-on", hot);
			// Hold the native pill lit while our button has the pointer, so the
			// pair reads as one control instead of the pill blinking out as you
			// reach for the refresh. Transient hover state only — a re-render
			// dropping the class costs nothing, the next frame re-applies it.
			if (pill) pill.classList.toggle("ssq-peer-hot", hot && mine);
		}
	}

	// The floating button for one block, created on demand. Re-parented (and so
	// remade) if the block moved to a different scroller — a panel move or a
	// view rebuild does that.
	_qButton(b) {
		const parent = this._scrollParentOf(b.el) || document.body;
		let btn = this._qBtns.get(b.key);
		if (btn && btn.parentNode !== parent) { btn.remove(); btn = null; }
		if (!btn) {
			// A wrapper holding TWO chips — edit-in-builder and refresh — so the
			// measuring/placing machinery keeps dealing with exactly one rect.
			// The chips wear the native pill's look (see .ssq-qchip); refresh keeps
			// its old spot nearest the pill.
			btn = document.createElement("span");
			btn.className = "ssq-qwrap";
			const chip = (cls, icon, tip) => {
				const c = document.createElement("span");
				c.className = "tooltip ti " + icon + " ssq-qchip " + cls;
				c.setAttribute("data-tooltip", tip);
				c.setAttribute("data-tooltip-dir", "top");
				c.setAttribute("aria-label", tip);
				btn.appendChild(c);
				return c;
			};
			const edit = chip("ssq-qedit", "ti-adjustments", "Edit in the query builder");
			const refresh = chip("ssq-refresh", "ti-refresh", "Refresh results");
			// Keep the press off the editor: a mousedown reaching the block would
			// move the caret into it.
			btn.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
			edit.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				this._qbOpenBlock(b.guid);
			});
			refresh.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				this._qRefresh(b.guid, refresh);
			});
			// Inside a scroller: absolute, with a modest z so the app's own
			// sticky chrome still covers it. Body parenting is the fallback.
			if (parent === document.body) { btn.style.position = "fixed"; btn.style.zIndex = "9000"; }
			else { btn.style.position = "absolute"; btn.style.zIndex = "5"; }
			parent.appendChild(btn);
			this._qBtns.set(b.key, btn);
		}
		return btn;
	}

	// ── The builder on a live search block ──────────────────────────────────
	// Same builder, different target: instead of the collection filter field it
	// reads and writes the block's `filter_expr` meta property, and re-runs the
	// block the same way the refresh chip does. Differences that follow from the
	// target being DATA rather than UI state:
	//  - nothing is written on open, and a query that compiles to "" is never
	//    written mid-edit (an unfinished row compiles to "", and an empty
	//    filter_expr means @today — the block would visibly jump);
	//  - the debounce is longer (500ms), because every apply is a synced write;
	//  - Cancel rewrites the ORIGINAL query, but only if we actually applied
	//    something;
	//  - there is no Save as… — saved searches are filed per collection, and a
	//    live search belongs to a page, not a collection.
	_qBlockQuery(guid) {
		const c = this._qContainerFor(guid);
		let st = c && c.container_state;
		// An EMPTY block (Thymer's new Live Query prompt) may have no container at
		// all yet; the line's own universe state still knows its meta and record.
		if (!st) { try { st = window.g_universe.itemsByGuid[guid].state; } catch (e) { st = null; } }
		const q = st && ((st.props && st.props.filter_expr) != null
			? st.props.filter_expr
			: (st.mp && st.mp.filter_expr));
		return (typeof q === "string" ? q : "").trim();
	}

	// The record guid a block's line belongs to, container or not.
	_qBlockRguid(guid) {
		const c = this._qContainerFor(guid);
		if (c && c.container_state && c.container_state.rguid) return c.container_state.rguid;
		// A JOURNAL block (his failing case, measured over CDP 2026-08-14): the
		// container does not exist yet, itemsByGuid's raw item carries only the
		// DATELESS section form `S-<guid>-P…` — which getRecord rejects — but
		// the DOM section above the block carries the FULL dated journal guid
		// (`S-…-P…-0-YYYYMMDD`), and getRecord accepts THAT. The block is always
		// on screen when the builder writes to it, so the DOM is fair game.
		try {
			const el = document.querySelector('.listitem.listitem-query[data-guid="' + guid + '"]');
			const sec = el && el.closest('[data-guid^="S-"]');
			const g = sec && sec.getAttribute("data-guid");
			if (g) return g;
		} catch (e) { /* fall through */ }
		// Raw item as the last resort — fields sit DIRECTLY on the object now,
		// `.state` is gone (the old read threw and every journal block "had no
		// record", which is why his new live queries were never written).
		try {
			const it = window.g_universe.itemsByGuid[guid];
			return (it && (it.rguid || (it.state && it.state.rguid))) || "";
		} catch (e) { return ""; }
	}


	async _qBlockApply(guid, q) {
		try {
			const rguid = this._qBlockRguid(guid);
			if (!rguid) { console.warn("[Smart Searches] block has no record"); return false; }
			let rec = this.data.getRecord(rguid);
			if (rec && typeof rec.then === "function") rec = await rec;
			if (!rec) { console.warn("[Smart Searches] block record not found"); return false; }
			let items = rec.getLineItems(false);
			if (items && typeof items.then === "function") items = await items;
			const li = (items || []).find((x) => {
				try { return x.guid === guid || (x._getItem && x._getItem().guid === guid); } catch (e) { return false; }
			});
			if (!li) { console.warn("[Smart Searches] block line not found on its record"); return false; }
			const w = li.setMetaProperty("filter_expr", q);
			if (w && typeof w.then === "function") await w;
			// Re-run exactly as the refresh chip does — reconstruct the helper.
			// (Never call its loader; see _qRefresh for the whole story.) A block
			// that never had a helper gets one built from the constructor cached
			// off any live block — the same `new QueryHelper(container)` Thymer's
			// own loader runs; with no container at all we leave it to Thymer,
			// which picks the new filter_expr up on its own render pass.
			const c2 = this._qContainerFor(guid);
			if (c2) {
				const Ctor = (c2.queryHelper && this._qLoaderName(c2.queryHelper))
					? Object.getPrototypeOf(c2.queryHelper).constructor
					: this._qHelperCtor;
				if (Ctor) {
					c2.root_item = null;
					c2.queryHelper = new Ctor(c2);
				}
			}
			return true;
		} catch (e) {
			// Never swallow this silently — the mute-catch lesson was paid for once.
			console.warn("[Smart Searches] applying to the block failed", e);
			return false;
		}
	}

	async _qbOpenBlock(guid) {
		this._closePopup();
		this._qbClose(false);
		await this._qbLoadCollections(true);
		const q = this._qBlockQuery(guid);
		const parsed = q ? this._qbParse(q) : null;
		this._qb = {
			block: guid,
			input: null,
			prevQuery: q,
			applied: q,                       // what the block currently shows
			col: "", colName: "", viewId: "", viewName: "", isTasks: false,
			sources: this._qbCols || [],      // a live search spans collections
			// No preselected source (his call: Any item must be pickable, never
			// picked FOR you) — a fresh row is one bare "Item ..." picker until
			// the first choice fills the columns it needs.
			defaultSrc: "",
			lockSrc: false,
			model: this._qbNormalize(parsed || { join: "AND", rows: [] }),
			title: "", editId: null,
			naming: false,
		};
		if (!this._qb.model.rows.length) this._qbAddRow();
		this._qbBuild();
		// No apply on open: the block already shows exactly this query.
	}

	// Recognise the query-helper class by SIGNATURE, never by method name.
	//
	// `queryHelper` is a real, unminified property and is stable. Its METHODS are
	// minified and Thymer reshuffles them between builds: the loader was `up()`
	// in the bundle this was first written against and `hp()` in the one shipped
	// days later, with every sibling renamed too (oc→rc, rc→lc, cc→dc, Yn→qn).
	// Binding to any of those names is a time bomb, and it went off silently —
	// `typeof helper.up !== "function"` just returned, so the button spun and did
	// nothing (2026-08-10, measured live over CDP).
	//
	// String literals survive minification, so the class is identified by what it
	// demonstrably IS: it has one async method that paints "(Loading...)" and
	// calls searchItemsByQuery. That method is the loader. We do NOT call it —
	// see _qRefresh for why — we only use it to prove we hold the right object.
	// Cached per prototype.
	_qLoaderName(helper) {
		let proto = null;
		try { proto = Object.getPrototypeOf(helper); } catch (e) { return null; }
		if (!proto) return null;
		if (this._qLoaderCache && this._qLoaderCache.proto === proto) return this._qLoaderCache.name;
		for (const name of Object.getOwnPropertyNames(proto)) {
			if (name === "constructor") continue;
			let src = "";
			try {
				const fn = proto[name];
				if (typeof fn !== "function") continue;
				src = Function.prototype.toString.call(fn);
			} catch (e) { continue; }
			if (!/^async\b/.test(src)) continue;
			if (src.indexOf("(Loading...)") < 0 || src.indexOf("searchItemsByQuery") < 0) continue;
			this._qLoaderCache = { proto, name };
			return name;
		}
		// Signature gone = Thymer changed something real. Say so once, loudly
		// enough to be findable, instead of failing mute like last time.
		if (!this._qLoaderWarned) {
			this._qLoaderWarned = true;
			console.warn("[Smart Searches] could not find the live-search refresh method on queryHelper — Thymer's internals moved. The refresh button will stay hidden.");
		}
		return null;
	}

	// The container helper that owns a block's results, or null.
	_qContainerFor(guid) {
		try {
			for (const lv of (window.g_universe && window.g_universe.listviews) || []) {
				for (const c of (lv && lv.containers) || []) {
					if (c && c.queryHelper && c.container_state && c.container_state.guid === guid) return c;
				}
			}
		} catch (e) { /* internals moved */ }
		return null;
	}

	// Re-run one block's query.
	//
	// Calling the loader method directly does NOT work, and this cost a round to
	// establish. Measured live: the loader is not re-entrant on a container that
	// is already rendered. Its own reset runs, the data comes back correct (the
	// root item ends up holding the right children and itemsInQuery repopulates),
	// but no rows reach the DOM — the block empties and only repairs itself later,
	// when Thymer's incremental queue happens to touch it. Three variants of
	// "reset harder first" (its internal reset, destroying the item views, nulling
	// the root item) all still rendered zero rows.
	//
	// What DOES work is doing exactly what Thymer's own loader does for a query
	// container — `this.queryHelper = new <QueryHelper>(this)` — because that
	// constructor ends by kicking off the load itself against a container it has
	// set up from scratch. Verified live across all seven of Parham's blocks:
	// helper replaced, query genuinely re-run, row counts preserved (1/2/4/4/7/9)
	// and item views reused, so it does not flicker.
	//
	// The spin is Thymer's own .animate__spin-once (0.4s), the same feedback its
	// search panel gives; the load paints "(Loading...)" into the block itself.
	_qRefresh(guid, btn) {
		const container = this._qContainerFor(guid);
		// The loader lookup is the proof we hold a genuine query helper; if the
		// signature is gone, Thymer changed something real and we do nothing.
		if (!container || !this._qLoaderName(container.queryHelper)) return;
		btn.classList.remove("animate__spin-once");
		void btn.offsetWidth; // restart the animation on a repeated click
		btn.classList.add("animate__spin-once");
		setTimeout(() => btn.classList.remove("animate__spin-once"), 400);
		try {
			const Ctor = Object.getPrototypeOf(container.queryHelper).constructor;
			// The container must forget its old root item or the fresh helper
			// reuses it and the rebuild renders nothing.
			container.root_item = null;
			container.queryHelper = new Ctor(container);
			// The constructor starts the load and returns nothing to await;
			// Thymer renders its own "Error: …" inside the block if it fails.
		} catch (e) {
			// Never swallow this silently — a mute catch is exactly what hid the
			// renamed-method bug behind a button that looked like it worked.
			console.warn("[Smart Searches] refresh failed", e);
		}
	}

	// The nearest ancestor that actually scrolls, so a button parented into it
	// moves with the content instead of chasing it a frame behind.
	_scrollParentOf(el) {
		let p = el.parentElement;
		while (p && p !== document.body) {
			const cs = getComputedStyle(p);
			if (/(auto|scroll|overlay)/.test(cs.overflowY + " " + cs.overflowX)
				&& (p.scrollHeight > p.clientHeight + 1 || p.scrollWidth > p.clientWidth + 1)) return p;
			p = p.parentElement;
		}
		return null;
	}

	// ── Global handlers ──────────────────────────────────────────────────────
	_onDocDown(e) {
		// g_universe — and so every query block's refresh button — does not exist
		// until the user first clicks into an editor. That click is the signal to
		// rescan; the cycle is debounced, so this costs nothing.
		if (this._qBtns && !this._qBlocks.length) this._scheduleAttach();
	}

	_onKeyDown(e) {
		// Escape backs out of the builder one layer at a time: an open menu or
		// calendar first (they have their own handlers and stop the event there),
		// then the builder itself. Leaving is a CANCEL, like the × — the field goes
		// back to whatever it held before the builder opened.
		// (This listener is document-CAPTURE and was registered at load, so it runs
		// before the menu's, the calendar's and the name field's own handlers — hence
		// the explicit guards rather than relying on them to stop the event first.)
		// Escape releases a selected group before anything else closes. (Tab no
		// longer indents: hijacking it broke tabbing between the columns — his
		// report 2026-08-14. Indent/outdent are the arrows on the group's box.)
		if (this._qb && this._qb.sel && !this._qbMenuEl && !this._qbRsCalOpen() && !this._qb.naming) {
			if (e.key === "Escape") {
				e.preventDefault(); e.stopPropagation();
				this._qb.sel = null;
				this._qbPaintSel();
				return;
			}
		}
		// ARROWS WALK THE CONTROLS (his ask 2026-08-15): left/right along a row,
		// up/down to the same column in the row above or below — the same path
		// Tab takes, minus the reaching. Only when no menu or calendar is open;
		// there the arrows belong to the list, which is why this sits behind the
		// same guards. In a TEXT field the caret keeps left/right until it sits
		// at the very edge of the text, the way a spreadsheet cell behaves.
		if (this._qb && this._qbEl && !this._qbMenuEl && !this._qbRsCalOpen() && !this._qb.naming
			&& !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey
			&& /^Arrow(Left|Right|Up|Down)$/.test(e.key)) {
			const ae = document.activeElement;
			if (ae && this._qbEl.contains(ae)) {
				const horiz = e.key === "ArrowLeft" || e.key === "ArrowRight";
				const isText = ae.tagName === "INPUT" || ae.tagName === "TEXTAREA";
				let pass = false;
				if (isText && horiz) {
					const s = ae.selectionStart, t = ae.selectionEnd, len = String(ae.value || "").length;
					if (e.key === "ArrowLeft") pass = !(s === 0 && t === 0);
					else pass = !(s === len && t === len);
				}
				if (!pass) {
					const to = this._qbNextControl(ae, e.key);
					if (to) {
						e.preventDefault(); e.stopPropagation();
						to.focus();
						if (to.select && to.tagName === "INPUT") to.select();
						return;
					}
				}
			}
		}
		// COPY / PASTE of a selected row or group (his ask 2026-08-15: click a
		// row's grip to select it, ⌘C, select another group, ⌘V). Only while the
		// builder is open, something is selected, no menu is up and the caret is
		// NOT in a text field — inside a value box ⌘C must stay the ordinary copy.
		// ⌘⇧C / ⌘⇧V land here too (`e.key` is the capital then), so whichever of
		// the pair survives Electron's Edit menu works.
		if (this._qb && this._qbEl && !this._qbMenuEl && !this._qbRsCalOpen() && !this._qb.naming
			&& (e.metaKey || e.ctrlKey) && !e.altKey) {
			const ae = document.activeElement;
			const typing = !!(ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable));
			const k = String(e.key || "").toLowerCase();
			if (!typing && k === "c" && this._qb.sel) {
				e.preventDefault(); e.stopPropagation();
				this._qbCopySel();
				return;
			}
			if (!typing && k === "v" && this._qbClip) {
				e.preventDefault(); e.stopPropagation();
				this._qbPasteSel();
				return;
			}
		}
		if (e.key === "Escape" && this._qb) {
			if (this._qbMenuEl) return;          // the menu's own handler closes it
			if (this._qbHelpPop) { e.preventDefault(); e.stopPropagation(); this._qbCloseHelp(); return; }
			if (this._qbRsCalOpen()) {
				// Handled here rather than on the calendar's input, which only sees the
				// key while it holds focus — click a day cell first and Escape was dead.
				// (Supertask's calendar too: Escape closes it, never the builder.)
				e.preventDefault(); e.stopPropagation();
				this._qbCloseCal();
				return;
			}
			if (this._qb.naming) return;         // the name field backs out to the rows
			e.preventDefault(); e.stopPropagation();
			this._qbClose(true);
			return;
		}
	}

	// =======================================================================
	// Query builder
	// -----------------------------------------------------------------------
	// Builds a query from pickers instead of typed syntax, and applies it to the
	// filter field on EVERY edit — you watch the rows change as you work, which is
	// how you find the query you actually wanted. Nothing is saved until you say so;
	// Cancel puts the field back exactly as it was.
	//
	// Field/operator/value choices come from the documented collection config
	// (`data.getAllCollections()` → `getConfiguration().fields`), never the DOM.
	// Each row carries its own source collection, so a dynamic collection (Finance:
	// Incomes / Expenses / Anchor) can be built up the way its queries really read.
	//
	// The condition MODEL is the unit of currency here, not the query text. It is a
	// TREE of plain-JSON nodes, saved alongside the compiled string:
	//   condition  {kind:"cond", src, field, type, op, value}
	//   group      {kind:"group", join:"AND"|"OR", rows:[node…]}   ← nesting
	//   raw        {kind:"raw", query, title}   verbatim text we chose not to interpret
	// The root is a group. `_qbCompile(model)` is a pure model→text function and the
	// only place that conversion happens. That is the seam a future AI assist plugs
	// into — it would emit a model (which we compile, show live, and let you correct),
	// so no query parser is ever needed on the way back in.
	// =======================================================================

	// Operators per property type. `empty` compares against "" (Thymer's unset test).
	// Names and glyphs copied from Thymer's own operator menu in the filter field
	// (Equals (=) / Not equals (≠) / Less than (<) / « / Greater than (>) / »),
	// so the two read as the same language.
	static QB_EQ = [{ v: "=", l: "Equals (=)", g: "=" }, { v: "!=", l: "Not equals (≠)", g: "≠" }];
	// …with ONE deliberate departure: on text, URL, file/image and record-link fields
	// Thymer's `=` is a CONTAINS match, not an equality, so calling it "Equals" there
	// misdescribes what the row does. Measured 2026-08-11, not assumed:
	// `@Actions.Title = "apartment"` returns the record titled "Move to a new
	// apartment", and on a record link `= "In "` returns the union of "In Progress"
	// and "In Backlog" (substring on the linked page's name). The SDK's own
	// search-queries.md says the same ("`=` is 'contains' match"). Choice is NOT in
	// this family — it matches the label exactly and rejects a partial outright.
	static QB_HAS = [{ v: "=", l: "Contains (=)", g: "=" }, { v: "!=", l: "Does not contain (≠)", g: "≠" }];
	static QB_CMP = [
		{ v: "=", l: "Equals (=)", g: "=" },
		{ v: "!=", l: "Not equals (≠)", g: "≠" },
		{ v: "<", l: "Less than (<)", g: "<" },
		{ v: "<=", l: "Less than or equal (≤)", g: "«" },
		{ v: ">", l: "Greater than (>)", g: ">" },
		{ v: ">=", l: "Greater than or equal (≥)", g: "»" },
	];
	// A page link matches on the linked page's NAME, and `=` is a CONTAINS — so
	// "Morning" also matches "Early Morning" and "Late Morning" (his report,
	// measured 2026-08-15). "Is exactly" pins the identity instead: it compiles
	// the name test AND `@linkto = "<page guid>"`, which is an identity match.
	// The name test stays in the text so the row keeps saying which property it
	// filters, and so the pair reads back as ONE row.
	static QB_EXACT = [{ v: "=", l: "Is exactly", g: "=", exact: true }];
	static QB_OPS = {
		choice:   Plugin.QB_EQ,     // exact label, case-insensitive
		user:     Plugin.QB_EQ,     // name/handle, fuzzy
		hashtag:  Plugin.QB_EQ,     // exact; #prefix/ does a prefix match
		record:   Plugin.QB_HAS,    // substring on the linked page's name
		number:   Plugin.QB_CMP,
		datetime: Plugin.QB_CMP,
		dynamic:  Plugin.QB_CMP,    // a formula column, usually numeric
		file:     Plugin.QB_HAS,    // contains, on the filename
		image:    Plugin.QB_HAS,
		banner:   Plugin.QB_HAS,
		_text:    Plugin.QB_HAS,    // text, url, plaintext, anything unmapped
	};
	// Parham's wording. NOTE the inversion, which is easy to get backwards: a field
	// that IS set is the one that is NOT empty, so "Set" compiles to `!= ""`.
	static QB_EMPTY = [{ v: "!=", l: "Set", g: "∅", empty: true }, { v: "=", l: "Not Set", g: "∅", empty: true }];

	// ── "Any item" — the built-in filters ───────────────────────────────────
	// A pseudo-source in the collection picker: not a collection but "any line in
	// Thymer", whose fields are the query language's built-in keys. Everything is
	// pickable from menus (his call: most people don't know the keywords by heart).
	// Every compiled form below was verified against the app before shipping —
	// except the rolling tokens as property values, where the MCP search endpoint
	// disagrees with the renderer (it rejects `= @today` while his own working live
	// search uses it); the renderer was taken as the authority and checked live.
	static ANY_ITEM = "Any item";
	static QB_IS = [{ v: "=", l: "Is", g: "=" }, { v: "!=", l: "Is not", g: "≠" }];
	static QB_BUILTINS = [
		{ label: "Status", type: "bi-kw", icon: "", choices: [
			// Labels and icons are Thymer's OWN, mined from the new smart query
			// input's suggestion engine (app-XWVHMSBJ) — same words, same glyphs.
			{ label: "Todo (not done) tasks", kw: "@todo", icon: "ti-checkbox" },
			{ label: "Done tasks", kw: "@done", icon: "ti-check" },
			{ label: "All tasks", kw: "@task", icon: "ti-checkbox" },
			{ label: "Tasks with due date", kw: "@due", icon: "ti-calendar" },
			{ label: "Overdue tasks", kw: "@overdue", icon: "ti-calendar-x" },
			{ label: "Work in progress", kw: "@inprogress", icon: "ti-player-play" },
			{ label: "Waiting (Blocked)", kw: "@waiting", icon: "ti-clock" },
			{ label: "Billable (Cost-related)", kw: "@billing", icon: "ti-currency-dollar" },
			{ label: "Important", kw: "@important", icon: "ti-alert-circle" },
			{ label: "Discuss (Question)", kw: "@discuss", icon: "ti-message-circle" },
			{ label: "Alert", kw: "@alert", icon: "ti-alert-triangle" },
			{ label: "Starred", kw: "@starred", icon: "ti-star" },
			{ label: "Canceled", kw: "@canceled", icon: "ti-slash" },
			{ label: "Has mentions", kw: "@mention", icon: "ti-at" },
			{ label: "Assigned tasks", kw: "@assigned", icon: "ti-user-check" },
			{ label: "Unassigned tasks", kw: "@unassigned", icon: "ti-user-x" },
			{ label: "Scheduled", kw: "@scheduled", icon: "ti-calendar" },
		] },
		{ label: "Type", type: "bi-kw", icon: "", choices: [
			{ label: "Page", kw: "@page", icon: "ti-file" },
			{ label: "Headings", kw: "@heading", icon: "ti-h-1" },
			{ label: "Text items", kw: "@text", icon: "ti-pilcrow" },
			{ label: "Quotes", kw: "@quote", icon: "ti-quote" },
			{ label: "Lists", kw: "@list", icon: "ti-list" },
			{ label: "Images", kw: "@image", icon: "ti-photo" },
			{ label: "Files", kw: "@file", icon: "ti-file" },
		] },
		// The standalone date keywords — `@today` filters to items dated today, the
		// same family the engine resolves after task keywords (SDK search-queries.md).
		// As chips they make `@todo @nextweek` read back as two editable words
		// instead of one verbatim string. Weekday keywords stay out: 14 more menu
		// rows for a form nobody has used here (grep his 161 searches first).
		// `pick: false` keeps it OUT of the field menu: `@today` and `@date =
		// "today"` mean the same thing, and two Date fields with different value
		// lists read as a difference that is not there (his report). The keywords
		// stay reachable as one-gesture picks in the FIRST menu, and read back as
		// chips. All icons ti-calendar: ti-calendar-week/-month do not exist in
		// the icon font — those rows rendered iconless.
		{ label: "Date is", type: "bi-kw", icon: "", pick: false, choices: [
			{ label: "Today", kw: "@today", icon: "ti-calendar" },
			{ label: "Tomorrow", kw: "@tomorrow", icon: "ti-calendar" },
			{ label: "Yesterday", kw: "@yesterday", icon: "ti-calendar" },
			{ label: "This week", kw: "@thisweek", icon: "ti-calendar" },
			{ label: "Next week", kw: "@nextweek", icon: "ti-calendar" },
			{ label: "Last week", kw: "@lastweek", icon: "ti-calendar" },
			{ label: "This month", kw: "@thismonth", icon: "ti-calendar" },
			{ label: "This year", kw: "@thisyear", icon: "ti-calendar" },
		] },
		{ label: "Collection", type: "bi-coll", icon: "ti-folders" },
		{ label: "Hashtag", type: "bi-tag", icon: "ti-tag" },
		{ label: "Contains text", type: "bi-text", icon: "ti-abc", key: "@text" },
		{ label: "Link", type: "bi-text", icon: "ti-abc", key: "@link" },
		{ label: "Date", type: "bi-date", icon: "ti-calendar-event", key: "@date" },
		{ label: "Due", type: "bi-date", icon: "ti-calendar-event", key: "@due" },
		{ label: "Created", type: "bi-date", icon: "ti-clock-plus", key: "@created_at" },
		{ label: "Modified", type: "bi-date", icon: "ti-clock-edit", key: "@modified_at" },
		{ label: "Created by", type: "bi-user", icon: "ti-user", key: "@created_by" },
		{ label: "Modified by", type: "bi-user", icon: "ti-user", key: "@modified_by" },
		{ label: "Mentions", type: "bi-user", icon: "ti-user", key: "@mention" },
		{ label: "Scheduled for", type: "bi-user", icon: "ti-user", key: "@scheduled" },
	];
	// Rolling date values for every datetime field, collection properties included —
	// his weekly-plan search is exactly `"Due Date" = @thisweek` and `= "-monday"`.
	// The menu compiles QUOTED natural language ("today", "this week", "-monday"):
	// every one verified against the renderer, and still ROLLING — the words are
	// re-parsed each run. The @-token family is only PARTLY valid as a property
	// value (measured: = @thisweek passes, = @today is "Cannot parse date", despite
	// the SDK doc's example), so tokens found in existing queries are preserved
	// verbatim but never emitted for new picks.
	// Every unit runs PRESENT → FUTURE → PAST (This / Next / Last), and the
	// weekdays start at Next because they have no distinct present: measured
	// 2026-08-18 against the engine, `@monday`, `@"this monday"` and
	// `@"next monday"` return the IDENTICAL result set (the coming Monday),
	// while `@"last monday"` and `@"-monday"` return the other, also identical
	// one. Offering "This Monday" would be a second label for a day already in
	// the list. An unknown token is not silently ignored either — the engine
	// answers `Unknown magic tag`, which is how each of these was checked.
	static QB_DATE_TOKENS = [
		{ v: "today", label: "Today" }, { v: "tomorrow", label: "Tomorrow" }, { v: "yesterday", label: "Yesterday" },
		{ v: "this week", label: "This week" }, { v: "next week", label: "Next week" }, { v: "last week", label: "Last week" },
		{ v: "this month", label: "This month" }, { v: "next month", label: "Next month" }, { v: "last month", label: "Last month" },
		{ v: "this year", label: "This year" }, { v: "next year", label: "Next year" }, { v: "last year", label: "Last year" },
		{ v: "monday", label: "Next Monday" }, { v: "-monday", label: "Last Monday" },
		{ v: "tuesday", label: "Next Tuesday" }, { v: "-tuesday", label: "Last Tuesday" },
		{ v: "wednesday", label: "Next Wednesday" }, { v: "-wednesday", label: "Last Wednesday" },
		{ v: "thursday", label: "Next Thursday" }, { v: "-thursday", label: "Last Thursday" },
		{ v: "friday", label: "Next Friday" }, { v: "-friday", label: "Last Friday" },
		{ v: "saturday", label: "Next Saturday" }, { v: "-saturday", label: "Last Saturday" },
		{ v: "sunday", label: "Next Sunday" }, { v: "-sunday", label: "Last Sunday" },
	];

	_qbOpsFor(type) {
		const t = String(type || "");
		if (t.indexOf("bi-") === 0) {
			// Built-ins: keyword-ish fields are Is / Is not; dates compare; text
			// contains. None of them has an empty test — `@todo = ""` is not a thing.
			if (t === "bi-date") return Plugin.QB_CMP;
			if (t === "bi-text") return Plugin.QB_HAS;
			return Plugin.QB_IS;
		}
		const base = Plugin.QB_OPS[type] || Plugin.QB_OPS._text;
		if (t === "record") return base.concat(Plugin.QB_EXACT, Plugin.QB_EMPTY);
		return base.concat(Plugin.QB_EMPTY);
	}

	// The controls a keyboard can land on — the same set Tab reaches (the icon
	// buttons are spans and are not in that path, today or before).
	static QB_FOCUSABLE = ".qb-sel, .qb-val, .qb-add, .qb-btn, input.qb-val-input, .qb-val input";

	// Left/right = the next control in THIS row; up/down = the same column in
	// the row above or below. Columns are counted by position within the row, so
	// a shorter row lands on its last control rather than nothing.
	_qbNextControl(from, key) {
		if (!this._qbEl) return null;
		const row = from.closest(".qb-row, .qb-joinrow");
		if (!row) return null;
		const inRow = (r) => Array.prototype.slice.call(r.querySelectorAll(Plugin.QB_FOCUSABLE))
			.filter((el) => !el.disabled && el.offsetParent !== null);
		const mine = inRow(row);
		const i = mine.indexOf(from);
		if (i < 0) return null;
		if (key === "ArrowLeft") return mine[i - 1] || null;
		if (key === "ArrowRight") return mine[i + 1] || null;
		const rows = Array.prototype.slice.call(this._qbEl.querySelectorAll(".qb-row, .qb-joinrow"))
			.filter((r) => inRow(r).length);
		const at = rows.indexOf(row);
		const next = rows[at + (key === "ArrowDown" ? 1 : -1)];
		if (!next) return null;
		const cells = inRow(next);
		return cells[Math.min(i, cells.length - 1)] || null;
	}

	_qbOpSuffix(o) { return o && o.empty ? "|e" : (o && o.exact ? "|x" : ""); }

	// Picking an operator. "Is exactly" needs the picked page's GUID, and it has
	// to be resolved HERE — not left to whatever the value menu happened to have
	// cached. That was the bug he hit: switching the operator on five rows made
	// only the ones whose value list was already loaded stick, and the rest fell
	// back to Contains on the next compile, silently (measured: cold cache = 0 of
	// 5 exact, one warmed field = 1 of 5). If the value names no page, the row
	// says so and stays a Contains rather than lying about what it filters.
	async _qbPickOp(row, v) {
		row.op = v;
		if (/\|x$/.test(String(v)) && row.value && !row.vguid) {
			let opts = [];
			try { opts = await this._qbRecordOptions(row.src, row.field); } catch (e) { opts = []; }
			const hit = (opts || []).find((o) => o.name === row.value);
			if (hit && hit.guid) row.vguid = hit.guid;
			else {
				row.op = "=";
				this._qbFlash('No page named "' + row.value + '" to pin — kept as Contains');
			}
		}
		// Same guard the other model-level operations use: without a panel there
		// is nothing to rebuild, and it keeps the method drivable from the suite.
		if (this._qbEl) { this._qbBuild(); this._qbApply(); }
	}

	// The picked page's guid. Rows carry it from the moment the value is picked
	// (`vguid`); this is the fallback for a row that came back from TEXT, where
	// only the name survives — the options cache is already warm by then because
	// the value menu is what filled it.
	_qbGuidForValue(row) {
		const key = row.src + "|" + row.field;
		const opts = (this._qbRecCache || {})[key] || [];
		const hit = opts.find((o) => o.name === row.value);
		return hit ? hit.guid || "" : "";
	}

	// Quote a collection or field name only when it needs it.
	_qbTok(name) { return /^[A-Za-z0-9_]+$/.test(name || "") ? name : '"' + (name || "") + '"'; }

	// One row → one condition. Unfinished rows compile to nothing and are skipped.
	// A row with the NOT pill on compiles wrapped — `NOT (@X.y <= "today")` — the
	// only honest negation for a comparison: flipping the operator instead would
	// quietly change what empty values match.
	_qbRowQuery(row) {
		if (row.src === Plugin.ANY_ITEM) return this._qbBuiltinQuery(row);
		if (!row.src || !row.field) return "";
		const op = (this._qbOpsFor(row.type) || []).find((o) => o.v + this._qbOpSuffix(o) === row.op);
		const left = "@" + this._qbTok(row.src) + "." + this._qbTok(row.field);
		const neg = (q) => (row.neg && q ? "NOT (" + q + ")" : q);
		if (op && op.empty) return neg(left + " " + op.v + ' ""');
		if (op && op.exact) {
			const g = row.vguid || this._qbGuidForValue(row);
			// Without a guid (an unknown page name) there is nothing to pin, so the
			// row stays the ordinary contains rather than compiling to nothing.
			if (g && row.value) return neg(left + ' = "' + String(row.value).replace(/"/g, '\\"')
				+ '" AND @linkto = "' + g + '"');
		}
		if (row.value === "" || row.value == null) return "";
		const raw = String(row.value).trim();
		let v;
		if (row.type === "number" && /^-?\d+(\.\d+)?$/.test(raw)) v = raw;
		// A rolling token (`@thisweek`, `@today`) goes out UNQUOTED — the engine's own
		// token form, and what keeps a saved weekly search relative instead of frozen.
		else if (row.type === "datetime" && /^@[a-z]+$/i.test(raw)) v = raw.toLowerCase();
		else v = '"' + String(row.value).replace(/"/g, "") + '"';
		return neg(left + " " + (op ? op.v : "=") + " " + v);
	}

	// One "Any item" row → its query text. Keyword fields compile to the bare
	// keyword (negated with NOT), the collection field to @Name, hashtags to #tag,
	// and the keyed fields to `@key op value` with the same rolling-token rule as
	// collection dates.
	_qbBuiltinQuery(row) {
		const f = Plugin.QB_BUILTINS.find((x) => x.label === row.field);
		if (!f) return "";
		const neg = row.op === "!=";
		const wrapNeg = (t) => (neg ? "NOT " + t : t);
		if (f.type === "bi-kw") {
			const c = (f.choices || []).find((x) => x.label === row.value);
			return c ? wrapNeg(c.kw) : "";
		}
		if (f.type === "bi-coll") {
			if (!row.value) return "";
			return wrapNeg(/^[A-Za-z0-9_]+$/.test(row.value) ? "@" + row.value : '@"' + row.value + '"');
		}
		if (f.type === "bi-tag") {
			const v = String(row.value || "").trim().replace(/^#/, "");
			return v ? wrapNeg("#" + v) : "";
		}
		if (row.value === "" || row.value == null) return "";
		const raw = String(row.value).trim();
		const v = /^@[a-z]+$/i.test(raw) ? raw.toLowerCase() : '"' + raw.replace(/"/g, "") + '"';
		const q = f.key + " " + row.op + " " + v;
		// The NOT pill on a keyed comparison (`NOT (@due <= "today")`) — keyword
		// families never get here, their negation lives in the operator.
		return row.neg ? "NOT (" + q + ")" : q;
	}

	// The read-back for the same shapes, tried when a leaf is not a collection
	// condition. Anything it declines stays a verbatim chip, as ever.
	_qbParseBuiltin(t) {
		const A = Plugin.ANY_ITEM;
		let neg = false, x = t;
		const mN = /^NOT\s+(.+)$/i.exec(x);
		if (mN && !/^NOT\s/i.test(mN[1])) { neg = true; x = mN[1].trim(); }
		const op = neg ? "!=" : "=";
		let m = /^#([^\s()"]+)$/.exec(x);
		if (m) return { kind: "cond", src: A, field: "Hashtag", type: "bi-tag", op, value: m[1] };
		m = /^@([A-Za-z_]+)$/.exec(x);
		if (m) {
			const kw = "@" + m[1].toLowerCase();
			for (const f of Plugin.QB_BUILTINS) {
				const c = (f.choices || []).find((x2) => x2.kw === kw);
				if (c) return { kind: "cond", src: A, field: f.label, type: f.type, op, value: c.label };
			}
		}
		m = /^@("([^"]+)"|[A-Za-z0-9_]+)$/.exec(x);
		if (m) {
			const name = m[2] != null ? m[2] : m[1];
			if ((this._qbCols || []).some((c) => c.name === name))
				return { kind: "cond", src: A, field: "Collection", type: "bi-coll", op, value: name };
		}
		// Keyed forms only un-negated — `NOT @due <= x` stays verbatim rather than
		// pretending Is-not covers a comparison. The value may be quoted, an
		// @token, or a BARE word (`@due <= today` — quotes only protect spaces).
		if (!neg) {
			m = /^(@[a-z_]+)\s*(>=|<=|!=|=|>|<)\s*("([^"]*)"|@[a-z]+|-?[A-Za-z][A-Za-z0-9-]*)$/i.exec(x);
			if (m) {
				const f = Plugin.QB_BUILTINS.find((x2) => x2.key === m[1].toLowerCase());
				if (f) {
					const value = m[4] != null ? m[4] : m[3].toLowerCase();
					return { kind: "cond", src: A, field: f.label, type: f.type, op: m[2], value };
				}
			}
		}
		return null;
	}

	// ── The model is a tree ─────────────────────────────────────────────────
	// A node is a condition, a nested group, or a raw carry-over. Everything below
	// reads a node's kind through this one helper, so a model saved before groups
	// existed (flat rows, no `kind`) still answers correctly.
	static QB_MAX_DEPTH = 4;      // root, plus this many levels of nested groups
	// (was 2; his weekly-plan live search nests three levels below the root, and
	// with boxes laid flat the panel no longer pays a width cost for depth)

	_qbKind(n) { return (n && n.kind) || (n && Array.isArray(n.rows) ? "group" : "cond"); }

	// Bring any model — legacy or current — to the tree shape. The old separate
	// `base` chip was a raw node in all but name, so it becomes one; that is what
	// lets it sit at its real place in the tree instead of always leading.
	//
	// Negation is PER NODE (`neg` on cond/group/raw; keyword-family conds carry
	// it in their operator instead). NOT as a LEVEL joiner predates that and
	// says the same thing — exclude everything after the head — so a legacy
	// NOT level is rewritten to an AND level with its tail nodes negated: the
	// UI keeps ONE negation concept, the red NOT on a row's lead.
	_qbNormalize(model) {
		const g = (model && typeof model === "object") ? model : {};
		const rows = Array.isArray(g.rows) ? g.rows.slice() : [];
		if (g.base && g.base.query) rows.unshift({ kind: "raw", query: g.base.query, title: g.base.title || "" });
		const walk = (n) => {
			const k = this._qbKind(n);
			if (k === "group") {
				const J = (n.join || "AND").toUpperCase();
				const out = { kind: "group", join: "AND", rows: (n.rows || []).map(walk), neg: !!n.neg, j: n.j };
				if (J === "NOT") {
					out.rows = out.rows.map((r, i) => (i === 0 ? r : this._qbToggleNeg(r)));
				}
				// Joiners are PER ROW (`j`); a legacy level joiner becomes each
				// row\u2019s own, so older saved models open exactly as they meant.
				out.rows.forEach((r, i) => {
					if (i > 0) r.j = String(r.j || (J === "NOT" ? "AND" : J)).toUpperCase();
				});
				// NOTE: the old single-child-wrapper HOIST lived here and in
				// _qbPrune. REMOVED (his report): outdenting the second-to-last
				// group collapsed the wrapper and dumped the remaining child a
				// level up. The render problems the hoist once fixed (empty
				// divider rows, doubled add-buttons) no longer exist, and depth
				// is visible now — a wrapper with one child is a legitimate box.
				return out;
			}
			if (k === "raw") return { kind: "raw", query: n.query || "", title: n.title || "", neg: !!n.neg, j: n.j };
			if (k === "saved") {
				const s = {
					kind: "saved", sid: n.sid || null, title: n.title || "", query: n.query || "",
					rows: (n.rows || []).map(walk), open: !!n.open, neg: !!n.neg, j: n.j,
				};
				s.rows.forEach((r, i) => { if (i > 0) r.j = String(r.j || "AND").toUpperCase(); });
				s.base = n.base != null ? n.base : this._qbGroupQuery(s);
				return s;
			}
			const c = {
				kind: "cond", src: n.src || "", field: n.field || "",
				type: n.type || "plaintext", op: n.op || "=",
				value: n.value == null ? "" : n.value,
				neg: !!n.neg,
				j: n.j,
			};
			// The picked page's guid rides along with an "Is exactly" row — it IS
			// the condition, and normalize used to drop every key it did not list,
			// which quietly turned the row back into a plain contains.
			if (n.vguid) c.vguid = n.vguid;
			return c;
		};
		return walk({ kind: "group", join: g.join, rows });
	}

	// Flip a node's negation the way its kind expresses it: keyword-family
	// conditions through Is/Is-not, everything else through the neg flag.
	_qbToggleNeg(n) {
		if (this._qbKind(n) === "cond") return this._qbNegateCond(n);
		n.neg = !n.neg;
		return n;
	}

	_qbNodeNegged(n) {
		if (this._qbKind(n) === "cond")
			return ["bi-kw", "bi-coll", "bi-tag", "bi-user"].indexOf(n.type) >= 0 ? n.op === "!=" : !!n.neg;
		return !!n.neg;
	}

	// One node → its query text. A raw node is carried VERBATIM, which is what
	// lets a fragment this builder cannot express survive a round trip untouched.
	// A negated group or raw node compiles wrapped (`NOT (…)`); a condition
	// carries its own negation inside _qbRowQuery.
	_qbNodeQuery(n) {
		const k = this._qbKind(n);
		let q;
		if (k === "raw") q = (n.query || "").trim();
		// A saved search compiles to its SNAPSHOT text, byte for byte, until one of
		// its own rows is edited: the field text must stay an exact match for the
		// chip to come back. Edited, it is whatever its rows now say.
		else if (k === "saved") q = this._qbSavedEdited(n) ? this._qbGroupQuery(n) : (n.query || "").trim();
		else if (k === "group") {
			q = this._qbGroupQuery(n);
			// An explicit GROUP always keeps its parentheses, even around a
			// SINGLE row. A live query stores only the TEXT, so a group whose
			// brackets are dropped as "redundant" simply ceases to exist on
			// reopen: his one-row group came back as a loose row between two
			// groups, headerless and joined to whatever followed ("en grupp som
			// skapas utan en conditions-rad ovanför sig … hade en AND innan").
			// The engine reads (x) and x identically, so nothing changes meaning
			// — and the reader below now keeps such brackets as a group, which
			// also makes a hand-written "(x) AND y" round-trip byte-exact for
			// the first time.
			if (q && !this._isWrapped(q)) q = "(" + q + ")";
		}
		else return this._qbRowQuery(n);
		if (n.neg && q) return "NOT " + (this._isWrapped(q) ? q : "(" + q + ")");
		return q;
	}

	// One level → one query string. Every row from the second carries ITS OWN
	// joiner (`j`, AND or OR — his call: one box mixes freely, groups are never
	// created for you). The text is built the way the engine will read it: the
	// rows chunk into AND-runs split at each OR, AND binds tighter than OR, and
	// brackets come from the precedence helper only where the meaning would
	// otherwise change. `group.join` survives solely as the legacy fallback for
	// rows that predate `j`.
	_qbGroupQuery(g) {
		const legacyJoin = (g.join || "AND").toUpperCase();
		// NOT as a LEVEL joiner: legacy saved models only (normalize rewrites it
		// for everything the UI touches). It EXCLUDES: head AND NOT part….
		if (legacyJoin === "NOT") {
			const parts = (g.rows || []).map((n) => this._qbNodeQuery(n)).filter(Boolean);
			if (!parts.length) return "";
			if (parts.length === 1) return parts[0];
			const head = this._wrapSide(parts[0], false, this._needsWrapLeft(parts[0], "AND"));
			// _wrapSide cannot see an implicit AND (adjacency has no operator word
			// for _topOps to find), so a raw part like `@todo @nextweek` gets its
			// brackets here — NOT takes only the next term, and without them it
			// would negate half the part.
			return head + parts.slice(1)
				.map((p) => {
					const w = this._wrapSide(p, false, this._needsWrap(p, "NOT"));
					if (w === p && !this._isWrapped(p) && this._qbHasAdjacency(p)) return " AND NOT (" + p + ")";
					return " AND NOT " + w;
				})
				.join("");
		}
		const items = [];
		for (const n of (g.rows || [])) {
			const q = this._qbNodeQuery(n);
			if (!q) continue;    // an unfinished row contributes nothing, nor does its joiner
			items.push({ q, j: items.length ? String(n.j || legacyJoin).toUpperCase() : "", saved: this._qbKind(n) === "saved" });
		}
		if (!items.length) return "";
		if (items.length === 1) return items[0].q;
		// A saved search next to anything else is bracketed whenever it holds more
		// than one term, even where precedence would not need it: the chip finds a
		// saved search by splitting the field at its top-level AND/OR, so an
		// unbracketed `A AND B` beside `AND C` could never be recognised again.
		for (const it of items) {
			if (it.saved && !this._isWrapped(it.q) && !/^NOT \(/.test(it.q)
				&& (this._hasBoolOp(it.q) || this._qbHasAdjacency(it.q))) it.q = "(" + it.q + ")";
		}
		const chunks = [[items[0].q]];
		for (const it of items.slice(1)) {
			if (it.j === "OR") chunks.push([it.q]);
			else chunks[chunks.length - 1].push(it.q);
		}
		return chunks
			.map((c) => (c.length === 1
				? c[0]
				: c.map((p) => this._wrapSide(p, false, this._needsWrap(p, "AND"))).join(" AND ")))
			.join(" OR ");
	}

	_qbCompile(model) { return this._qbGroupQuery(model); }

	// ── Saved searches as nodes ─────────────────────────────────────────────
	// {kind:"saved", sid, title, query, rows, base, open}: a saved search placed
	// in the builder. `query` is the snapshot taken when it was placed, `rows` its
	// structure for the fold-out, and `base` what those rows compiled to then,
	// so "edited" is a plain comparison and survives any parse quirk. A saved
	// node without `sid` is the empty "Pick a saved search" row.
	_qbSavedEdited(n) {
		return !!(n && n.sid) && this._qbGroupQuery(n) !== n.base;
	}

	_qbSavedNode(item, open) {
		let rows = [];
		if (item.conditions) rows = this._qbNormalize(JSON.parse(JSON.stringify(item.conditions))).rows;
		else { const m = this._qbParse(item.query); rows = m ? m.rows : []; }
		const n = { kind: "saved", sid: item.id, title: item.title || "", query: item.query || "", rows, open: !!open, neg: false, j: "AND" };
		n.base = this._qbGroupQuery(n);
		return n;
	}

	// Groups and saved searches both hold rows; everything that walks the tree
	// by path has to see inside either.
	_qbHasRows(n) { const k = this._qbKind(n); return k === "group" || k === "saved"; }

	// What closes a visual box: a group, or a saved search that is folded out.
	_qbBreaksBox(n) { const k = this._qbKind(n); return k === "group" || (k === "saved" && !!n.open); }

	// True when a fragment holds MORE than one operand at its top level — an
	// implicit AND (`@todo @nextweek`) counts, which is exactly what _topOps,
	// reading operator WORDS, cannot see.
	_qbHasAdjacency(text) {
		const seq = this._qbTokens((text || "").trim());
		return !!(seq && seq.length > 1);
	}

	// Nodes are addressed by PATH ("2.0.1" = root row 2 → its row 0 → its row 1).
	// One address scheme for delete, for the DOM's data-row, and for restoring
	// focus after a rebuild, at any depth.
	_qbAt(path) {
		const idx = String(path == null ? "" : path).split(".").filter((s) => s !== "");
		let parent = this._qb.model, node = this._qb.model;
		for (const s of idx) {
			parent = node;
			node = (node.rows || [])[parseInt(s, 10)];
			if (!node) return null;
		}
		return { parent, node, index: idx.length ? parseInt(idx[idx.length - 1], 10) : -1 };
	}

	_qbNewRow() {
		const src = this._qb.defaultSrc;
		const f = this._qbFieldsFor(src)[0];
		return {
			kind: "cond", src, j: "AND",
			field: f ? f.label : "",
			type: f ? f.type : "plaintext",
			op: f ? this._qbOpsFor(f.type)[0].v : "=",
			value: "",
		};
	}

	// A new condition joins the level's OWN box, i.e. before any group it contains.
	// Appending instead put it after the group, which renders as a second box with no
	// buttons — it reads like a group that lost its controls. Order within a level is
	// cosmetic (one joiner, and both AND and OR are associative), so this is free.
	// Note it only ever moves a row the user is creating; a parsed model is never
	// reordered, which is what keeps the round trip byte-identical.
	_qbAddRow(group) {
		const g = group || this._qb.model;
		const at = g.rows.findIndex((n) => this._qbKind(n) === "group");
		if (at < 0) g.rows.push(this._qbNewRow());
		else g.rows.splice(at, 0, this._qbNewRow());
	}

	// "Add condition group" creates a PARALLEL group — a sibling spliced in
	// right after the group whose box you pressed it in (his call: adding
	// INTO the box nested one level deeper every time, "indentera i all
	// evighet"; deliberate nesting is the indent arrow's job). The root's own box appends
	// a root-level group, as ever.
	_qbAddGroup(group) {
		const g = group || this._qb.model;
		const fresh = { kind: "group", join: "AND", j: "AND", rows: [this._qbNewRow()] };
		if (!this._qb || g === this._qb.model) {
			g.rows.push(fresh);
			return;
		}
		const path = this._qbFindPath(g);
		const at = path ? this._qbAt(path) : null;
		if (at && at.index >= 0) at.parent.rows.splice(at.index + 1, 0, fresh);
		else g.rows.push(fresh);
	}

	// ── Row drag — within a box, to another box, or OUT into a new group ────
	// (his ask: "flytta rader inom en grupp och till en annan grupp … drar man
	// den utanför sin box så visas en ny condition group som man kan släppa
	// de på"). Strips move as chips through their own menus; the grip sits on
	// condition and raw rows.
	_qbGripEl(path, rowEl) {
		const g = document.createElement("span");
		g.className = "qb-grip ti ti-grip-vertical";
		g.setAttribute("title", "Drag to move — drop below the boxes for a new group");
		g.addEventListener("mousedown", (e) => this._qbStartRowDrag(e, path, rowEl));
		// The panel's own click handler clears the selection ("click anywhere else
		// to deselect"), and a real mouse click fires mousedown, mouseup AND click
		// — so the row this grip just selected on mouseup was deselected again a
		// moment later, and nothing appeared to happen (his report). The grip
		// swallows its own click, exactly as the group headers already do.
		g.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); });
		return g;
	}

	_qbStartRowDrag(e, path, rowEl) {
		if (e.button !== 0 || !this._qbEl || !this._qb) return;
		e.preventDefault(); e.stopPropagation();
		this._qbCloseMenu(); this._qbCloseCal();
		const body = this._qbEl.querySelector(".qb-body");
		if (!body) return;
		const line = document.createElement("div");
		line.className = "qb-dropline";
		// A "new group" zone in EVERY gap between the query's top-level parts,
		// not one at the very bottom: dragging a row down out of its group has
		// to offer the slot right below THAT group, or moving something one step
		// down is impossible ("där tjänar det inte till om jag ska flytta ner
		// något ett steg" — his report). Each zone remembers the root index it
		// would insert at; they exist only while a drag is running.
		const zones = [];
		const buildZones = () => {
			const kids = Array.prototype.slice.call(body.children);
			const rootIndexOf = (el2) => {
				const r = el2.matches("[data-row]") ? el2 : el2.querySelector("[data-row]");
				if (!r) return null;
				const seg = String(r.getAttribute("data-row")).split(".")[0];
				const n = parseInt(seg, 10);
				return isNaN(n) ? null : n;
			};
			let prev = null;
			const place = (at, before) => {
				const z = document.createElement("div");
				z.className = "qb-dropzone";
				z.textContent = "New condition group";
				z._qbAt = at;
				if (before) body.insertBefore(z, before); else body.appendChild(z);
				zones.push(z);
			};
			for (const kid of kids) {
				const idx = rootIndexOf(kid);
				if (idx == null) continue;
				if (prev != null && idx !== prev) place(idx, kid);
				prev = idx;
			}
			place(prev == null ? 0 : prev + 1, null);
		};
		let started = false, target = null;
		const startY = e.clientY;
		// A strip row spans one model index per CHIP; everything else spans one.
		const spanOf = (el2) => {
			if (el2.hasAttribute("data-span")) return Math.max(1, parseInt(el2.getAttribute("data-span"), 10) || 1);
			return el2.classList.contains("qb-striprow")
				? Math.max(1, el2.querySelectorAll(".qb-kwchip").length) : 1;
		};
		const onMove = (ev) => {
			if (!started && Math.abs(ev.clientY - startY) < 4) return;
			if (!started) {
				started = true;
				rowEl.classList.add("qb-dragrow");
				buildZones();
				body.appendChild(line);
			}
			target = null;
			line.style.display = "none";
			zones.forEach((z) => z.classList.remove("qb-dropzone-hot"));
			const x = ev.clientX, y = ev.clientY;
			let hit = null;
			for (const z of zones) {
				const zr = z.getBoundingClientRect();
				if (y >= zr.top - 6 && y <= zr.bottom + 6 && x >= zr.left && x <= zr.right) { hit = z; break; }
			}
			if (hit) {
				hit.classList.add("qb-dropzone-hot");
				target = { newGroup: true, at: hit._qbAt };
				return;
			}
			for (const box of this._qbEl.querySelectorAll(".qb-block")) {
				const br = box.getBoundingClientRect();
				if (x < br.left || x > br.right || y < br.top - 4 || y > br.bottom + 4) continue;
				const rows = Array.prototype.slice.call(box.querySelectorAll(":scope > .qb-row[data-row]"));
				if (!rows.length) break;
				const groupPath = String(rows[0].getAttribute("data-row")).split(".").slice(0, -1).join(".");
				let index = null, lineY = null;
				for (const r of rows) {
					const rr = r.getBoundingClientRect();
					if (y < rr.top + rr.height / 2) {
						index = parseInt(String(r.getAttribute("data-row")).split(".").pop(), 10);
						lineY = rr.top;
						break;
					}
				}
				if (index == null) {
					const last = rows[rows.length - 1];
					index = parseInt(String(last.getAttribute("data-row")).split(".").pop(), 10) + spanOf(last);
					lineY = last.getBoundingClientRect().bottom;
				}
				const bodyR = body.getBoundingClientRect();
				line.style.display = "block";
				line.style.top = (lineY - bodyR.top + body.scrollTop - 1) + "px";
				line.style.left = "13px";
				line.style.right = "13px";
				target = { path: groupPath, index };
				break;
			}
		};
		const onUp = () => {
			document.removeEventListener("mousemove", onMove, true);
			rowEl.classList.remove("qb-dragrow");
			line.remove(); zones.forEach((z) => z.remove());
			if (started && target) { this._qbMoveRow(path, target); return; }
			// A grip PRESS that never moved is a click: it selects the row, which
			// is what ⌘C then copies (his ask). The drag already has its 4px
			// threshold, so the two gestures cannot be confused.
			if (!started) {
				const at = this._qbAt(path);
				if (at && at.node) this._qbSelect(at.node);
			}
		};
		document.addEventListener("mousemove", onMove, true);
		document.addEventListener("mouseup", onUp, { capture: true, once: true });
	}

	_qbMoveRow(srcPath, target) {
		const src = this._qbAt(srcPath);
		if (!src || src.index < 0) return;
		const row = src.parent.rows[src.index];
		if (target.newGroup) {
			const rootLevel = src.parent === this._qb.model;
			src.parent.rows.splice(src.index, 1);
			// target.at is a slot measured BEFORE the row left, so removing a
			// root-level row above it shifts everything down by one. With no
			// target (the suite's plain newGroup drop) the new group goes last,
			// and the length is already post-removal — nothing to adjust there.
			let at = this._qb.model.rows.length;
			if (target.at != null) {
				at = target.at;
				if (rootLevel && src.index < at) at--;
			}
			at = Math.max(0, Math.min(at, this._qb.model.rows.length));
			this._qb.model.rows.splice(at, 0, { kind: "group", join: "AND", j: "AND", rows: [row] });
		} else {
			const destGroup = target.path === "" ? this._qb.model : (this._qbAt(target.path) || {}).node;
			if (!destGroup || !this._qbHasRows(destGroup)) return;
			if (this._qbContains(row, destGroup)) return;   // a group cannot land inside itself
			let destIndex = target.index;
			src.parent.rows.splice(src.index, 1);
			if (destGroup === src.parent && destIndex > src.index) destIndex--;
			destIndex = Math.max(0, Math.min(destIndex, destGroup.rows.length));
			destGroup.rows.splice(destIndex, 0, row);
		}
		row.j = String(row.j || "AND").toUpperCase();
		this._qbPrune();
		if (!this._qb.model.rows.length) this._qbAddRow();
		if (this._qbEl) { this._qbBuild(); this._qbApply(); }
	}

	// The first node of every RUN (visual box) in the model, any depth — the
	// fold-all button's working set, and the keys of this._qb.folds.
	_qbAllRuns(g, out) {
		out = out || [];
		let inRun = false;
		for (const r of ((g || this._qb.model).rows || [])) {
			// A folded-out saved search folds with its own button; its rows' runs count.
			if (this._qbBreaksBox(r)) { inRun = false; this._qbAllRuns(r, out); }
			else { if (!inRun) out.push(r); inRun = true; }
		}
		return out;
	}

	// A folded box: the same frame, one line — the run's lead (still a live
	// joiner), its compiled text, a chevron. Click anywhere to expand.
	_qbFoldedRunEl(group, i, k, path) {
		const run = group.rows.slice(i, k);
		const boxEl = document.createElement("div");
		boxEl.className = "qb-block qb-folded";
		const rowEl = document.createElement("div");
		rowEl.className = "qb-row qb-foldedrow";
		rowEl.setAttribute("data-row", this._qbPath(path, i));
		rowEl.setAttribute("data-span", String(k - i));
		rowEl.appendChild(this._qbLeadEl(group, i, false, run[0], this._qbPath(path, i)));
		const q = this._qbGroupQuery({ join: "AND", rows: run }) || "Empty group";
		const sum = document.createElement("div");
		sum.className = "qb-foldsum";
		sum.textContent = q;
		sum.setAttribute("title", q);
		rowEl.appendChild(sum);
		const chev = document.createElement("span");
		chev.className = "qb-folded-chev ti ti-chevron-right";
		rowEl.appendChild(chev);
		boxEl.addEventListener("click", () => {
			if (this._qb.folds) this._qb.folds.delete(run[0]);
			this._qbBuild();
		});
		boxEl.appendChild(rowEl);
		return boxEl;
	}

	// Wrap everything from `from` DOWN into one group — the one-click fix for
	// the precedence trap (his Page query: `Page AND gA OR gI OR …` binds Page
	// to gA alone; wrapping the rest gives `Page AND (gA OR gI OR …)`). The new
	// group takes over the first wrapped row's joiner; the inner joins are
	// untouched.
	_qbWrapBelow(group, from) {
		const g = group || this._qb.model;
		const rows = g.rows || [];
		if (from <= 0 || from >= rows.length) return;
		const rest = rows.slice(from);
		g.rows = rows.slice(0, from).concat([{
			kind: "group", join: "AND",
			j: String(rest[0].j || "AND").toUpperCase(),
			rows: rest,
		}]);
	}

	// True when `node` is `target` or contains it — the guard that keeps a
	// dragged GROUP from being dropped into itself.
	_qbContains(node, target) {
		if (node === target) return true;
		if (!this._qbHasRows(node)) return false;
		return (node.rows || []).some((r) => this._qbContains(r, target));
	}

	// ── Group selection + indent/outdent arrows ─────────────────────────────
	// Click a group's header row or a box's empty background to SELECT the
	// group (accent ring — a visual "this is one unit"). Indent/outdent moved
	// off Tab and onto arrows in the box's right gutter (Tab-hijack broke
	// tabbing between columns — his report 2026-08-14). Selection is a NODE
	// reference (identity survives rebuilds and moves), cleared by Escape or
	// a click anywhere else.
	_qbFindPath(node, g, prefix) {
		g = g || this._qb.model;
		prefix = prefix || "";
		const rows = g.rows || [];
		for (let i = 0; i < rows.length; i++) {
			const p = prefix === "" ? String(i) : prefix + "." + i;
			if (rows[i] === node) return p;
			if (this._qbHasRows(rows[i])) {
				const hit = this._qbFindPath(node, rows[i], p);
				if (hit) return hit;
			}
		}
		return "";
	}

	_qbSelect(node) {
		if (!this._qb) return;
		this._qb.sel = (this._qb.sel === node) ? null : node;
		this._qbPaintSel();
	}

	_qbPaintSel() {
		if (!this._qbEl) return;
		this._qbEl.querySelectorAll(".qb-selected").forEach((el) => el.classList.remove("qb-selected"));
		const node = this._qb && this._qb.sel;
		if (!node) return;
		const path = this._qbFindPath(node);
		if (!path) { this._qb.sel = null; return; }
		// The ring sits on the GROUP's boxes only — the joiner row above it is
		// implicit (his call: "AND/OR/NOT som är ovanför … är implicit").
		if (this._qbKind(node) !== "group") {
			// A single row rings itself; only groups ring their boxes.
			const el = this._qbEl.querySelector('[data-row="' + path + '"]');
			if (el) el.classList.add("qb-selected");
			return;
		}
		this._qbEl.querySelectorAll(".qb-block").forEach((b) => {
			const r = b.querySelector("[data-row]");
			if (r && String(r.getAttribute("data-row")).indexOf(path + ".") === 0) b.classList.add("qb-selected");
		});
	}

	// Copy the selected node into the builder's own clipboard — a DEEP copy, so
	// editing the original afterwards cannot reach the copy. The compiled text
	// also goes to the system clipboard when the browser allows it, which costs
	// nothing and lets the row be pasted as text somewhere else.
	_qbCopySel() {
		const node = this._qb && this._qb.sel;
		if (!node) return false;
		this._qbClip = JSON.parse(JSON.stringify(node));
		try {
			const t = this._qbNodeQuery(node);
			if (t && navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t);
		} catch (e) { /* the internal buffer is the one that matters */ }
		this._qbFlash(this._qbKind(node) === "group" ? "Group copied" : "Condition copied");
		return true;
	}

	// Paste it: INTO the selected group (at the end), or right AFTER the selected
	// row. The pasted node becomes the selection, so a second ⌘V lands under the
	// first — pasting three copies is three presses.
	_qbPasteSel() {
		if (!this._qb || !this._qbClip) return false;
		const sel = this._qb.sel;
		if (!sel) return false;
		const copy = JSON.parse(JSON.stringify(this._qbClip));
		let parent = null, index = 0;
		if (this._qbKind(sel) === "group") {
			parent = sel;
			// A pasted CONDITION joins the group's own BOX — the same placement
			// "Add condition" uses (`_qbAddRow`: before the first nested group).
			// Appending at the very end put it AFTER the sub-groups, where it
			// renders as a separate box below them: "den pastar inte raden i
			// gruppen man markerat, utan utanför i en separat egen grupp" (his
			// report). A pasted GROUP still goes last, where groups belong.
			const rows = sel.rows || (sel.rows = []);
			if (this._qbKind(copy) === "group") index = rows.length;
			else {
				const firstGroup = rows.findIndex((n) => this._qbKind(n) === "group");
				index = firstGroup < 0 ? rows.length : firstGroup;
			}
		} else {
			const path = this._qbFindPath(sel);
			const at = path ? this._qbAt(path) : null;
			if (!at || at.index < 0) return false;
			parent = at.parent;
			index = at.index + 1;
		}
		if (!parent) return false;
		if (!parent.rows) parent.rows = [];
		parent.rows.splice(index, 0, copy);
		copy.j = String(copy.j || "AND").toUpperCase();
		this._qb.sel = copy;
		this._qbFlash("Pasted");
		if (this._qbEl) { this._qbBuild(); this._qbApply(); }
		return true;
	}

	// A word in the footer, where the row count lives — the only feedback a
	// keyboard action gets, and without it a copy is completely silent.
	_qbFlash(text) {
		if (!this._qbEl) return;
		const ln = this._qbEl.querySelector(".qb-hitsline");
		if (!ln) return;
		ln.textContent = text;
		clearTimeout(this._qbFlashT);
		this._qbFlashT = setTimeout(() => this._qbPaintFoot(), 1200);
	}

	// dir +1 = indent (into the previous sibling group), -1 = outdent.
	_qbIndentGroup(node, dir) {
		if (!node) return false;
		const path = this._qbFindPath(node);
		if (!path) return false;
		const at = this._qbAt(path);
		if (!at || at.index < 0) return false;
		if (dir > 0) {
			// Indent = TUCK into the sibling group above, nothing else. The
			// wrap-in-place branch that lived here (Tab-era "always acts") is
			// gone — repeated indentation just built ever-deeper one-child
			// stacks (his rule: depth comes from children having children).
			const prev = at.parent.rows[at.index - 1];
			if (!prev || this._qbKind(prev) !== "group") return false;
			at.parent.rows.splice(at.index, 1);
			prev.rows.push(node);
		} else {
			const seg = path.split(".");
			if (seg.length < 2) return true;                            // already at the root level
			const parentPath = seg.slice(0, -1).join(".");
			const pAt = this._qbAt(parentPath);
			if (!pAt) return true;
			const wasFirst = at.index === 0;
			const owner = at.parent;
			owner.rows.splice(at.index, 1);
			// Reading order survives the move: a FIRST child lands in front of
			// its old parent (it was above its siblings and stays above them),
			// any other child lands right after it.
			pAt.parent.rows.splice(pAt.index + (wasFirst ? 0 : 1), 0, node);
			// A first child also TAKES OVER its parent's joiner, because it now
			// holds the slot the parent held in the sequence. That is what makes
			// undoing a one-group stack text-preserving: the wrapper is pruned
			// and its OR (or AND) leaves with the child instead of silently
			// becoming the default.
			if (wasFirst && owner.j) node.j = owner.j;
		}
		node.j = String(node.j || "AND").toUpperCase();
		this._qbPrune();
		if (!this._qb.model.rows.length) this._qbAddRow();
		if (this._qbEl) { this._qbBuild(); this._qbApply(); }
		return true;
	}

	_qbDelete(path) {
		const at = this._qbAt(path);
		if (!at || at.index < 0) return;
		at.parent.rows.splice(at.index, 1);
		this._qbPrune();
		if (!this._qb.model.rows.length) this._qbAddRow();
		this._qbBuild(); this._qbApply();
	}

	// Drop groups a delete left empty — an empty group compiles to nothing, so
	// leaving it on screen is a row that claims to filter and does not.
	// (The single-child hoist that lived here is gone — see _qbNormalize.)
	_qbPrune(g) {
		const grp = g || this._qb.model;
		grp.rows = (grp.rows || []).filter((n) => {
			// A saved search whose rows were all deleted goes the same way; the
			// empty "Pick a saved search" row (no sid) is waiting, not empty.
			if (this._qbKind(n) === "saved") { this._qbPrune(n); return !n.sid || n.rows.length > 0; }
			if (this._qbKind(n) !== "group") return true;
			this._qbPrune(n);
			return (n.rows || []).length > 0;
		});
	}

	// The picker needs label + fields only. Every builder open reads them afresh
	// (`fresh`), so a property added since the last open is there to pick.
	async _qbLoadCollections(fresh) {
		if (this._qbCols && !fresh) return this._qbCols;
		const out = [];
		try {
			let cols = this.data.getAllCollections();
			if (cols && typeof cols.then === "function") cols = await cols;
			for (const c of cols || []) {
				let conf = null;
				try { conf = c.getConfiguration(); } catch (e) { conf = null; }
				const fields = ((conf && conf.fields) || []).filter((f) => f && f.active !== false && f.label);
				let guid = "";
				// getGuid() FIRST, and in its own try: `_getRow()` throws on a collection
				// handle, and with both in one try block that exception skipped the
				// fallback and left every collection with an EMPTY guid. Silent, because
				// nothing reads the guid until you match against one — which is why the
				// dynamic-source scoping matched nothing and `filter_colguid` never
				// resolved either, quietly falling back to the record scan.
				try { guid = (c.getGuid && c.getGuid()) || ""; } catch (e) {}
				if (!guid) { try { guid = (c._getRow && c._getRow().guid) || ""; } catch (e) {} }
				// A collection's icon lives in its config, not getIcon(); only ti- names
				// are real glyphs (Thymer also stores CSS "fill" icons like blinking-dot).
				const icon = conf && typeof conf.icon === "string" && conf.icon.indexOf("ti-") === 0 ? conf.icon : "";
				out.push({ name: (c.getName && c.getName()) || (conf && conf.name) || "", fields, guid, icon, api: c });
			}
		} catch (e) { /* leave empty; the builder shows why below */ }
		const cols = out.filter((c) => c.name).sort((a, b) => a.name.localeCompare(b.name));
		// NEVER cache an empty result. `[]` is truthy, so the guard at the top
		// returned it forever after, and a builder opened in that window parsed
		// every condition into a verbatim RAW chip (no field types to resolve
		// against) — his report, 2026-08-15, right after a live reload where the
		// data layer had not come up yet. Leaving the cache null makes the next
		// open retry. Nothing is lost when it does happen: a raw chip keeps the
		// query text byte-exact, which is the reader's standing contract.
		if (cols.length) this._qbCols = cols;
		return this._qbCols || cols;
	}

	_qbFieldsFor(src) {
		if (src === Plugin.ANY_ITEM) return Plugin.QB_BUILTINS;
		const c = (this._qbCols || []).find((x) => x.name === src);
		return c ? c.fields : [];
	}

	// Thymer's 15-colour enum palette, index → CSS var name (see the choice `color`
	// field). Record links have no colour of their own and fall back to zinc.
	static ENUM_COLORS = ["red", "orange", "green", "cyan", "blue", "purple", "pink", "fuchsia", "rose", "stone", "teal", "sky", "indigo", "zinc", "yellow"];
	_qbEnumVar(idx) {
		const n = Plugin.ENUM_COLORS[parseInt(idx, 10)] || "zinc";
		return "var(--enum-" + n + "-fg)";
	}

	// A control that opens a menu. Built rather than a native <select> so the label
	// and the chevron can carry the same padding — the shells stay symmetric.
	_qbTrigger(cls, text, placeholder, onOpen) {
		const b = document.createElement("button");
		b.type = "button";
		b.className = "qb-sel " + cls;
		// Enter/Space open the menu, so a tabbed-to control behaves like a select.
		b.addEventListener("keydown", (e) => {
			if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onOpen(b); }
		});
		const l = document.createElement("span");
		l.className = "qb-sel-label" + (text ? "" : " qb-placeholder");
		l.textContent = text || placeholder || "";
		const c = document.createElement("span");
		c.className = "qb-chev ti ti-chevron-down";
		b.appendChild(l); b.appendChild(c);
		b.addEventListener("click", (e) => {
			e.preventDefault(); e.stopPropagation();
			if (b.classList.contains("qb-open")) { this._qbCloseMenu(); return; }
			onOpen(b);
		});
		return b;
	}

	// A control's address: which row it is on and which column it is. Used to put
	// focus back after a rebuild, which replaces every node in the panel.
	static QB_CONTROLS = ["qb-src", "qb-field", "qb-op", "qb-val-sel", "qb-val-date", "qb-val", "qb-scope-sel", "qb-join", "qb-saved"];
	_qbControlRef(el) {
		if (!el) return null;
		const cls = Plugin.QB_CONTROLS.find((c) => el.classList.contains(c));
		if (!cls) return null;
		const rowEl = el.closest("[data-row]");
		return { row: rowEl ? rowEl.getAttribute("data-row") : null, cls };
	}

	_qbCloseMenu() {
		this._qbCloseCal();
		if (this._qbMenuKey) { document.removeEventListener("keydown", this._qbMenuKey, true); this._qbMenuKey = null; }
		if (this._qbMenuOutside) { document.removeEventListener("mousedown", this._qbMenuOutside, true); this._qbMenuOutside = null; }
		if (this._qbMenuEl) { this._qbMenuEl.remove(); this._qbMenuEl = null; }
		document.querySelectorAll(".qb-sel.qb-open").forEach((b) => b.classList.remove("qb-open"));
	}

	// items: [{v, label, icon, color}] — icon is a ti- class, color an enum index.
	// Aligned to the control it belongs to, and searchable once the list is long.
	_qbMenu(anchor, items, current, onPick, cfg) {
		this._qbCloseMenu();
		cfg = cfg || {};
		anchor.classList.add("qb-open");
		// Picking with the MOUSE leaves focus on <body>, so the rebuild that follows
		// has nothing to restore and Tab starts over from the top of the panel.
		// Remember the control the menu belongs to and hand focus back to it, so Tab
		// carries on to the next column from where you just were.
		this._qbFocusAfter = this._qbControlRef(anchor);
		// Thymer's own picker markup, class for class — the app styles it for us.
		const menu = document.createElement("div");
		menu.className = "cmdpal--inline active qb-menu" + (cfg.dark ? " qb-menu-dark" : "");
		menu.style.position = "fixed";
		menu.addEventListener("mousedown", (e) => e.stopPropagation());
		this._qbMenuEl = menu;

		let search = null;
		if (cfg.search) {
			const ic = document.createElement("div");
			ic.className = "cmdpal--inline-input-container";
			const row = document.createElement("div");
			row.className = "cmdpal--inline-input-row";
			search = document.createElement("input");
			search.className = "cmdpal--inline-input";
			search.type = "text";
			search.spellcheck = false;
			search.placeholder = cfg.searchPlaceholder || "Search option ...";
			search.addEventListener("keydown", (e) => {
				// arrows + Enter belong to the list; the rest is typing
				if (["ArrowDown", "ArrowUp", "Enter", "Escape"].indexOf(e.key) < 0) e.stopPropagation();
			});
			search.addEventListener("input", () => paint());
			row.appendChild(search);
			ic.appendChild(row);
			menu.appendChild(ic);
		}
		const scroller = document.createElement("div");
		scroller.className = "autocomplete clickable";
		scroller.style.position = "relative";
		scroller.style.overflow = "hidden";
		const vnode = document.createElement("div");
		vnode.className = "vscroll-node";
		vnode.style.height = "100%";
		const list = document.createElement("div");
		list.className = "vcontent";
		vnode.appendChild(list);
		scroller.appendChild(vnode);
		menu.appendChild(scroller);

		let cells = [], active = -1;
		// Native marks the row under the cursor with `autocomplete--option-selected`
		// — the green fill and light text. Walking the list moves that mark, so the
		// row you are on always reads in the contrast colour, never grey.
		const highlight = (i, scroll) => {
			if (!cells.length) return;
			active = (i + cells.length) % cells.length;
			cells.forEach((c, k) => c.classList.toggle("autocomplete--option-selected", k === active));
			if (scroll !== false && cells[active].scrollIntoView) cells[active].scrollIntoView({ block: "nearest" });
		};
		const paint = () => {
			const q = (search && search.value || "").trim();
			// "+" is an AND across parts, and ranking is prefix-first — the same
			// contract as the Move To / Quick Capture picker.
			const parts = q ? q.toLowerCase().split("+").map((s) => s.trim()).filter(Boolean) : [];
			const scored = [];
			for (const it of items) {
				// Match against the label plus any alternate text (a keyword's @form).
				const lab = ((it.label || "") + (it.alt ? " " + it.alt : "")).toLowerCase();
				if (!parts.length) { scored.push({ it, s: 0 }); continue; }
				let total = 0, ok = true;
				for (const p of parts) {
					let s = 0;
					if (lab === p) s = 100;
					else if (lab.indexOf(p) === 0) s = 45;
					else if (new RegExp("\\b" + p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).test(lab)) s = 25;
					else if (lab.indexOf(p) >= 0) s = 8;
					if (!s) { ok = false; break; }
					total += s;
				}
				if (ok) scored.push({ it, s: total });
			}
			if (parts.length) scored.sort((a, b) => b.s - a.s || a.it.label.length - b.it.label.length || a.it.label.localeCompare(b.it.label));
			list.innerHTML = "";
			cells = [];
			if (!scored.length) {
				const e = document.createElement("div");
				e.className = "qb-menu-empty";
				e.textContent = "No matches";
				list.appendChild(e);
				return;
			}
			scored.slice(0, 200).forEach(({ it }) => {
				const row = document.createElement("div");
				row.className = "autocomplete--option";
				row.setAttribute("data-v", it.v == null ? "" : String(it.v));
				if (cfg.dots !== false || it.icon || it.glyph) {
					const ic = document.createElement("span");
					ic.className = "autocomplete--option-icon";
					if (it.glyph) {
						ic.textContent = it.glyph;
					} else if (it.icon) {
						const g = document.createElement("span");
						g.className = "ti " + it.icon;
						ic.appendChild(g);
					} else {
						// No glyph on this option — a dot in its enum colour, like native.
						const d = document.createElement("span");
						d.className = "qb-mi-dot";
						d.style.color = this._qbEnumVar(it.color);
						ic.appendChild(d);
					}
					row.appendChild(ic);
				}
				const lb = document.createElement("span");
				lb.className = "autocomplete--option-label";
				lb.textContent = it.label;
				row.appendChild(lb);
				// Mouse only, as in the library: an emulated mouseenter on a phone must not move the highlight.
				row.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") highlight(cells.indexOf(row), false); });
				row.addEventListener("click", (e) => {
					e.stopPropagation();
					this._qbCloseMenu();
					onPick(it.v);
				});
				list.appendChild(row);
				cells.push(row);
			});
			// Start on whatever is already chosen, else the first row.
			const at = cells.findIndex((c) => c.getAttribute("data-v") === String(current == null ? "" : current));
			highlight(at >= 0 ? at : 0, false);
		};
		paint();

		// Up/Down walk the list, Enter takes the highlighted row — the menu is
		// keyboard-drivable whether or not it has a search box.
		const onKey = (e) => {
			if (!this._qbMenuEl) return;
			if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); highlight(active + 1); }
			else if (e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); highlight(active - 1); }
			else if (e.key === "Enter") {
				if (active < 0 || !cells[active]) return;
				e.preventDefault(); e.stopPropagation();
				cells[active].dispatchEvent(new MouseEvent("click", { bubbles: true }));
			} else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this._qbCloseMenu(); }
			else if (!search && e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
				// TYPE-AHEAD for the menus that have no search box — the joiner
				// (AND/OR/NOT), Show/NOT, the operators. They are three or four
				// items wide, so a search row would dwarf them, but a keyboard
				// user still has to be able to say which one ("man ska kunna
				// skriva AND/OR/NOT", his ask 2026-08-15). Same behaviour as a
				// native select: the letters pick the first label that starts
				// with what you typed, Enter takes it.
				const now = Date.now();
				if (now - (this._qbTypeAt || 0) > 800) this._qbType = "";
				this._qbTypeAt = now;
				this._qbType = (this._qbType || "") + e.key.toLowerCase();
				const hit = cells.findIndex((c) =>
					(c.textContent || "").trim().toLowerCase().indexOf(this._qbType) === 0);
				// One repeated letter walks the matches, the way a select does.
				if (hit < 0 && this._qbType.length > 1
					&& this._qbType.split("").every((ch) => ch === this._qbType[0])) {
					this._qbType = e.key.toLowerCase();
					const from = active + 1;
					const n = cells.length;
					for (let k = 0; k < n; k++) {
						const idx = (from + k) % n;
						if ((cells[idx].textContent || "").trim().toLowerCase().indexOf(this._qbType) === 0) {
							e.preventDefault(); e.stopPropagation(); highlight(idx);
							return;
						}
					}
					return;
				}
				if (hit >= 0) { e.preventDefault(); e.stopPropagation(); highlight(hit); }
			}
		};
		this._qbMenuKey = onKey;
		this._qbType = ""; this._qbTypeAt = 0;
		document.addEventListener("keydown", onKey, true);

		document.body.appendChild(menu);
		const r = anchor.getBoundingClientRect();
		const M = 8;
		// Native picker width, never narrower than the control it belongs to.
		menu.style.width = Math.max(r.width, cfg.width != null ? cfg.width : 320) + "px";
		menu.style.maxWidth = "calc(100vw - 20px)";
		// The list scrolls at the native 350px, or shrinks to fit a short one. Measured
		// from the rendered content, not counted: native rows are 26px and the estimate
		// here was 30, which left a visible strip of dead space under a short list.
		const wanted = list.scrollHeight || (list.children.length * 26);
		scroller.style.height = Math.min(350, Math.max(30, wanted)) + "px";
		const h = menu.offsetHeight;
		// Value menus align on their RIGHT edge with the control; the rest hang left.
		const left = cfg.alignRight ? (r.right - menu.offsetWidth) : r.left;
		menu.style.left = Math.max(M, Math.min(left, window.innerWidth - menu.offsetWidth - M)) + "px";
		let top = r.bottom + 4;
		if (top + h > window.innerHeight - M) top = Math.max(M, r.top - 4 - h);
		menu.style.top = top + "px";
		if (search) search.focus();

		this._qbMenuOutside = (e) => {
			if (menu.contains(e.target) || anchor.contains(e.target)) return;
			this._qbCloseMenu();
		};
		document.addEventListener("mousedown", this._qbMenuOutside, true);
	}

	// ── Reading an existing query back into rows ────────────────────────────
	// Still NOT a parser for Thymer's whole language, and deliberately so. It
	// reads only the boolean SKELETON and hands each leaf to `_qbParseOperand`.
	// A leaf that is not a recognisable condition becomes a RAW node carrying
	// its text verbatim, so an unrecognised fragment costs you that one row,
	// not the whole query: everything around it still opens as real rows.
	//
	// The skeleton is tokenized the way the ENGINE reads it (SDK
	// search-queries.md): quotes protect spaces, brackets nest, AND/OR/NOT work
	// in any case (so do && || !), and ADJACENT terms are an implicit AND —
	// `@todo @nextweek not @overdue` is three conditions, and `(…) @Page` is a
	// group AND a keyword. Comparison operators glue their sides into ONE
	// operand, so `@due <= today` stays a single leaf. Returns a flat
	// alternating list of operands ({text, neg}) and joiners ({op}), or null
	// when the text does not scan (unbalanced quotes or brackets, dangling
	// operators) — the caller then keeps the whole thing verbatim, the one
	// promise this reader never breaks.
	_qbTokens(q) {
		const raw = [];
		let buf = "", depth = 0, inQ = false;
		for (let i = 0; i < q.length; i++) {
			const c = q[i];
			if (c === '"') { inQ = !inQ; buf += c; continue; }
			if (inQ) { buf += c; continue; }
			if (c === "(") depth++;
			else if (c === ")") { depth--; if (depth < 0) return null; }
			if (depth === 0 && /\s/.test(c)) { if (buf) { raw.push(buf); buf = ""; } continue; }
			buf += c;
		}
		if (inQ || depth !== 0) return null;
		if (buf) raw.push(buf);

		// Words become joiners; a comparison operator glues its sides together.
		const CMP = /^(>=|<=|!=|=|>|<)$/;
		const endsCmp = /(>=|<=|!=|=|>|<)$/;
		const toks = [];
		let glue = false;                     // the previous token still wants a value
		for (const t of raw) {
			const lo = t.toLowerCase();
			const last = toks[toks.length - 1];
			if (glue && last && last.text != null) { last.text += " " + t; glue = endsCmp.test(t); continue; }
			if (lo === "and" || t === "&&") { toks.push({ op: "AND" }); continue; }
			if (lo === "or" || t === "||") { toks.push({ op: "OR" }); continue; }
			if (lo === "not" || t === "!") { toks.push({ op: "NOT" }); continue; }
			if (/^(>=|<=|!=|=|>|<)/.test(t) && last && last.text != null) {
				// `= "x"` arriving as one token, or a bare `=` waiting for its value.
				last.text += " " + t;
				glue = CMP.test(t) || endsCmp.test(t);
				continue;
			}
			toks.push({ text: t, neg: false });
			glue = endsCmp.test(t);
		}
		if (glue) return null;                // a trailing `=` with no value

		// Fold NOT into the operand it negates, and make the implicit ANDs
		// explicit. Runs of PLAIN words stay one operand — `meeting notes` is a
		// text search, and splitting it into chips buys the user nothing.
		const plain = (s) => !/^[@#("!]/.test(s);
		const seq = [];
		let neg = false;
		for (const tk of toks) {
			if (tk.op === "NOT") { neg = !neg; continue; }
			if (tk.op) {
				if (neg) return null;              // `not and` — not a query
				const last = seq[seq.length - 1];
				if (!last || last.op) return null; // `and and`, or a leading joiner
				seq.push(tk); continue;
			}
			tk.neg = neg; neg = false;
			const last = seq[seq.length - 1];
			if (last && last.text != null) {
				if (!tk.neg && !last.neg && plain(last.text) && plain(tk.text)) { last.text += " " + tk.text; continue; }
				seq.push({ op: "AND" });           // adjacency IS an AND, per the engine
			}
			seq.push(tk);
		}
		if (neg) return null;                 // a trailing `not`
		if (!seq.length || seq[seq.length - 1].op) return null;
		return seq;
	}

	_qbParseExpr(text, depth) {
		let t = (text || "").trim();
		if (!t) return null;
		while (this._isWrapped(t)) t = t.slice(1, -1).trim();
		// Below the depth the UI can show, stop splitting: the rest is kept as one
		// raw node, which still compiles back verbatim (and still gets its brackets
		// from the precedence helper) rather than becoming structure nobody can edit.
		if (depth <= Plugin.QB_MAX_DEPTH) {
			const seq = this._qbTokens(t);
			if (seq && (seq.length > 1 || seq[0].neg)) return this._qbParseSeq(seq, depth);
		}
		return this._qbParseOperand(t) || { kind: "raw", query: t, title: "" };
	}

	// One token sequence → ONE FLAT level: every operand becomes a row carrying
	// its own joiner (`j`) to the row before it — `A AND B OR C` is three rows
	// in one box, never a nest (his call: a group mixes AND/OR/NOT freely).
	// Only BRACKETS create depth, through _qbLeaf. Negated operands become
	// negated nodes; the NOT level joiner does not exist here.
	_qbParseSeq(seq, depth) {
		const ops = seq.filter((tk) => tk.text != null);
		if (ops.length === 1) return this._qbLeaf(ops[0], depth);
		const rows = [];
		let j = "AND";
		for (const tk of seq) {
			if (tk.op) { j = tk.op; continue; }
			const node = this._qbLeaf(tk, depth + 1);
			if (node) {
				if (rows.length) node.j = j;
				rows.push(node);
			}
			j = "AND";
		}
		return { kind: "group", join: "AND", rows: this._qbFoldExact(rows) };
	}

	// `@X."Field" = "Name" AND @linkto = "<guid>"` is ONE condition wearing the
	// "Is exactly" operator, not two rows — fold the pair back on read so the
	// row the user built comes back as the row they built. Anything else is left
	// exactly as parsed; an unrecognised @linkto stays its own verbatim chip.
	_qbFoldExact(rows) {
		const out = [];
		for (const r of rows) {
			const prev = out[out.length - 1];
			const m = r && this._qbKind(r) === "raw" && !r.neg
				&& String(r.query || "").match(/^@linkto\s*=\s*"([^"]+)"$/i);
			if (m && String(r.j || "AND").toUpperCase() === "AND"
				&& prev && this._qbKind(prev) === "cond" && prev.type === "record"
				&& prev.op === "=" && prev.value) {
				prev.op = "=|x";
				prev.vguid = m[1];
				continue;
			}
			out.push(r);
		}
		return out;
	}

	// One operand → a node: a bracketed operand is its own level (negated, it
	// comes back as a negated GROUP — editable, not a chip), a negated word
	// becomes a negated row wherever one condition can carry the NOT (keyword
	// families through their operator, everything else through the neg flag),
	// and what cannot be read stays verbatim, the NOT kept on the node.
	_qbLeaf(o, depth) {
		const t = (o.text || "").trim();
		if (!t) return null;
		if (this._isWrapped(t)) {
			let node = this._qbParseExpr(t, depth);
			// Brackets ARE a group, even around one condition — otherwise the
			// group the user built dissolves on reopen (see _qbNodeQuery). A
			// NEGATED single condition is left alone: `NOT (@Actions."Due Date"
			// <= "today")` reads far better as one red row than as a negated box,
			// and it already round-trips byte-exact that way.
			if (node && !o.neg && this._qbKind(node) !== "group")
				node = { kind: "group", join: "AND", rows: [node] };
			if (!o.neg || !node) return node;
			return this._qbToggleNeg(node);
		}
		if (o.neg) {
			const b = this._qbParseBuiltin("NOT " + t);   // keyword families: op carries it
			if (b) return b;
			const c = this._qbParseOperand(t);
			if (c && this._qbKind(c) === "cond") return this._qbNegateCond(c);
			return { kind: "raw", query: t, title: "", neg: true };
		}
		return this._qbParseOperand(t) || { kind: "raw", query: t, title: "" };
	}

	// Negate ONE condition row in the way its family expresses negation: the
	// keyword-ish types flip Is/Is-not, everything else takes the NOT pill.
	_qbNegateCond(node) {
		if (["bi-kw", "bi-coll", "bi-tag", "bi-user"].indexOf(node.type) >= 0) {
			node.op = node.op === "!=" ? "=" : "!=";
		} else {
			node.neg = !node.neg;
		}
		return node;
	}

	// One operand → a row, or null when it isn't the builder's own shape.
	_qbParseOperand(text) {
		let t = (text || "").trim();
		while (this._isWrapped(t)) t = t.slice(1, -1).trim();
		const m = /^@("([^"]+)"|[A-Za-z0-9_]+)\.("([^"]+)"|[A-Za-z0-9_]+)\s*(>=|<=|!=|=|>|<)\s*(.+)$/.exec(t);
		if (!m) return this._qbParseBuiltin(t);
		const src = m[2] != null ? m[2] : m[1];
		const field = m[4] != null ? m[4] : m[3];
		const op = m[5];
		let raw = m[6].trim();
		const fdef = this._qbFieldsFor(src).find((f) => f.label === field);
		if (!fdef) return null;                 // unknown collection/field: leave it alone
		let value;
		// The value must be ONE literal and nothing else. `[^"]*` rather than
		// `[\s\S]*` is load-bearing: the greedy version matched from the first quote
		// to the LAST one in the string, so `= "c" AND (@X.y = "d")` parsed as a row
		// whose value was mangled. Caught by the round-trip suite at the nesting cap.
		if (/^"[^"]*"$/.test(raw)) value = raw.slice(1, -1);
		else if (/^-?\d+(\.\d+)?$/.test(raw)) value = raw;
		// A rolling token as a date value (`= @thisweek`, `= @today`) is kept verbatim
		// and compiles back unquoted — but only where a date can live, so a stray
		// @word on a text field stays a raw chip instead of quietly changing meaning.
		else if (/^@[a-z]+$/i.test(raw) && fdef.type === "datetime") value = raw.toLowerCase();
		// A BARE word (`<= today`, `= monday`, `= -monday`) is how his older queries
		// write date values — the engine only needs quotes to protect spaces. Read
		// where a date lives; compiles back QUOTED, the canonical rolling form.
		else if (/^-?[A-Za-z][A-Za-z0-9-]*$/.test(raw) && fdef.type === "datetime") value = raw.toLowerCase();
		else return null;
		return { kind: "cond", src, field, type: fdef.type, op: value === "" ? op + "|e" : op, value };
	}

	// Whole query → model. Never null for a non-empty query any more: the worst
	// case is a single raw node holding the whole thing, which is exactly the old
	// base-chip fallback, now just living in the tree like everything else.
	_qbParse(query) {
		let q = (query || "").trim();
		if (!q) return null;
		// Older queries can carry the pretty comparison glyphs; the engine's forms
		// are the ASCII pairs, so canonicalise them OUTSIDE quotes before reading.
		if (/[≤≥≠]/.test(q)) {
			let out = "", inQ = false;
			for (const c of q) {
				if (c === '"') { inQ = !inQ; out += c; continue; }
				out += inQ ? c : (c === "≤" ? "<=" : c === "≥" ? ">=" : c === "≠" ? "!=" : c);
			}
			q = out;
		}
		const node = this._qbParseExpr(q, 0);
		if (!node) return null;
		const root = this._qbKind(node) === "group" ? node : { kind: "group", join: "AND", rows: [node] };
		return this._qbNormalize(root);
	}

	// ── Date picker ─────────────────────────────────────────────────────────
	// Thymer's own datepicker markup, so the app themes and sizes it. The layout
	// zeroing comes from Supertask's mini calendar, which paid for those lessons.
	_qbCloseHelp() {
		if (this._qbHelpOutside) { document.removeEventListener("mousedown", this._qbHelpOutside, true); this._qbHelpOutside = null; }
		this._qbHelpPop = null;
		document.querySelectorAll(".qb-help-pop").forEach((e) => e.remove());
	}

	_qbOpenHelp(anchor) {
		this._qbCloseHelp();
		const box = document.createElement("div");
		box.className = "qb-help-pop";
		box.addEventListener("mousedown", (e) => e.stopPropagation());
		box.appendChild(this._qbHelpEl());
		document.body.appendChild(box);
		// Hangs under the ?, right-aligned to it, and flips above when there is no room.
		const r = anchor.getBoundingClientRect(), M = 8;
		const w = box.offsetWidth, h = box.offsetHeight;
		box.style.left = Math.max(M, Math.min(r.right - w, window.innerWidth - w - M)) + "px";
		const below = r.bottom + 6;
		box.style.top = (below + h > window.innerHeight - M ? Math.max(M, r.top - 6 - h) : below) + "px";
		this._qbHelpPop = box;
		this._qbHelpOutside = (e) => { if (!box.contains(e.target) && !anchor.contains(e.target)) this._qbCloseHelp(); };
		document.addEventListener("mousedown", this._qbHelpOutside, true);
	}

	_qbCloseCal() {
		const rs = this._qbRsCal;
		this._qbRsCal = null;
		if (typeof rs === "function") try { rs(); } catch (e) {}
	}

	// A date box is open (Supertask's or our copy of it; its own element, outside the builder).
	_qbRsCalOpen() { return !!this._qbRsCal && !!document.querySelector(".rs-pop"); }

	_qbOpenCal(anchor, current, onPick, label) {
		this._qbCloseCal();
		// Every date field opens SUPERTASK'S date box, the one you can TYPE a date into
		// in natural language (his rule; his correction 2026-10-11). With a Supertask
		// that offers it for a field (`__rsDateBox.pickField`), its own box opens; else
		// this plugin's copy of the same box (SsDateBox, generated from Supertask by
		// tools/sync-datebox.py; his call 2026-10-29: it must work without Supertask).
		// Either way: nothing is written, onPick gets "YYYY-MM-DD[ HH:MM]" or "" (Clear).
		const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec((current || "").trim());
		const pad = (n) => String(n).padStart(2, "0");
		const ymdIso = (n) => Math.floor(n / 10000) + "-" + pad(Math.floor(n / 100) % 100) + "-" + pad(n % 100);
		this._qbFocusAfter = this._qbControlRef(anchor);
		const rs = this._rsBox();
		if (rs && rs.contract === 1 && typeof rs.pickField === "function") {
			try {
				this._qbRsCal = rs.pickField(anchor, m ? { ymd: +m[1] * 10000 + +m[2] * 100 + +m[3], time: m[4] ? m[4] + ":" + m[5] : null } : null, (v) => {
					this._qbRsCal = null;
					onPick(v ? ymdIso(v.ymd) + (v.time ? " " + v.time : "") : "");
				}, { label: label || "Date" });
				return;
			} catch (e) { this._qbRsCal = null; /* fall back to our copy */ }
		}
		this._ssdbCss();
		const box = this._ssdb || (this._ssdb = new SsDateBox());
		const cur = m ? (m[4] ? DateTime.dateAndTime(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0) : DateTime.dateOnly(+m[1], +m[2] - 1, +m[3])) : null;
		const t = {
			kind: "field", anchorEl: anchor, cur, label: label || "Date",
			onPick: (dt) => {
				this._qbRsCal = null;
				if (!dt) { onPick(""); return; }
				const p = dt.getParts();
				onPick(ymdIso(p.year * 10000 + (p.month + 1) * 100 + p.day)
					+ (p.hours !== undefined ? " " + pad(p.hours) + ":" + pad(p.minutes || 0) : ""));
			},
		};
		box.openPicker(t);
		const pop = box.pop;
		if (!pop) return;
		// a query value has no repeat and no end date
		for (const sel of [".rs-reprow", ".rs-addend"]) { const el = pop.querySelector(sel); if (el) el.style.display = "none"; }
		box.place(pop, t);
		this._qbRsCal = () => { if (box.pop === pop) box.closePicker(); };
	}

	// Supertask's published date box, if it is installed (one place to read it).
	_rsBox() { return window.__rsDateBox || null; }

	// The copy's stylesheet, only while Supertask is absent: Supertask's own rules
	// style the same classes, and an older copy of them must never restyle its box.
	_ssdbCss() {
		const mine = document.querySelector("style[data-ssdb]");
		if (this._rsBox()) { if (mine) mine.remove(); return; }
		if (mine) return;
		const st = document.createElement("style");
		st.setAttribute("data-ssdb", "");
		st.textContent = SSDB_CSS;
		document.head.appendChild(st);
	}

	// Which collection does a record ("page link") property point at? The schema DOES
	// say: `filter_colguid` on the field. An earlier note here claimed it did not and
	// the values were learned from an existing link instead — measured 2026-08-11,
	// it is present on 174 of the 225 record fields in this workspace, so the exact
	// answer is free and works even when the field is empty everywhere (which was the
	// hole in the heuristic). The remaining 51 are UNCONSTRAINED record fields that
	// can link to anything; those still need the old scan, so it stays as a fallback.
	// A page's icon lives in its "Icon" property — nothing icon-like sits on
	// the raw row (measured 2026-08-14).
	_qbPageIcon(r) {
		// getIcon() IS the API for a page's icon — the record's own accessor, which
		// is what Thymer itself renders from. The old reading went at the "Icon"
		// PROPERTY directly; the two agree wherever the property exists, but the
		// property is a workspace convention and the accessor is not, so ask the
		// accessor first and keep the property as the fallback (measured
		// 2026-08-15: Action Status pages answer ti-check / ti-activity /
		// ti-alert-triangle from both, Timeblocks pages answer null from both —
		// those pages simply HAVE no icon, and a dot is the honest rendering).
		try {
			const i = r.getIcon && r.getIcon();
			if (typeof i === "string" && i.indexOf("ti-") === 0) return i;
		} catch (e) { /* fall through to the property */ }
		try {
			const ip = r.prop && r.prop("Icon");
			const t = ip && ip.texts ? ip.texts() : null;
			if (t && typeof t[0] === "string" && t[0].indexOf("ti-") === 0) return t[0];
		} catch (e) { /* no Icon property — the dot fallback covers it */ }
		return "";
	}

	// A page's icon, with the app's own fallback: pages that carry no icon are
	// drawn with their COLLECTION's icon (his correction 2026-08-15 — the native
	// chip for a Timeblock shows ti-clock, which is the Timeblocks collection's
	// icon, not something on the page). Measured: Timeblocks → ti-clock,
	// Action Status → ti-stopwatch, while pages that DO have an icon keep it.
	_qbRecordIcon(r, colIcon) {
		const own = this._qbPageIcon(r);
		if (own) return own;
		if (colIcon) return colIcon;
		try {
			const pg = r._getRow && r._getRow().pguid;
			const c = pg && (this._qbCols || []).find((x) => x.guid === pg);
			if (c && c.icon) return c.icon;
		} catch (e) { /* no row — the dot fallback covers it */ }
		return "";
	}

	async _qbRecordOptions(srcName, fieldLabel) {
		this._qbRecCache = this._qbRecCache || {};
		const key = srcName + "|" + fieldLabel;
		if (this._qbRecCache[key]) return this._qbRecCache[key];
		let out = [];
		try {
			const cols = this._qbCols || [];
			const src = cols.find((c) => c.name === srcName);
			const fdef = src && (src.fields || []).find((f) => f.label === fieldLabel);
			let target = (fdef && fdef.filter_colguid) ? cols.find((c) => c.guid === fdef.filter_colguid) : null;
			const used = [];
			if (!target && src && src.api) {
				let recs = src.api.getAllRecords();
				if (recs && typeof recs.then === "function") recs = await recs;
				let targetGuid = "";
				for (const r of (recs || []).slice(0, 400)) {
					let linked = [];
					try { linked = r.linkedRecords(fieldLabel) || []; } catch (e) { linked = []; }
					for (const lr of linked) {
						const nm = lr.getName ? lr.getName() : "";
						// The fallback list carries the pages' real icons too — it used
						// to hand back names only, which drew a wall of dots on
						// unconstrained fields like "Sub-page of" (his report).
						if (nm && !used.some((u) => u.name === nm)) used.push({ name: nm, icon: this._qbRecordIcon(lr) });
						if (!targetGuid) { try { targetGuid = (lr._getRow && lr._getRow().pguid) || ""; } catch (e) {} }
					}
					if (targetGuid && used.length > 3) break; // enough to identify the target
				}
				target = targetGuid && cols.find((c) => c.guid === targetGuid);
			}
			if (target && target.api) {
				let all = target.api.getAllRecords();
				if (all && typeof all.then === "function") all = await all;
				// Each page brings its own icon, read from its "Icon" property (that is
				// where it lives — ti-check on Done, ti-hourglass on Pending; measured).
				// Thymer's own suggestion engine sends record icons the same way.
				out = (all || []).map((r) => {
					const name = r.getName ? r.getName() : "";
					if (!name) return null;
					let row = null;
					try { row = r._getRow ? r._getRow() : null; } catch (e) { row = null; }
					return { name, icon: this._qbRecordIcon(r, target.icon),
						guid: (row && row.guid) || "",
						at: (row && (row.u_at || row.c_at)) || 0 };
				}).filter(Boolean);
			}
			if (!out.length) out = used;
			const seen = new Set();
			// MOST RECENTLY TOUCHED FIRST, not alphabetical — his report: the values
			// "come in the wrong order" against the app's own pickers, and his read
			// is that Thymer orders them by modified. The workspace corroborates it:
			// his nine Timeblocks pages, sorted by u_at descending, come out in the
			// natural order of a day (Early Morning → Late Evening), which is the
			// order he edited them in and nothing else here reproduces. Records with
			// no timestamp, and the fallback scan list, keep alphabetical order.
			out = out.filter((x) => (seen.has(x.name) ? false : (seen.add(x.name), true)))
				.sort((a, b) => ((b.at || 0) - (a.at || 0)) || a.name.localeCompare(b.name));
		} catch (e) { out = []; }
		this._qbRecCache[key] = out;
		return out;
	}

	// User fields match on name/handle (fuzzy), per the SDK's own query reference,
	// so the workspace's people are the value set. Nothing in this workspace uses a
	// user-typed field today, which is why this had stayed a free-text box.
	_qbUserOptions() {
		if (this._qbUsers) return this._qbUsers;
		let out = [];
		try {
			out = (this.data.getActiveUsers() || [])
				.map((u) => (u.getDisplayName && u.getDisplayName()) || (u.getEmail && u.getEmail()) || "")
				.filter(Boolean);
		} catch (e) { out = []; }
		this._qbUsers = [...new Set(out)].sort((a, b) => a.localeCompare(b));
		return this._qbUsers;
	}

	// seed: {library} from the bookmark (an empty field opens on the library),
	// {openAt: k} from a chip (that saved search opens folded out).
	async _qbOpen(seed, ctxIn) {
		const ctx = ctxIn;
		if (!ctx) return;
		this._qbClose(false);             // never leave a second builder behind
		const input = ctx.input;
		const btn = this._popBtn;         // anchor the builder where the bookmark is
		this._closePopup();               // the list makes way for the builder
		await this._qbLoadCollections(true);
		// A normal collection defaults every row to itself; a dynamic one (no
		// matching collection of that name) leaves the source for you to pick.
		const all = this._qbCols || [];
		const self = all.find((c) => c.name === ctx.colName);
		// What the source picker may offer. A dynamic collection is not itself in
		// getAllCollections(), so `self` is null there and the view's own sources are
		// the answer; everywhere else the whole list stays available.
		let sources = all;
		if (!self && ctx.sourceCols) {
			const want = new Set(ctx.sourceCols);
			const only = all.filter((c) => c.guid && want.has(c.guid));
			if (only.length) sources = only;
		}
		// Whatever is already in the field comes WITH you, read back as real rows
		// wherever the reader recognises the shape and as a verbatim chip where it
		// does not. Either way the text is never silently reinterpreted.
		// Opened from the pencil, the SAVED query is what we take apart — not whatever
		// the field happens to hold. (Cancel still restores the field, untouched.)
		const existing = (seed && seed.query != null) ? String(seed.query).trim() : (input.value || "").trim();
		let parsed = null;
		if (!(seed && seed.model) && existing) {
			// Saved searches in the text come back as saved rows, not as their insides.
			parsed = this._qbParseWithSaved(existing, this._items(), ctx.col, seed ? seed.openAt : null);
			// Nothing was recognised: that one chip IS the search, so give it the
			// saved name when the field holds a search we know.
			if (parsed && parsed.rows.length === 1 && this._qbKind(parsed.rows[0]) === "raw") {
				const known = this._items().find((x) => x.col === ctx.col && x.query === existing);
				if (known) parsed.rows[0].title = known.title;
			}
		}
		// Editing an existing search keeps its identity: same id, same place in the
		// list. Without this, saving after an edit produced a duplicate every time.
		const editing = (seed && seed.editId) ? this._items().find((x) => x.id === seed.editId) : null;
		this._qb = {
			input, btn,
			col: ctx.col, colName: ctx.colName,
			viewId: ctx.viewId, viewName: ctx.viewName, isTasks: ctx.isTasks,
			sources,
			// One candidate means there is nothing to choose: a normal collection, or a
			// dynamic view that pulls from a single collection (Finance's Incomes view).
			defaultSrc: self ? self.name : (sources.length === 1 ? sources[0].name : ""),
			lockSrc: !!self || sources.length === 1,
			prevQuery: input.value,        // Cancel restores exactly this
			model: this._qbNormalize((seed && seed.model) || parsed || { join: "AND", rows: [] }),
			title: (seed && seed.title) || "",
			editId: editing ? editing.id : null,
			// An existing search keeps the scope it already had; a new one defaults
			// to the view you are standing in, exactly like saving from the field.
			saveViewId: editing ? editing.viewId : ctx.viewId,
			saveViewName: editing ? (editing.viewName || "") : ctx.viewName,
			naming: false,
		};
		// The bookmark on an empty field opens on the library: the first row is
		// "Pick a saved search" with its picker already open, and the picker's
		// "New search" is the way to build one from scratch.
		const library = !!(seed && seed.library) && !this._qb.model.rows.length;
		if (library) this._qb.model.rows.push({ kind: "saved", sid: null, title: "", query: "", rows: [], open: false, neg: false, j: "AND" });
		if (!this._qb.model.rows.length) this._qbAddRow();
		this._qbBuild();
		this._qbApply();
		if (library) this._qbOpenLibraryAt("0");
	}

	_qbClose(restore) {
		if (!this._qb) return;
		this._qbCloseMenu();
		this._qbCloseCal();
		this._qbCloseHelp();
		// Done must FLUSH, never cancel: the apply is debounced (500ms on
		// blocks), every edit restarts the clock, and a quick build ended with
		// Done inside the window used to discard the whole query — his report:
		// "trycker man på done och öppnar igen så är inte sökningen kvar".
		if (!restore) {
			if (this._qbTimer) { clearTimeout(this._qbTimer); this._qbTimer = null; }
			const q = this._qbCompile(this._qb.model);
			if (this._qb.block) {
				if (q && q !== this._qb.applied) {
					this._qb.applied = q;
					this._qBlockApply(this._qb.block, q);
				}
			} else if (this._qb.input) {
				this._apply(this._qb.input, q);
			}
		}
		if (restore) {
			if (this._qb.block) {
				// Only rewrite when something was actually applied — otherwise Cancel
				// on an untouched block would be a pointless synced write.
				if (this._qb.applied !== this._qb.prevQuery) this._qBlockApply(this._qb.block, this._qb.prevQuery);
			} else this._apply(this._qb.input, this._qb.prevQuery);
		}
		if (this._qbEl) { this._qbEl.remove(); this._qbEl = null; }
		if (this._qbOutside) { document.removeEventListener("mousedown", this._qbOutside, true); this._qbOutside = null; }
		if (this._qbTimer) { clearTimeout(this._qbTimer); this._qbTimer = null; }
		this._qb = null;
		if (this._dirty) this._flush();   // a library edit waits for the panel to close
	}

	// Live apply, debounced so dragging a select doesn't re-query per frame.
	// On a BLOCK every apply is a synced write, so the debounce is longer, no-op
	// and empty queries are never written, and what was last applied is tracked
	// so Cancel knows whether there is anything to undo.
	_qbApply() {
		if (this._qbTimer) clearTimeout(this._qbTimer);
		const wait = this._qb && this._qb.block ? 500 : 220;
		this._qbTimer = setTimeout(() => {
			this._qbTimer = null;
			if (!this._qb) return;
			const q = this._qbCompile(this._qb.model);
			if (this._qb.block) {
				if (q && q !== this._qb.applied) {
					this._qb.applied = q;
					const w = this._qBlockApply(this._qb.block, q);
					if (w && typeof w.then === "function") w.then((ok) => {
						if (ok !== false || !this._qbEl) return;
						const ln = this._qbEl.querySelector(".qb-hitsline");
						if (ln) ln.textContent = "Couldn't write to the block — see the console";
					});
				}
				setTimeout(() => this._qbPaintFoot(), 700);
				return;
			}
			this._apply(this._qb.input, q);
			setTimeout(() => this._qbPaintFoot(), 700); // let the view finish counting
			setTimeout(() => this._qbPaintFoot(), 2000); // a slow recount (a big view) is caught here
		}, wait);
	}

	_qbHits() {
		if (this._qb && this._qb.block) {
			// The statusbar counts the collection view; a block's result set is its
			// own rendered rows.
			const row = document.querySelector('.listitem.listitem-query[data-guid="' + this._qb.block + '"]');
			if (!row) return "";
			const n = row.querySelectorAll(".block-content > .listitem").length;
			return n + (n === 1 ? " row" : " rows");
		}
		// The VISIBLE one: hidden status bars of other views carry their own counts
		// (it said "413 items" over a view showing 48).
		const el = [...document.querySelectorAll(".statusbar-item--label")]
			.find((x) => x.offsetParent && /items?/i.test(x.textContent || ""));
		return el ? el.textContent.trim() : "";
	}

	// Is there anything to clear? Either the builder has compiled something, or the
	// field carried a query in that the builder has not taken apart into rows.
	_qbHasQuery() {
		if (!this._qb) return false;
		// Block mode has no input field; what is clearable there is the model
		// plus whatever the BLOCK is currently filtering on (`applied`).
		if (this._qb.block) return !!this._qbCompile(this._qb.model) || !!String(this._qb.applied || "").trim();
		return !!this._qbCompile(this._qb.model) || !!((this._qb.input && this._qb.input.value) || "").trim();
	}

	_qbPaintFoot() {
		if (!this._qbEl) return;
		// The field can change without a rebuild (typing in a value box only re-applies),
		// so the Clear button's state is refreshed on the same tick as the count.
		const hc = this._qbEl.querySelector(".qb-headclear");
		if (hc) hc.classList.toggle("qb-btn-off", !this._qbHasQuery());
		const q = this._qbCompile(this._qb.model);
		const line = this._qbEl.querySelector(".qb-hitsline");
		const hits = this._qbEl.querySelector(".qb-hits");
		if (line) {
			line.textContent = q ? "" : "No conditions yet";
			line.setAttribute("title", q);      // the full query, on hover
		}
		if (hits) hits.textContent = q ? this._qbHits() : "";
	}

	_qbBuild() {
		this._qbCloseMenu(); // a rebuild would orphan an open menu and its listener
		// A rebuild replaces every node, which would drop focus mid-keyboard-run.
		// Remember where the caret was and put it back on the matching control.
		const ae = document.activeElement;
		let keep = null;
		if (this._qbEl && ae && this._qbEl.contains(ae)) keep = this._qbControlRef(ae);
		// Nothing focused inside the panel means the last interaction was a mouse pick
		// in a menu or the calendar, which parks focus on <body>; that control asked
		// for it back when it opened.
		if (!keep && this._qbFocusAfter) keep = this._qbFocusAfter;
		this._qbFocusAfter = null;
		// A rebuild throws the whole panel away and builds a new one, which reset
		// the list to the top: dragging a row between two groups halfway down
		// made the view "hoppa upp flera steg" (his report). Carry the scroll
		// offset across, restored once the new body is laid out.
		const keepScroll = this._qbEl
			? ((this._qbEl.querySelector(".qb-body") || {}).scrollTop || 0) : 0;
		if (this._qbEl) this._qbEl.remove();
		this._qbRestoreFocus = keep;
		const el = document.createElement("div");
		el.className = "qb-pop";
		el.addEventListener("mousedown", (e) => e.stopPropagation());
		this._qbEl = el;

		// header
		const head = document.createElement("div");
		head.className = "qb-head";
		const ht = document.createElement("div");
		ht.className = "qb-head-title";
		ht.textContent = "Smart Searches";
		const hs = document.createElement("div");
		hs.className = "qb-head-sub";
		// A live query needs no subtitle: the title carries it (his call;
		// the feature is named Live Query in the app now, and "on a live search"
		// was yesterday's name anyway).
		hs.textContent = this._qb.block ? "" : (this._qb.colName ? "in " + this._qb.colName : "");
		// Start over without leaving: empties every condition AND the filter field.
		// (Cancel is the other thing — it puts back what was there before you opened
		// the builder, which is not the same as clearing.)
		const clear = document.createElement("button");
		// Dimmed while there is nothing to clear — conditions in the builder, or a
		// query the field carried in — the same rule as the popup's Clear Search.
		clear.className = "qb-btn qb-headclear" + (this._qbHasQuery() ? "" : " qb-btn-off");
		clear.textContent = "Clear Search";
		clear.addEventListener("click", (e) => {
			e.stopPropagation();
			this._qb.model = this._qbNormalize({ join: "AND", rows: [] });
			this._qbAddRow();
			// An EXPLICIT Clear does write the empty query to a block — it returns
			// to its default view, and the button can dim truthfully. The
			// never-write-empty rule guards MID-EDIT compiles (an unfinished row
			// must not blank the block), not a deliberate reset.
			if (this._qb.block && String(this._qb.applied || "").trim()) {
				this._qb.applied = "";
				this._qBlockApply(this._qb.block, "");
			}
			this._qbBuild();
			this._qbApply();
		});
		// Collapse All / Expand All — one button, label follows state; only shown
		// when there are groups to fold (his ask, for the many-group queries).
		const runs = this._qbAllRuns();
		const folds = this._qb.folds || (this._qb.folds = new Set());
		let foldAll = null;
		if (runs.length > 1) {
			const anyOpen = runs.some((r) => !folds.has(r));
			foldAll = document.createElement("button");
			foldAll.className = "qb-btn qb-foldall";
			foldAll.textContent = anyOpen ? "Collapse All" : "Expand All";
			foldAll.addEventListener("click", (e) => {
				e.stopPropagation();
				if (anyOpen) runs.forEach((r) => folds.add(r));
				else folds.clear();
				this._qbBuild();
			});
		}
		// The help sits where the question comes up, folded away until asked for.
		const help = document.createElement("button");
		help.className = "qb-btn qb-help-btn";
		help.textContent = "?";
		help.setAttribute("title", "How this works");
		// A popover, not a fold: expanding inside the panel pushed the conditions down
		// and resized the whole thing, which is disorienting when you are mid-build.
		help.addEventListener("click", (e) => {
			e.stopPropagation();
			if (this._qbHelpPop) { this._qbCloseHelp(); return; }
			this._qbOpenHelp(help);
		});
		const x = document.createElement("span");
		x.className = "qb-x ti ti-x";
		x.setAttribute("title", "Cancel (restores the previous filter)");
		x.addEventListener("click", () => this._qbClose(true));
		head.appendChild(ht); head.appendChild(hs);
		if (foldAll) head.appendChild(foldAll);
		head.appendChild(help); head.appendChild(clear); head.appendChild(x);
		el.appendChild(head);

		// rows
		const body = document.createElement("div");
		body.className = "qb-body";
		el.appendChild(body);
		this._qbGroupInto(body, this._qb.model, "", 0);

		if (!(this._qbCols || []).length) {
			const warn = document.createElement("div");
			warn.className = "qb-empty";
			warn.textContent = "No collections could be read, so the pickers are empty.";
			body.appendChild(warn);
		}

		// footer
		const foot = document.createElement("div");
		foot.className = "qb-foot";
		el.appendChild(foot);
		if (this._qb.naming) {
			foot.classList.add("qb-foot-naming");
			const editing = !!this._qb.editId;
			const name = document.createElement("input");
			name.className = "qb-name";
			name.type = "text";
			name.placeholder = "Title";
			// What was typed survives a rebuild (picking "Show in" redraws the footer).
			name.value = this._qb.nameDraft != null ? this._qb.nameDraft : (this._qb.title || "");
			name.addEventListener("input", () => { this._qb.nameDraft = name.value; });
			name.addEventListener("keydown", (e) => {
				e.stopPropagation();
				if (e.key === "Enter") { e.preventDefault(); this._qbSave(name.value); }
				else if (e.key === "Escape") { e.preventDefault(); this._qb.naming = false; this._qbBuild(); }
			});
			const sp = document.createElement("div");
			sp.className = "qb-preview";
			sp.textContent = editing ? "Editing “" + (this._qb.title || "this search") + "”" : "Name this search";
			const r1 = document.createElement("div");
			r1.className = "qb-foot-row";
			r1.appendChild(sp); r1.appendChild(name);

			const r2 = document.createElement("div");
			r2.className = "qb-foot-row";
			r2.appendChild(this._qbScopeEl());
			const spacer = document.createElement("div");
			spacer.className = "qb-foot-spacer";
			r2.appendChild(spacer);
			const back = document.createElement("button");
			back.className = "qb-btn";
			back.textContent = "Back";
			back.addEventListener("click", (e) => { e.stopPropagation(); this._qb.naming = false; this._qbBuild(); });
			r2.appendChild(back);
			// Editing offers both outcomes explicitly, so neither one is a surprise:
			// keep the same search, or branch a new one off it.
			if (editing) {
				const asnew = document.createElement("button");
				asnew.className = "qb-btn";
				asnew.textContent = "Save as new";
				asnew.addEventListener("click", (e) => {
					e.stopPropagation();
					this._qb.editId = null;
					this._qbSave(name.value);
				});
				r2.appendChild(asnew);
			}
			const ok = document.createElement("button");
			ok.className = "qb-btn qb-btn-primary";
			ok.textContent = editing ? "Update" : "Save";
			ok.addEventListener("click", (e) => { e.stopPropagation(); this._qbSave(name.value); });
			r2.appendChild(ok);

			foot.appendChild(r1); foot.appendChild(r2);
			this._qbPlace();
			name.focus(); name.select();
			return;
		}
		// The compiled query used to be spelled out here. It was the widest thing in
		// the footer, it truncated mid-string on anything real, and it says nothing
		// the rows above do not already show — so it is a tooltip now, and the row
		// count (which the rows CANNOT tell you) gets the space.
		const pv = document.createElement("div");
		pv.className = "qb-hitsline";
		const hits = document.createElement("div");
		hits.className = "qb-hits";
		const cancel = document.createElement("button");
		cancel.className = "qb-btn";
		cancel.textContent = "Cancel";
		cancel.addEventListener("click", (e) => { e.stopPropagation(); this._qbClose(true); });
		const saveAs = document.createElement("button");
		saveAs.className = "qb-btn";
		// Editing an existing search never says "Save as" — that is the other outcome,
		// and it lives inside the naming step as "Save as new".
		// A query that IS one saved search (loaded from the library or a chip) is
		// that search being edited, so its button updates it.
		const target = this._qbEditTarget();
		saveAs.textContent = target ? "Update…" : "Save as…";
		// A live search belongs to a page, not a collection, and saved searches are
		// filed per collection — so on a block there is nothing to save INTO.
		if (this._qb.block) saveAs.style.display = "none";
		saveAs.addEventListener("click", (e) => {
			e.stopPropagation();
			if (!this._qbCompile(this._qb.model)) return;
			const item = target && this._items().find((x) => x.id === target.sid);
			this._qb.editId = item ? item.id : null;
			this._qb.title = item ? item.title : "";
			this._qb.saveViewId = item ? item.viewId : this._qb.viewId;
			this._qb.saveViewName = item ? (item.viewName || "") : this._qb.viewName;
			this._qb.nameDraft = null;
			this._qb.naming = true;
			this._qbBuild();
		});
		const done = document.createElement("button");
		done.className = "qb-btn qb-btn-primary";
		done.textContent = "Done";
		done.addEventListener("click", (e) => { e.stopPropagation(); this._qbClose(false); });
		foot.appendChild(pv); foot.appendChild(hits); foot.appendChild(cancel); foot.appendChild(saveAs); foot.appendChild(done);

		this._qbPlace();
		if (keepScroll) body.scrollTop = keepScroll;
		this._qbPaintFoot();
		this._qbPaintSel();
		el.addEventListener("click", () => {
			if (this._qb && this._qb.sel) { this._qb.sel = null; this._qbPaintSel(); }
		});

		const keepF = this._qbRestoreFocus;
		this._qbRestoreFocus = null;
		if (keepF) {
			const scope = keepF.row != null ? el.querySelector('[data-row="' + keepF.row + '"]') : el;
			const back = scope && (scope.querySelector("." + keepF.cls) || el.querySelector("." + keepF.cls));
			if (back && back.focus) back.focus();
		}
	}

	// Where the saved search will show up. The rest of the plugin scopes searches
	// per view with a "whole collection" option and drag between the two; the
	// builder used to file everything as global with no say in it.
	_qbScopeEl() {
		const G = Plugin.GLOBAL_VIEW;
		const opts = [];
		// A search already filed in another view keeps that as an option, so
		// re-saving it from somewhere else never silently moves it.
		if (this._qb.saveViewId && this._qb.saveViewId !== G && this._qb.saveViewId !== this._qb.viewId) {
			opts.push({ v: this._qb.saveViewId, label: this._qb.saveViewName || "Its current view", icon: "ti-layout-list" });
		}
		if (this._qb.viewId && this._qb.viewId !== G) {
			opts.push({ v: this._qb.viewId, label: this._qb.viewName || "This view", icon: "ti-layout-list" });
		}
		opts.push({ v: G, label: this._qb.isTasks ? "All task views" : "Whole collection", icon: "ti-folders" });
		const cur = opts.find((o) => o.v === this._qb.saveViewId) || opts[opts.length - 1];
		this._qb.saveViewId = cur.v;

		const wrap = document.createElement("div");
		wrap.className = "qb-scope";
		const lb = document.createElement("span");
		lb.className = "qb-scope-label";
		lb.textContent = "Show in";
		wrap.appendChild(lb);
		wrap.appendChild(this._qbTrigger("qb-scope-sel", cur.label, "", (btn) => {
			this._qbMenu(btn, opts, this._qb.saveViewId, (v) => {
				const p = opts.find((o) => o.v === v);
				this._qb.saveViewId = v;
				this._qb.saveViewName = (p && v !== G) ? p.label : "";
				this._qbBuild();
			}, { dots: false, width: 200 });
		}));
		return wrap;
	}

	// The help, folded away behind the ? in the header. Deliberately short: it
	// explains the two words the buttons use and the three behaviours that surprise
	// people, and nothing else. Anything longer does not get read.
	_qbHelpEl() {
		const box = document.createElement("div");
		box.className = "qb-help";
		const h = (t) => { const e = document.createElement("div"); e.className = "qb-help-h"; e.textContent = t; box.appendChild(e); };
		const p = (t) => { const e = document.createElement("p"); e.className = "qb-help-p"; e.textContent = t; box.appendChild(e); };
		const li = (t) => { const e = document.createElement("li"); e.textContent = t; return e; };
		h("Conditions");
		p("A condition is a field, an operator and a value. Each row's AND/OR joins it with "
			+ "the row above, and one box mixes them freely — AND binds tighter than OR, so "
			+ "A AND B OR C reads as (A AND B) OR C. NOT on a row's lead excludes that one "
			+ "condition or group; red means excluded.");
		h("Condition groups");
		p("A group is a box inside a level, for when part of the query needs the other joiner: "
			+ "\u201cStatus is Done AND (Stage is Won OR Stage is Lost)\u201d. The group counts as one "
			+ "thing. Adding a group also puts the conditions you already have in a box of their own, "
			+ "so the joiner between the boxes is yours to set \u2014 click it on the divider. "
			+ "In the filter field a group shows as parentheses, added only where they change the "
			+ "answer: AND binds tighter than OR, and NOT applies only to the thing right after it, "
			+ "so excluding a group always needs them.");
		h("Behaviour");
		const ul = document.createElement("ul");
		ul.className = "qb-help-list";
		ul.appendChild(li("Operators follow the field. On text and page links, = means contains."));
		ul.appendChild(li("On a choice field it must be one of the options."));
		ul.appendChild(li("Set / Not Set ask whether the field has any value at all."));
		ul.appendChild(li("The filter updates as you build. Done keeps it, Cancel puts the field back "
			+ "the way it was."));
		ul.appendChild(li("Anything the builder cannot express is kept exactly as you wrote it and "
			+ "shown as a chip you can remove."));
		box.appendChild(ul);
		return box;
	}

	_qbPath(path, i) { return path === "" ? String(i) : path + "." + i; }

	// Render ONE level, to Parham's mockup: the level's own conditions sit in a full
	// width BOX together with the buttons that add to that level, and each nested
	// group follows as another box of exactly the same shape, separated by a divider
	// row carrying the joiner and that group's delete. Nothing is indented — the first
	// design nested the boxes inside a lead column, which he rejected, and which also
	// ran out of width two levels down.
	//
	// Boxes are emitted in MODEL ORDER (a group in the middle closes the current box
	// and the next plain row opens a new one), because the reader can produce a group
	// anywhere in a level and reordering the model would change the query TEXT — the
	// round-trip guarantee is worth more than always having exactly two boxes.
	// There is NO bare add-buttons row under the last box any more: every box
	// carries its own pair, and the trailing row stacked one copy per ancestor
	// level and answered a question nobody asked (his call, 2026-08-14: "vad
	// gör den för nytta? Den finns ju i varje grupp redan"). Adding to an
	// all-groups level happens inside its boxes; nesting flattens back to the
	// same query where the joins agree.
	// `carry` is a stack's joiner travelling DOWN to the first row that renders
	// — see the hand-down note where groups are laid out.
	_qbGroupInto(container, group, path, depth, carry, headRun, asRoot) {
		let box = null, actionsPlaced = false, pend = carry || null, savedBox = null;
		const newBox = () => {
			box = document.createElement("div");
			// Indent = how many GROUPS the box sits inside. A root-level group is
			// a SIBLING of the root's own box and aligns with it (depth-1); only
			// a group inside a group steps in — his report: root groups looked
			// like children of Page.
			box.className = "qb-block qb-depth-" + Math.min(Math.max(0, depth - 1), 3);
			const b2 = box;
			// The box's empty background selects its OWNING group (the root's own
			// boxes select nothing — the root cannot be indented anywhere).
			b2.addEventListener("click", (e) => {
				if (e.target !== b2) return;
				e.stopPropagation();
				if (this._qb && group !== this._qb.model) this._qbSelect(group);
			});
			container.appendChild(box);
			return box;
		};
		const rows = group.rows || [];
		// Only keyword conds WITH a value are strip chips: a fresh "Any item" row
		// has none yet, and as a chip it read as a bare "Keyword" placeholder that
		// hid the picked source (his report) — it stays a full row until a value
		// is picked, then joins the strip.
		const isKw = (x) => this._qbKind(x) === "cond" && x.src === Plugin.ANY_ITEM && x.type === "bi-kw" && x.value;
		let i = 0;
		while (i < rows.length) {
			const n = rows[i];
			const p = this._qbPath(path, i);
			if (this._qbKind(n) === "group") {
				// A group closes the current box. NEVER open one just to hold the
				// buttons: a level whose first child is a group (what a saved
				// `(A AND B) OR (C AND D)` reads back as) then drew an empty framed
				// strip above it, and a second one between the groups.
				if (box && !actionsPlaced) { box.appendChild(this._qbActionsEl(group, depth, i)); actionsPlaced = true; }
				// THE ROW BELONGS TO THE BOX UNDER IT (his rule, 2026-08-14: "första
				// gruppen … tillhör AND-raden"). A stack — a group whose FIRST row
				// is another group — has no box of its own to lead, so its header
				// would sit directly above its first CHILD's box and read as that
				// child's row. It therefore renders NO row: its joiner is HANDED
				// DOWN to the first row that does render, which sits indented with
				// the box it leads ("AND ska vara indenterad med Action"). What is
				// left of the stack is the indentation, which is all he ever asked
				// it to show. Blocked when either side is negated — a red NOT must
				// say exactly what it excludes, and one lead cannot show two.
				const lead0 = (n.rows || [])[0];
				const negd = this._qbNodeNegged(n);
				const handDown = lead0 && this._qbKind(lead0) === "group"
					&& !negd && !this._qbNodeNegged(lead0);
				// The row owns its group's FIRST box, so the fold control lives
				// there instead of in the box's gutter (his ask — one control per
				// row, and the box gets its 30px gutter back).
				const lead1 = (n.rows || [])[0];
				// (A saved row folds with its own button, so it cannot lead a fold.)
				const foldable = !!lead1 && this._qbKind(lead1) !== "group" && this._qbKind(lead1) !== "saved";
				// (A saved search's own level is laid out like the root's: its row
				// above already heads it, so its first group gets no header.)
				if (!handDown && (pend || i > 0 || negd || (path !== "" && !asRoot))) {
					const hd = this._qbJoinRowEl(group, i, p, pend, foldable
						? { key: lead1, group: n, folded: !!(this._qb.folds && this._qb.folds.has(lead1)) }
						: null);
					hd.classList.add("qb-depth-" + Math.min(depth, 3));
					container.appendChild(hd);
					pend = null;                     // a carried joiner is shown once
					this._qbGroupInto(container, n, p, depth + 1, null, foldable);
				} else {
					this._qbGroupInto(container, n, p, depth + 1,
						handDown ? (pend || { group, index: i, node: n }) : null);
					if (handDown) pend = null;
				}
				box = null;
				i++;
				continue;
			}
			// A saved search is ONE row in its level's box. Folded out, its own rows
			// follow indented one step under it, and the level carries on in a new
			// box after them: the shape of a group, minus the header row, because
			// the saved row IS its header.
			if (this._qbKind(n) === "saved") {
				if (!box) newBox();
				box.appendChild(this._qbSavedEl(n, i, p, group));
				if (n.open) {
					savedBox = box;
					const kids = document.createElement("div");
					kids.className = "qb-savedkids";
					kids.style.marginLeft = (14 * (Math.min(Math.max(0, depth - 1), 3) + 1)) + "px";
					container.appendChild(kids);
					this._qbGroupInto(kids, n, p, 0, null, false, true);
					box = null;
				}
				i++;
				continue;
			}
			if (!box) {
				// A run of plain rows is ONE visual box — the unit that folds
				// (his correction: every group gets its OWN collapsed line, the
				// root's box included, nothing merged into a parent). Fold state
				// keys on the run's first NODE, so it survives rebuilds and
				// moves, and dies with the session.
				// The group's FIRST run is now folded from its header ROW, which
				// then IS the collapsed group; only runs with no row of their own
				// (the root's box, a run trailing a nested group) fold in place.
				const owned = i === 0 && headRun;
				if (this._qb.folds && this._qb.folds.has(n)) {
					let k = i;
					while (k < rows.length && !this._qbBreaksBox(rows[k])) k++;
					if (!owned) {
						const fr = this._qbFoldedRunEl(group, i, k, path);
						fr.classList.add("qb-depth-" + Math.min(Math.max(0, depth - 1), 3));
						container.appendChild(fr);
					}
					i = k;
					continue;
				}
				newBox();
				// A box whose header ROW carries the fold control gets no chevron of
				// its own — but it keeps the same right gutter, because that gutter is
				// what puts every trash on one vertical line.
				if (!owned) {
					const chev = document.createElement("span");
					chev.className = "qb-boxfold ti ti-chevron-down";
					chev.setAttribute("title", "Collapse this group");
					const first = n;
					chev.addEventListener("click", (e) => {
						e.stopPropagation();
						(this._qb.folds || (this._qb.folds = new Set())).add(first);
						this._qbBuild();
					});
					box.appendChild(chev);
				}
			}
			if (isKw(n)) {
				// Consecutive keyword conditions render as ONE horizontal strip —
				// they are words, not field-operator-value triples, and a row per
				// word made the common live query four rows tall (his design).
				let j = i;
				while (j < rows.length && isKw(rows[j])) j++;
				box.appendChild(this._qbStripEl(rows.slice(i, j), i, path, group));
				i = j;
				continue;
			}
			box.appendChild(this._qbNodeEl(n, i, p, depth, group));
			i++;
		}
		if (actionsPlaced) return;
		// The level's buttons live in its own box, when it has one — and only there.
		// A level that ends on a folded-out saved search keeps them in that row's box.
		if (box || savedBox) (box || savedBox).appendChild(this._qbActionsEl(group, depth));
	}

	_qbActionsEl(group, depth, wrapFrom) {
		const actions = document.createElement("div");
		actions.className = "qb-actions";
		const add = document.createElement("button");
		add.className = "qb-add";
		add.innerHTML = '<span class="ti ti-plus"></span>Add condition';
		add.addEventListener("click", (e) => { e.stopPropagation(); this._qbAddRow(group); this._qbBuild(); this._qbApply(); });
		actions.appendChild(add);
		// The third button (his ask): wrap everything BELOW this box into one
		// group — the one-click fix when OR-branches must join Page (or any
		// head) as a UNIT. Only shown when something actually follows.
		const restRows = (group.rows || []).slice(wrapFrom == null ? 0 : wrapFrom);
		const alreadyStacked = restRows.length === 1 && this._qbKind(restRows[0]) === "group";
		if (wrapFrom != null && wrapFrom > 0 && restRows.length >= 1 && !alreadyStacked && depth < Plugin.QB_MAX_DEPTH) {
			const wb = document.createElement("button");
			wb.className = "qb-add";
			wb.innerHTML = '<span class="ti ti-plus"></span>Stack everything below';
			wb.setAttribute("title", "Stack everything below this box into ONE group, so it joins as a unit — Page AND (A OR B OR C)");
			wb.addEventListener("click", (e) => {
				e.stopPropagation();
				this._qbWrapBelow(group, wrapFrom);
				this._qbBuild(); this._qbApply();
			});
			actions.appendChild(wb);
		}
		// Nesting is capped: the parser stops splitting at the same depth, so what the
		// UI can build and what it can read back stay the same shape.
		if (depth < Plugin.QB_MAX_DEPTH) {
			const addg = document.createElement("button");
			addg.className = "qb-add";
			addg.innerHTML = '<span class="ti ti-plus"></span>Add condition group';
			addg.setAttribute("title", "A group is evaluated as a unit, so it can use the other joiner — A AND (B OR C)");
			addg.addEventListener("click", (e) => { e.stopPropagation(); this._qbAddGroup(group); this._qbBuild(); this._qbApply(); });
			actions.appendChild(addg);
		}
		// A saved search joins the query as one row, from the same library the
		// bookmark opens. Root level only, and never on a live query (a block has no
		// collection to file searches under).
		if (this._qb && group === this._qb.model && !this._qb.block) {
			const adds = document.createElement("button");
			adds.className = "qb-add";
			adds.innerHTML = '<span class="ti ti-plus"></span>Add saved search';
			adds.addEventListener("click", (e) => {
				e.stopPropagation();
				const rows = group.rows;
				const at = rows.findIndex((n) => this._qbKind(n) === "group");
				const node = { kind: "saved", sid: null, title: "", query: "", rows: [], open: false, neg: false, j: "AND" };
				if (at < 0) rows.push(node); else rows.splice(at, 0, node);
				this._qbBuild();
				this._qbOpenLibraryAt(this._qbFindPath(node));
			});
			actions.appendChild(adds);
		}
		return actions;
	}

	// The divider between a level's box and one of its groups: the joiner on the
	// left, on the same grid as every other row's lead, and the group's controls
	// on the right — move up / move down (the whole group steps among its
	// siblings; his ask, "flytta grupper upp och ner") and delete. Order within
	// a level is free: one joiner per level, and AND/OR are commutative, so a
	// move never changes what the query matches. The FIRST group has no divider
	// — moving the second one up is the same move.
	_qbJoinRowEl(group, i, path, carry, fold) {
		const node = (group.rows || [])[i];
		const wrap = document.createElement("div");
		wrap.className = "qb-joinrow";
		wrap.setAttribute("data-row", path);
		// Click anywhere non-control on the header: select/deselect the group
		// (controls stop propagation themselves).
		wrap.addEventListener("click", (e) => { e.stopPropagation(); this._qbSelect(node); });
		// The lead speaks for whoever owns the joiner in this slot: normally
		// this group, or — on a row that took over a stack's joiner — the STACK,
		// which has no row of its own. Passing the stack's own (group, index)
		// keeps every rule intact, including "a stack that leads the query has
		// no joiner to show".
		wrap.appendChild(carry
			? this._qbLeadEl(carry.group, carry.index, true, carry.node)
			: this._qbLeadEl(group, i, true, node));
		// The fold control is the LAST thing on the row, past the trash, in a
		// column of its own with a background behind it (his call — beside the
		// joiner it crowded the AND, and bare among the arrows it read as one
		// more direction). Its column lines up with the in-box chevron of every
		// box that has no row, so all fold buttons sit on ONE vertical line.
		// A folded group IS this row: its box is not rendered, and the row
		// wears the compiled text instead.
		let foldEl = null;
		if (fold) {
			const rows = (fold.group.rows || []);
			let k = 0;
			while (k < rows.length && this._qbKind(rows[k]) !== "group") k++;
			const q = this._qbGroupQuery({ join: "AND", rows: rows.slice(0, k) }) || "Empty group";
			const flip = (e) => {
				e.stopPropagation();
				const set = this._qb.folds || (this._qb.folds = new Set());
				if (set.has(fold.key)) set.delete(fold.key); else set.add(fold.key);
				this._qbBuild();
			};
			foldEl = document.createElement("span");
			foldEl.className = "qb-rowfold ti " + (fold.folded ? "ti-chevron-right" : "ti-chevron-down");
			foldEl.setAttribute("title", fold.folded ? "Expand this group" : "Collapse this group");
			foldEl.addEventListener("click", flip);
			if (fold.folded) {
				const sum = document.createElement("div");
				sum.className = "qb-foldsum";
				sum.textContent = q;
				sum.setAttribute("title", q);
				sum.addEventListener("click", flip);
				wrap.appendChild(sum);
			}
		}
		wrap._qbFold = foldEl;               // appended last, after the trash
		const fill = document.createElement("div");
		fill.className = "qb-joinrow-fill";
		wrap.appendChild(fill);
		// The group's drag grip is GONE (his call: the arrows already move a
		// group up, down, in and out — "pilarna gör ju jobbet redan"). Its slot
		// holds DUPLICATE instead: a deep copy of the group, spliced in directly
		// below, so a branch can be rebuilt for another collection by changing
		// one picker instead of retyping every row.
		const dup = document.createElement("span");
		dup.className = "qb-del ti ti-copy";
		dup.setAttribute("title", "Duplicate this group below");
		dup.addEventListener("click", (e) => {
			e.stopPropagation();
			const at = this._qbAt(path);
			if (!at || at.index < 0) return;
			const copy = JSON.parse(JSON.stringify(at.parent.rows[at.index]));
			at.parent.rows.splice(at.index + 1, 0, copy);
			this._qbBuild(); this._qbApply();
		});
		wrap.appendChild(dup);
		// Indent/outdent sit NEXT TO the reorder arrows, and ONLY there (his
		// call — arrows on the boxes read as duplicate controls for the same
		// unit). His rules, verbatim in effect:
		// - OUTDENT shows for EVERY group that sits inside another one, first
		//   child included ("första gruppen i en stack … ska kunna gå
		//   outdenta, så den pilen måste finnas"). Root-level groups have
		//   nowhere to go, so no arrow.
		// - INDENT shows when the sibling directly above is a GROUP — that is
		//   the group it becomes a child of ("indentera ytterligare en gång
		//   under den grupp som finns ovanför de"). A first child has no
		//   group above it, so it cannot indent again ("kan bara indenteras
		//   en gång, efter kan man bara vara child till parent"), and
		//   in-place wrapping stays dead.
		const seg = String(path).split(".");
		const at0 = this._qbAt(path);
		const prev0 = at0 && at0.index > 0 ? at0.parent.rows[at0.index - 1] : null;
		const move = (dir, icon, title) => {
			const b = document.createElement("span");
			b.className = "qb-del ti " + icon;
			b.setAttribute("title", title);
			b.addEventListener("click", (e) => { e.stopPropagation(); this._qbIndentGroup(node, dir); });
			wrap.appendChild(b);
		};
		if (seg.length > 1)
			move(-1, "ti-indent-decrease", "Un-indent this group — move it out one level");
		if (prev0 && this._qbKind(prev0) === "group" && seg.length <= Plugin.QB_MAX_DEPTH)
			move(1, "ti-indent-increase", "Indent this group — into the group above it");
		const mv = (delta, title, icon) => {
			const b = document.createElement("span");
			b.className = "qb-del ti " + icon;
			b.setAttribute("title", title);
			b.addEventListener("click", (e) => {
				e.stopPropagation();
				const at = this._qbAt(path);
				if (!at || at.index < 0) return;
				const to = at.index + delta;
				if (to < 0 || to >= at.parent.rows.length) return;
				const r = at.parent.rows.splice(at.index, 1)[0];
				at.parent.rows.splice(to, 0, r);
				this._qbBuild(); this._qbApply();
			});
			return b;
		};
		// Reorder arrows and trash need a reason to be there: an ONLY CHILD has
		// nothing to reorder against, and a FIRST child's row exists only to
		// carry its un-indent arrow — putting ↑↓🗑 back on it would rebuild
		// exactly the strip he had removed ("varken pilar eller papperskorg
		// behövs"). Deleting a first group is its rows' trashes; moving it is
		// the next group's up-arrow.
		// A row that carries a joiner is a full header and gets the reorder
		// arrows and the trash. The only row that does not is the leftover case
		// where a NEGATED stack keeps its own NOT row and its first child still
		// needs an un-indent arrow: that one is slim and arrow-only.
		const full = !!carry || i > 0 || this._qbNodeNegged(node);
		if ((group.rows || []).length > 1 && full) {
			wrap.appendChild(mv(-1, "Move this group up", "ti-arrow-up"));
			wrap.appendChild(mv(1, "Move this group down", "ti-arrow-down"));
			wrap.appendChild(this._qbDelEl(path, "Remove this group"));
		} else if (!full) {
			wrap.classList.add("qb-joinrow-bare");   // arrow-only: slim, tight to its box
		} else {
			// No trash on this row, but the fold column must stay a column.
			const gap = document.createElement("span");
			gap.className = "qb-del qb-del-gap";
			wrap.appendChild(gap);
		}
		if (wrap._qbFold) wrap.appendChild(wrap._qbFold);
		return wrap;
	}

	// The lead column IS the whole joiner-and-negation UI (his call, 2026-08-14
	// round 3 — "AND implicit, OR/NOT är det som kvarstår i en condition"):
	// row 1 says "Show", every later row carries the level's joiner. AND is
	// drawn QUIET (it is the implicit default), OR spelled out, and NOT in red
	// means THIS row (or group) is excluded. Picking AND/OR sets the level's
	// one joiner and un-negates the row; picking NOT negates the row and
	// leaves the joiner alone — the same semantics the strip's gaps have
	// always had. No pills anywhere: an unlit NOT pill on every row read as
	// noise ("omarkerade NOT är vilseledande").
	_qbLeadEl(group, i, divider, node, rowPath) {
		const lead = document.createElement("div");
		lead.className = "qb-lead";
		// The joiner belongs to the ROW (node.j): every row from the second says
		// how it joins the one above, and rows in one box mix AND/OR freely (his
		// call — no level flip, no auto-grouping; that experiment lasted an hour).
		const JOIN = node ? String(node.j || "AND").toUpperCase() : (group.join || "AND").toUpperCase();
		const word = (t) => {
			const s = document.createElement("span");
			s.className = "qb-leadtxt";
			s.textContent = t;
			lead.appendChild(s);
		};
		const negged = node ? this._qbNodeNegged(node) : false;
		// The menus get a width of their own: matched to the control they were
		// one truncated letter per word ("A O N" — his report).
		const trig = (label, cls, items, cur, onPick) => {
			const jt = this._qbTrigger("qb-join " + cls, label, "", (btn) => {
				this._qbMenu(btn, items, cur, onPick, { dark: true, dots: false, width: 68 });
			});
			lead.appendChild(jt);
		};
		if (i === 0) {
			// A divider at i=0 only renders when the group is NEGATED (the red
			// NOT must show); positive first groups have no header at all — the
			// depth indent already says "group" (his call, round 21 review).
			if (divider && !negged) return lead;
			// The QUERY's leading row reads "Show", a plain word: a query's goal
			// is always to see something (his logic). But only THAT row — the
			// first row of every later box takes the Show/NOT picker, or a group
			// like (… AND NOT (…)) cannot be built when the negation leads its
			// box (his 2026-08-14 example). A parsed leading NOT still shows red
			// and revertable: the builder never hides what a query does.
			const leadRow = !divider && /^0(\.0)*$/.test(String(rowPath == null ? "" : rowPath));
			if (!node || (!negged && leadRow)) { if (!divider) word("Show"); return lead; }
			trig(negged ? "NOT" : "Show", "qb-join-lead" + (negged ? " qb-join-not" : ""),
				[{ v: "SHOW", label: "Show" }, { v: "NOT", label: "NOT" }], negged ? "NOT" : "SHOW",
				(v) => {
					if ((v === "NOT") !== negged) this._qbToggleNeg(node);
					this._qbBuild(); this._qbApply();
				});
			return lead;
		}
		if (!node) { word(JOIN); return lead; }   // nothing to edit without a row
		trig(negged ? "NOT" : JOIN, negged ? "qb-join-not" : "",
			[{ v: "AND", label: "AND" }, { v: "OR", label: "OR" }, { v: "NOT", label: "NOT" }], negged ? "NOT" : JOIN,
			(v) => {
				if (v === "NOT") { if (!negged) this._qbToggleNeg(node); }
				else { if (negged) this._qbToggleNeg(node); node.j = v; }
				this._qbBuild(); this._qbApply();
			});
		return lead;
	}

	_qbDelEl(path, title) {
		const del = document.createElement("span");
		del.className = "qb-del ti ti-trash";
		del.setAttribute("title", title || "Remove condition");
		del.addEventListener("click", (e) => { e.stopPropagation(); this._qbDelete(path); });
		return del;
	}

	// Groups never come through here — _qbGroupInto lays them out as boxes of their
	// own, so this only ever sees the two row kinds.
	_qbNodeEl(node, i, path, depth, parent) {
		if (this._qbKind(node) === "raw") return this._qbRawEl(node, i, path, parent);
		return this._qbCondEl(node, i, path, parent);
	}

	// A fragment the reader chose not to interpret, shown as a chip and carried
	// verbatim. Its × drops it and leaves the structured rows behind.
	_qbRawEl(node, i, path, parent) {
		const wrap = document.createElement("div");
		wrap.className = "qb-row";
		wrap.setAttribute("data-row", path);
		wrap.appendChild(this._qbLeadEl(parent, i, false, node, path));
		const chip = document.createElement("div");
		chip.className = "qb-base";
		chip.setAttribute("title", node.query);
		const lb = document.createElement("span");
		lb.className = "qb-base-label";
		lb.textContent = node.title || node.query;
		chip.appendChild(lb);
		const x = document.createElement("span");
		x.className = "qb-base-x ti ti-x";
		x.setAttribute("title", "Remove this part of the query");
		x.addEventListener("click", (e) => { e.stopPropagation(); this._qbDelete(path); });
		chip.appendChild(x);
		wrap.appendChild(chip);
		wrap.appendChild(this._qbGripEl(path, wrap));
		return wrap;
	}

	// A saved search as ONE row: its lead, a picker the width of the four value
	// columns (bookmark + name; the picker IS the saved-search library), the
	// trash, and its fold button in the column where condition rows keep their
	// grip. "edited" says the rows inside no longer match the saved text.
	_qbSavedEl(node, i, path, parent) {
		const wrap = document.createElement("div");
		wrap.className = "qb-row qb-savedrow";
		wrap.setAttribute("data-row", path);
		if (node.sid) wrap.setAttribute("data-sid", node.sid);
		wrap.appendChild(this._qbLeadEl(parent, i, false, node, path));
		const trig = this._qbTrigger("qb-saved", node.sid ? node.title : "", "Pick a saved search",
			(btn) => this._qbLibrary(btn, node));
		const ic = document.createElement("span");
		ic.className = "qb-saved-icon ti ti-bookmark";
		trig.insertBefore(ic, trig.firstChild);
		if (this._qbSavedEdited(node)) {
			const ed = document.createElement("span");
			ed.className = "qb-edited";
			ed.textContent = "edited";
			trig.insertBefore(ed, trig.querySelector(".qb-chev"));
		}
		wrap.appendChild(trig);
		wrap.appendChild(this._qbDelEl(path, "Remove this saved search"));
		if (node.sid) {
			const fold = document.createElement("span");
			fold.className = "qb-rowfold ti " + (node.open ? "ti-chevron-down" : "ti-chevron-right");
			fold.setAttribute("title", (node.open ? "Fold in " : "Fold out ") + node.title);
			fold.addEventListener("click", (e) => { e.stopPropagation(); node.open = !node.open; this._qbBuild(); });
			wrap.appendChild(fold);
		} else {
			const gap = document.createElement("span");
			gap.className = "qb-gripgap";
			wrap.appendChild(gap);
		}
		return wrap;
	}

	// Open the library on a saved row's picker, from code (a fresh row, the
	// bookmark on an empty field), after the build that drew it.
	_qbOpenLibraryAt(path) {
		const el = this._qbEl && this._qbEl.querySelector('.qb-row[data-row="' + path + '"] .qb-saved');
		if (el) el.click();
	}

	// ── The saved-search library ────────────────────────────────────────────
	// The saved row's dropdown, and the only place saved searches are browsed,
	// renamed, deleted and reordered (it replaced the bookmark's popup). Built
	// from Thymer's own picker markup like every other menu here, plus section
	// headers: this view, the whole collection, other views and other
	// collections, the last two folded until asked for. "New search" at the
	// bottom turns the row into an ordinary condition.
	_qbLibrary(anchor, node) {
		this._qbCloseMenu();
		anchor.classList.add("qb-open");
		this._qbFocusAfter = this._qbControlRef(anchor);
		const ctx = this._qb;
		const G = Plugin.GLOBAL_VIEW;
		const menu = document.createElement("div");
		menu.className = "cmdpal--inline active qb-menu qb-lib";
		menu.style.position = "fixed";
		menu.addEventListener("mousedown", (e) => e.stopPropagation());
		this._qbMenuEl = menu;

		const ic = document.createElement("div");
		ic.className = "cmdpal--inline-input-container";
		const irow = document.createElement("div");
		irow.className = "cmdpal--inline-input-row";
		const search = document.createElement("input");
		search.className = "cmdpal--inline-input";
		search.type = "text";
		search.spellcheck = false;
		search.placeholder = "Filter saved searches";
		search.addEventListener("keydown", (e) => {
			if (["ArrowDown", "ArrowUp", "Enter", "Escape"].indexOf(e.key) < 0) e.stopPropagation();
		});
		search.addEventListener("input", () => paint());
		irow.appendChild(search);
		ic.appendChild(irow);
		menu.appendChild(ic);

		const scroller = document.createElement("div");
		scroller.className = "autocomplete clickable qb-lib-scroll";
		const list = document.createElement("div");
		list.className = "vcontent";
		scroller.appendChild(list);
		menu.appendChild(scroller);

		const foot = document.createElement("div");
		foot.className = "qb-lib-foot";
		const newRow = document.createElement("div");
		newRow.className = "autocomplete--option qb-lib-new";
		newRow.innerHTML = '<span class="autocomplete--option-icon"><span class="ti ti-plus"></span></span>'
			+ '<span class="autocomplete--option-label">New search</span>';
		foot.appendChild(newRow);
		menu.appendChild(foot);

		const pick = (item) => {
			this._qbCloseMenu();
			const fresh = this._qbSavedNode(item, false);
			fresh.j = node.j; fresh.neg = node.neg;
			Object.keys(node).forEach((k) => delete node[k]);
			Object.assign(node, fresh);
			this._qbBuild(); this._qbApply();
		};
		const startNew = () => {
			this._qbCloseMenu();
			const path = this._qbFindPath(node);
			const at = path ? this._qbAt(path) : null;
			if (!at || at.index < 0) return;
			const row = this._qbNewRow();
			row.j = node.j || "AND";
			at.parent.rows[at.index] = row;
			this._qbBuild(); this._qbApply();
			const v = this._qbEl && this._qbEl.querySelector('.qb-row[data-row="' + path + '"] .qb-val, .qb-row[data-row="' + path + '"] .qb-val-sel');
			if (v) v.focus();
		};
		// Hover highlights for a MOUSE only. On a phone the browser sends an emulated
		// mouseenter before the click; highlighting then shows the row's actions, and
		// iOS takes that as a hover state and drops the click (two taps to pick).
		newRow.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") highlight(cells.indexOf(newRow), false); });
		newRow.addEventListener("click", (e) => { e.stopPropagation(); startNew(); });

		const folds = this._folds();
		const foldKey = (k) => "lib|" + ctx.col + "|" + k;
		const isOpen = (sec) => {
			const f = folds[foldKey(sec.key)];
			return f ? f === "open" : !sec.folded;
		};
		let cells = [], active = -1, renaming = null;
		const highlight = (i, scroll) => {
			if (!cells.length) return;
			active = (i + cells.length) % cells.length;
			cells.forEach((c, k) => c.classList.toggle("autocomplete--option-selected", k === active));
			if (scroll !== false && cells[active].scrollIntoView) cells[active].scrollIntoView({ block: "nearest" });
		};
		const icon = (cls) => { const s = document.createElement("span"); s.className = "ti " + cls; return s; };

		const paint = () => {
			const keepId = cells[active] && cells[active].getAttribute("data-id");
			const needle = (search.value || "").trim().toLowerCase();
			const all = this._items();
			const match = (s) => !needle || (s.title + " " + s.query).toLowerCase().indexOf(needle) >= 0;
			const mine = all.filter((s) => s.col === ctx.col && match(s));
			const secs = [];
			if (ctx.viewId !== G) secs.push({ key: "here", label: (ctx.viewName || "This") + " view", view: ctx.viewId, viewName: ctx.viewName || "",
				items: mine.filter((s) => s.viewId !== G && s.viewId === ctx.viewId) });
			secs.push({ key: "global", label: ctx.isTasks ? "All task views" : "Whole collection", view: G,
				items: mine.filter((s) => s.viewId === G) });
			secs.push({ key: "other", label: "Other views", view: "other", folded: true, sub: (s) => s.viewName || "",
				items: mine.filter((s) => s.viewId !== G && s.viewId !== ctx.viewId) });
			secs.push({ key: "cols", label: "Other collections", view: "cols", folded: true, sub: (s) => s.colName || "",
				items: all.filter((s) => s.col !== ctx.col && match(s)) });
			list.innerHTML = "";
			cells = [];
			const shown = secs.filter((s) => s.items.length);
			if (!shown.length) {
				const e = document.createElement("div");
				e.className = "qb-menu-empty";
				e.textContent = needle ? "No saved searches match" : "No saved searches yet";
				list.appendChild(e);
			}
			for (const sec of shown) {
				const open = needle ? true : isOpen(sec);
				const h = document.createElement("div");
				h.className = "qb-lib-sec" + (open ? "" : " qb-lib-sec-folded");
				h.appendChild(icon(open ? "ti-chevron-down" : "ti-chevron-right"));
				const hl = document.createElement("span");
				hl.className = "qb-lib-sec-label";
				hl.textContent = sec.label;
				h.appendChild(hl);
				const hc = document.createElement("span");
				hc.className = "qb-lib-count";
				hc.textContent = sec.items.length;
				h.appendChild(hc);
				h.addEventListener("click", (e) => {
					e.stopPropagation();
					if (needle) return;
					folds[foldKey(sec.key)] = isOpen(sec) ? "closed" : "open";
					this._saveFolds(folds);
					paint();
				});
				list.appendChild(h);
				const g = document.createElement("div");
				g.className = "qb-lib-group";
				g.setAttribute("data-view", sec.view);
				if (sec.viewName) g.setAttribute("data-viewname", sec.viewName);
				list.appendChild(g);
				if (!open) continue;
				for (const s of sec.items) {
					const row = document.createElement("div");
					row.className = "autocomplete--option qb-lib-item";
					row.setAttribute("data-id", s.id);
					const ri = document.createElement("span");
					ri.className = "autocomplete--option-icon qb-lib-icon";
					ri.appendChild(icon("ti-bookmark"));
					row.appendChild(ri);
					if (renaming === s.id) {
						const inp = document.createElement("input");
						inp.className = "qb-lib-rename";
						inp.type = "text";
						inp.value = s.title;
						inp.addEventListener("mousedown", (e) => e.stopPropagation());
						inp.addEventListener("click", (e) => e.stopPropagation());
						inp.addEventListener("keydown", (e) => {
							e.stopPropagation();
							if (e.key === "Enter") {
								e.preventDefault();
								const t = inp.value.trim();
								if (t && t !== s.title) {
									s.title = t;
									this._qbRetitle(s.id, t);
									this._touch();
								}
								renaming = null; paint(); search.focus();
							} else if (e.key === "Escape") { e.preventDefault(); renaming = null; paint(); search.focus(); }
						});
						row.appendChild(inp);
						setTimeout(() => { inp.focus(); inp.select(); }, 0);
					} else {
						const lb = document.createElement("span");
						lb.className = "autocomplete--option-label";
						lb.textContent = s.title;
						row.appendChild(lb);
						const subText = sec.sub ? sec.sub(s) : "";
						if (subText) {
							const sb = document.createElement("span");
							sb.className = "qb-lib-sub";
							sb.textContent = subText;
							row.appendChild(sb);
						}
						const act = (cls, title, fn) => {
							const b = document.createElement("span");
							b.className = "qb-lib-act ti " + cls;
							b.setAttribute("title", title);
							b.addEventListener("mousedown", (e) => e.stopPropagation());
							b.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
							row.appendChild(b);
						};
						act("ti-pencil", "Rename " + s.title, () => { renaming = s.id; paint(); });
						act("ti-trash", "Delete " + s.title, () => {
							const items = this._items();
							const at = items.findIndex((x) => x.id === s.id);
							if (at >= 0) items.splice(at, 1);
							this._touch();
							paint();
						});
						// Reordering is for this collection's own sections; a filter
						// shows a partial list, so the grip waits until it is cleared.
						const grip = document.createElement("span");
						grip.className = "qb-lib-grip ti ti-grip-vertical";
						if (sec.key === "cols" || needle) grip.classList.add("qb-lib-grip-off");
						else {
							grip.setAttribute("title", "Drag to reorder");
							grip.addEventListener("pointerdown", (e) => this._qbLibDrag(e, row, list, () => paint()));
						}
						row.appendChild(grip);
					}
					row.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") highlight(cells.indexOf(row), false); });
					row.addEventListener("click", (e) => {
						e.stopPropagation();
						if (renaming || Date.now() < (this._suppressClickUntil || 0)) return;
						pick(s);
					});
					g.appendChild(row);
					cells.push(row);
				}
			}
			cells.push(newRow);
			const at = cells.findIndex((c) => c.getAttribute("data-id") === (keepId || node.sid || ""));
			highlight(at >= 0 ? at : 0, false);
		};
		paint();

		const onKey = (e) => {
			if (!this._qbMenuEl || renaming) return;
			if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); highlight(active + 1); }
			else if (e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); highlight(active - 1); }
			else if (e.key === "Enter") {
				if (active < 0 || !cells[active]) return;
				e.preventDefault(); e.stopPropagation();
				cells[active].dispatchEvent(new MouseEvent("click", { bubbles: true }));
			} else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this._qbCloseMenu(); }
		};
		this._qbMenuKey = onKey;
		document.addEventListener("keydown", onKey, true);

		document.body.appendChild(menu);
		const r = anchor.getBoundingClientRect();
		const M = 8;
		menu.style.width = Math.max(r.width, 320) + "px";
		menu.style.maxWidth = "calc(100vw - 20px)";
		const below = window.innerHeight - r.bottom - 4 - M;
		const above = r.top - 4 - M;
		const room = Math.max(below, above);
		// The list takes what the screen has, up to the native 350px plus room
		// for the section headers.
		scroller.style.maxHeight = Math.max(120, Math.min(420, room - (menu.offsetHeight - scroller.offsetHeight))) + "px";
		const h = menu.offsetHeight;
		menu.style.left = Math.max(M, Math.min(r.left, window.innerWidth - menu.offsetWidth - M)) + "px";
		menu.style.top = (h <= below || below >= above ? r.bottom + 4 : Math.max(M, r.top - 4 - h)) + "px";
		search.focus();

		this._qbMenuOutside = (e) => {
			if (menu.contains(e.target) || anchor.contains(e.target)) return;
			this._qbCloseMenu();
		};
		document.addEventListener("mousedown", this._qbMenuOutside, true);
	}

	// A rename reaches every row in the builder that holds that search.
	_qbRetitle(sid, title) {
		const walk = (g) => (g.rows || []).forEach((n) => {
			if (this._qbKind(n) === "saved" && n.sid === sid) n.title = title;
			if (this._qbHasRows(n)) walk(n);
		});
		if (this._qb && this._qb.model) walk(this._qb.model);
		// The panel is not rebuilt while the library is open, so its rows are
		// relabelled in place.
		if (this._qbEl) this._qbEl.querySelectorAll('.qb-savedrow[data-sid="' + sid + '"] .qb-saved .qb-sel-label')
			.forEach((l) => { l.textContent = title; });
	}

	// Drag a saved search within the library, the way the old popup did: inside
	// its section to reorder, into this view's section or "Whole collection" to
	// move it there. "Other views" only reorders what is already in it.
	_qbLibDrag(e, row, list, repaint) {
		if (e.button != null && e.button !== 0) return;
		e.preventDefault(); e.stopPropagation();
		const line = document.createElement("div");
		line.className = "qb-lib-dropline";
		let moved = false, target = null;
		row.classList.add("qb-lib-dragging");
		const groups = [...list.querySelectorAll('.qb-lib-group:not([data-view="cols"])')];
		const onMove = (ev) => {
			const y = ev.clientY;
			let g = groups.find((gr) => {
				const prev = gr.previousElementSibling;
				const top = (prev || gr).getBoundingClientRect().top;
				return y >= top && y <= gr.getBoundingClientRect().bottom;
			});
			if (!g) return;
			target = g;
			const others = [...g.querySelectorAll(".qb-lib-item")].filter((r) => r !== row);
			const before = others.find((r) => { const rc = r.getBoundingClientRect(); return y < rc.top + rc.height / 2; });
			if (before) g.insertBefore(line, before); else g.appendChild(line);
			moved = true;
		};
		const onUp = () => {
			document.removeEventListener("pointermove", onMove, true);
			document.removeEventListener("pointerup", onUp, true);
			row.classList.remove("qb-lib-dragging");
			if (moved && target && line.parentNode) line.parentNode.insertBefore(row, line);
			line.remove();
			if (!moved || !target) { repaint(); return; }
			this._suppressClickUntil = Date.now() + 350;
			const items = this._items();
			const item = items.find((x) => x.id === row.getAttribute("data-id"));
			const tv = target.getAttribute("data-view");
			const G = Plugin.GLOBAL_VIEW;
			if (item && tv !== "other" && tv !== item.viewId) {
				if (tv === G) { item.viewId = G; item.viewName = ""; }
				else { item.viewId = tv; item.viewName = target.getAttribute("data-viewname") || ""; }
			}
			if (item && (tv !== "other" || (item.viewId !== G && item.viewId !== this._qb.viewId))) {
				// Permute only the slots these items already hold, so other views and
				// collections keep their order.
				const ids = [...target.querySelectorAll(".qb-lib-item")].map((r) => r.getAttribute("data-id"));
				const byId = {};
				items.forEach((it) => { byId[it.id] = it; });
				const pos = [];
				items.forEach((it, i) => { if (ids.indexOf(it.id) >= 0) pos.push(i); });
				ids.forEach((id, k) => { if (byId[id]) items[pos[k]] = byId[id]; });
				this._touch();
			}
			repaint();
		};
		document.addEventListener("pointermove", onMove, true);
		document.addEventListener("pointerup", onUp, true);
	}

	// A run of keyword conditions, drawn as one horizontal strip: chips in the
	// same shell as every other picker cell, the level's joiner in the gaps (NOT in
	// red, meaning "and not" exactly as in the popup's combine strip), a [+] that
	// opens the same first menu — where picking a collection drops to its own row —
	// and one trash for the whole strip. Chips get an × on hover. Pure rendering:
	// the model still holds one condition per keyword.
	_qbStripEl(run, start, path, group) {
		const wrap = document.createElement("div");
		wrap.className = "qb-row qb-striprow";
		wrap.setAttribute("data-row", this._qbPath(path, start));
		// The lead is wired to the strip's FIRST chip: its joiner to the row
		// above, or Show/NOT when the strip opens its level.
		wrap.appendChild(this._qbLeadEl(group, start, false, run[0], this._qbPath(path, start)));
		const strip = document.createElement("div");
		strip.className = "qb-strip";
		wrap.appendChild(strip);
		// Chips are keyword UI in every mode — their menu always leads with the
		// keywords, wherever the builder itself is anchored.
		const sm = this._qbSrcItems("kw");
		// The "Collection property…" door, from a chip or the [+]: the chip's own
		// row converts (dropping out of the strip), the [+] adds a fresh one.
		const toColRow = (row, rowPath) => {
			row.colPick = true;
			row.src = ""; row.field = ""; row.type = "plaintext"; row.op = "="; row.value = "";
			this._qbBuild();
			this._qbOpenSrcMenuAt(rowPath);
		};

		run.forEach((row, k) => {
			const idx = start + k;
			if (k > 0) {
				// The gap before a chip carries THAT CHIP's own joiner (per-row j),
				// or its red NOT. The first chip has no gap — the row's lead is its
				// joiner and its NOT.
				const neg = row.op === "!=";
				const cj = String(row.j || "AND").toUpperCase();
				const gapLabel = neg ? "NOT" : cj;
				const gap = this._qbTrigger("qb-gap" + (neg ? " qb-gap-not" : ""), gapLabel, "", (btn) => {
					this._qbMenu(btn, [
						{ v: "AND", label: "AND" }, { v: "OR", label: "OR" }, { v: "NOT", label: "NOT" },
					], neg ? "NOT" : cj, (v) => {
						if (v === "NOT") row.op = "!=";
						else { row.op = "="; row.j = v; }
						this._qbBuild(); this._qbApply();
					}, { dark: true, dots: false, width: 68 });
				});
				strip.appendChild(gap);
			}
			const bf = Plugin.QB_BUILTINS.find((x) => x.label === row.field);
			const cur = bf && (bf.choices || []).find((c) => c.label === row.value);
			const chip = this._qbTrigger("qb-kwchip", cur ? cur.label : "", "Keyword", (btn) => {
				this._qbMenu(btn, sm.items, cur ? "kw|" + row.field + "|" + row.value : "",
					(v) => {
						if (v === "__col") { toColRow(row, this._qbPath(path, idx)); return; }
						this._qbApplySrcPick(row, v); this._qbBuild(); this._qbApply();
					}, sm.cfg);
			});
			const x = document.createElement("span");
			x.className = "qb-kwx ti ti-x";
			x.setAttribute("title", "Remove");
			x.addEventListener("click", (e) => { e.stopPropagation(); this._qbDelete(this._qbPath(path, idx)); });
			chip.appendChild(x);
			strip.appendChild(chip);
		});

		// After the last chip comes the [+] directly — no trailing joiner control
		// (his call, 2026-08-14: "skip AND/OR/NOT after them"). The joiner lives
		// in the GAPS: AND/OR on any gap sets the level's, NOT negates the chip
		// after that gap. A chip added with [+] joins on the level's joiner and
		// the new gap in front of it is where you flip it to NOT.
		// [+] — continue the flow: a keyword joins the strip, a collection drops
		// to its own row right after it.
		const add = this._qbTrigger("qb-stripadd", "", "+", (btn) => {
			this._qbMenu(btn, sm.items, "", (v) => {
				const row = { kind: "cond", src: "", field: "", type: "plaintext", op: "=", value: "", j: "AND" };
				const rowPath = this._qbPath(path, start + run.length);
				if (v === "__col") {
					row.colPick = true;
					group.rows.splice(start + run.length, 0, row);
					this._qbBuild();
					this._qbOpenSrcMenuAt(rowPath);
					return;
				}
				this._qbApplySrcPick(row, v);
				group.rows.splice(start + run.length, 0, row);
				this._qbBuild(); this._qbApply();
			}, sm.cfg);
		});
		const addLb = add.querySelector(".qb-sel-label");
		addLb.textContent = "+";
		addLb.classList.remove("qb-placeholder");   // it is a control, not an empty value
		add.querySelector(".qb-chev").remove();
		strip.appendChild(add);

		const del = document.createElement("span");
		del.className = "qb-del ti ti-trash";
		del.setAttribute("title", "Remove these keywords");
		del.addEventListener("click", (e) => {
			e.stopPropagation();
			group.rows.splice(start, run.length);
			this._qbPrune();
			if (!this._qb.model.rows.length) this._qbAddRow();
			this._qbBuild(); this._qbApply();
		});
		wrap.appendChild(del);
		const gap = document.createElement("span");
		gap.className = "qb-gripgap";        // keeps this row's trash in the column
		wrap.appendChild(gap);
		return wrap;
	}

	// The first menu's content and its pick-handling, shared by the condition
	// row's first cell, every keyword chip, and the strip's [+].
	//
	// In a LIVE QUERY the first pick is always a built-in (his call: "första är
	// alltid att man väljer ur built in items") — mode "kw" lists the keywords
	// first; the collections live behind the "Collection property…" door (his
	// daily queries filter collection properties WITHOUT @Page: `@todo AND
	// @Actions.…`) and lead the menu once @Page is in the model (colfirst).
	// The Page AUTO-SPAWN of a collection row is REMOVED (his call: no rows he
	// did not ask for — Add condition / Add condition group do the adding).
	// Mode "col" is a collection row's own menu: the collections, nothing else.
	// Collection and dynamic views keep their original lists untouched.
	_qbSrcItems(mode) {
		const cols = this._qb.sources || this._qbCols || [];
		if (mode === "col") {
			return {
				items: cols.map((c) => ({ v: c.name, label: c.name, icon: c.icon })),
				cfg: { search: true, searchPlaceholder: "Search Collections ..." },
			};
		}
		const anyOpt = { v: Plugin.ANY_ITEM, label: Plugin.ANY_ITEM, icon: "ti-point" };
		const kwItems = [];
		for (const bf of Plugin.QB_BUILTINS) {
			for (const c of (bf.choices || [])) {
				// `alt` makes the KEYWORD itself searchable: "inprog" is not a
				// substring of "Work in progress", but it is one of @inprogress.
				kwItems.push({ v: "kw|" + bf.label + "|" + c.label, label: c.label, icon: c.icon || "", alt: c.kw });
			}
		}
		let items;
		if (mode === "colfirst") {
			// The query already says @Page, so a fresh row is almost always the
			// narrowing question — WHICH pages — wherever it was added, a
			// spawned row or a new group (his call: "när det är Pages AND vill
			// man alltid ha något som har med pages att göra"). Collections
			// lead; the keywords stay below, searchable as ever; the door is
			// redundant here.
			const colItems = cols.map((c) => ({ v: c.name, label: c.name, icon: c.icon }));
			const kw = this._qbSrcItems("kw");
			return { items: colItems.concat(kw.items.filter((x) => x.v !== "__col")), cfg: kw.cfg };
		}
		if (mode === "kw") {
			// The keyed built-ins (Hashtag, Due, Created by, …) are first-class
			// picks here too — "det som står i andra kolumnen är ju också built
			// in" — each opens as a row wearing its own name, value beside it.
			// The tail differs per context: a live query gets the collection
			// door, a collection view gets its own collection (a strip's [+]
			// can still drop to a property row there).
			const bfItems = [];
			for (const bf of Plugin.QB_BUILTINS) {
				if (bf.choices) continue;      // the keyword families are listed by VALUE above
				bfItems.push({ v: "bf|" + bf.label, label: bf.label, icon: bf.icon || "", alt: bf.key || "" });
			}
			let tail;
			if (this._qb.block) tail = [anyOpt, { v: "__col", label: "Collection property…", icon: "ti-folders" }];
			else if (this._qb.lockSrc) {
				const name = this._qb.defaultSrc;
				const cc = cols.find((c) => c.name === name);
				tail = [{ v: name, label: name, icon: cc ? cc.icon : "" }, anyOpt];
			} else tail = [anyOpt].concat(cols.map((c) => ({ v: c.name, label: c.name, icon: c.icon })));
			items = kwItems.concat(bfItems, tail);
		} else if (this._qb.lockSrc) {
			// Collection views' CONDITION rows: the collection and Any item, and
			// nothing else — the keyword flood belongs to the live-query builder
			// (his call: the two builders stay separated; keywords are reached
			// through Any item's field list here).
			const name = this._qb.defaultSrc;
			const cc = cols.find((c) => c.name === name);
			items = [{ v: name, label: name, icon: cc ? cc.icon : "" }, anyOpt];
		} else {
			items = [anyOpt].concat(cols.map((c) => ({ v: c.name, label: c.name, icon: c.icon })));
		}
		return { items, cfg: { search: true, searchPlaceholder: "Search or type a keyword ..." } };
	}

	_qbOpenSrcMenuAt(path) {
		const el = this._qbEl && this._qbEl.querySelector('.qb-row[data-row="' + path + '"] .qb-src');
		if (el) el.click();
	}

	// Does the model already ask for pages? Then fresh rows lead with the
	// collections (mode "colfirst") wherever they are added.
	_qbModelHasPage() {
		if (!this._qb) return false;
		const walk = (n) => {
			if (this._qbKind(n) === "group") return (n.rows || []).some(walk);
			return this._qbKind(n) === "cond" && n.src === Plugin.ANY_ITEM
				&& n.type === "bi-kw" && n.field === "Type" && n.value === "Page" && n.op === "=";
		};
		return walk(this._qb.model || {});
	}

	// Write a first-menu pick into a condition row (no rebuild — callers do that).
	// `anyPick` marks the one case that keeps the three-column browse row: an
	// EXPLICIT "Any item" pick. A keyed built-in picked directly (bf|…) renders
	// compact, wearing its field name in the first cell.
	_qbApplySrcPick(row, v) {
		if (String(v).indexOf("kw|") === 0) {
			const parts = String(v).split("|");
			const bf = Plugin.QB_BUILTINS.find((x) => x.label === parts[1]);
			row.src = Plugin.ANY_ITEM;
			row.field = parts[1];
			row.type = bf ? bf.type : "bi-kw";
			row.op = "=";
			row.value = parts.slice(2).join("|");
			delete row.anyPick;
			return;
		}
		if (String(v).indexOf("bf|") === 0) {
			const bf = Plugin.QB_BUILTINS.find((x) => x.label === String(v).slice(3));
			row.src = Plugin.ANY_ITEM;
			row.field = bf ? bf.label : "";
			row.type = bf ? bf.type : "plaintext";
			row.op = bf ? this._qbOpsFor(bf.type)[0].v : "=";
			row.value = "";
			delete row.anyPick;
			return;
		}
		row.src = v;
		// Swapping the COLLECTION keeps the field, the operator and the value
		// when the new collection has a field of the same name and type — his
		// duplicate workflow: copy a branch, change one picker, done. When the
		// field does not exist there, the row resets to that collection's first
		// field ("har de inte det så behöver de nollställas vid ändring").
		const fields = this._qbFieldsFor(v);
		const same = row.field && fields.find((x) => x.label === row.field && x.type === row.type);
		if (same && v !== Plugin.ANY_ITEM) {
			delete row.anyPick;
			return;
		}
		const f = fields[0];
		row.field = f ? f.label : "";
		row.type = f ? f.type : "plaintext";
		row.op = f ? this._qbOpsFor(f.type)[0].v : "=";
		row.value = "";
		if (v === Plugin.ANY_ITEM) row.anyPick = true;
		else delete row.anyPick;
	}

	_qbCondEl(row, i, path, parent) {
		const wrap = document.createElement("div");
		wrap.className = "qb-row";
		wrap.setAttribute("data-row", path);
		wrap.appendChild(this._qbLeadEl(parent, i, false, row, path));

		// Source: a collection, or "Any item" — the built-in filters (@todo, dates,
		// hashtags…) that belong to no collection. In a normal collection the OTHER
		// collections are still withheld (his lock decision stands: their properties
		// could never match these rows) but Any item is offered, because @todo is as
		// meaningful inside a collection as anywhere. In a LIVE QUERY the menu's
		// flavor follows the row: a collection row lists collections, everything
		// else leads with the built-ins (_qbSrcItems).
		const block = !!this._qb.block;
		const isColRow = !!row.colPick || (!!row.src && row.src !== Plugin.ANY_ITEM);
		// A keyed built-in picked DIRECTLY (Hashtag, Due, …) wears its field name
		// in the first cell — [Due][≤][Value], no "Any item" column. Only an
		// explicit "Any item" pick keeps the three-column browse row (his call:
		// "endast om man väljer Any Item ... bör [det] finnas tre kolumner").
		const compactBI = block && row.src === Plugin.ANY_ITEM && !!row.field && !row.anyPick && row.type !== "bi-kw";
		const sm = block
			? this._qbSrcItems(isColRow ? "col" : (!row.src && this._qbModelHasPage() ? "colfirst" : "kw"))
			: this._qbSrcItems();
		const pickSrc = (v) => {
			if (v === "__col") {
				row.colPick = true;
				row.src = ""; row.field = ""; row.type = "plaintext"; row.op = "="; row.value = "";
				this._qbBuild();
				this._qbOpenSrcMenuAt(path);
				return;
			}
			delete row.colPick;
			this._qbApplySrcPick(row, v);
			this._qbBuild(); this._qbApply();
		};
		const srcT = this._qbTrigger("qb-src", compactBI ? row.field : row.src,
			block && !isColRow ? "Pick item" : "Collection", (btn) => {
			this._qbMenu(btn, sm.items, compactBI ? "bf|" + row.field : row.src, pickSrc, sm.cfg);
		});
		wrap.appendChild(srcT);
		if (compactBI) wrap.classList.add("qb-compact");

		// A just-born row — and a collection row still waiting for its collection
		// — is ONE picker; the other columns appear once there is something for
		// them to say ("då behövs det ju inte tre kolumner på första").
		if (block && !row.src) {
			wrap.appendChild(this._qbDelEl(path));
			wrap.appendChild(this._qbGripEl(path, wrap));
			return wrap;
		}

		// field — except on compact keyed rows, whose first cell IS the field
		const fields = this._qbFieldsFor(row.src);
		if (!compactBI) {
			const fieldT = this._qbTrigger("qb-field", row.field, row.src ? "Field" : "Pick a collection", (btn) => {
				if (!fields.length) return;
				this._qbMenu(btn, fields.filter((f) => f.pick !== false).map((f) => ({ v: f.label, label: f.label, icon: (f.icon || "").indexOf("ti-") === 0 ? f.icon : "" })), row.field, (v) => {
					const f = fields.find((x) => x.label === v);
					row.field = v;
					row.type = f ? f.type : "plaintext";
					row.op = f ? this._qbOpsFor(f.type)[0].v : "=";
					row.value = "";
					this._qbBuild(); this._qbApply();
				}, { search: fields.length > 8, searchPlaceholder: "Search field ...", dots: false });
			});
			wrap.appendChild(fieldT);
		}

		// operator — except where the only choice would be Is / Is not: NOT is the
		// lead's job now (his round-3 call — no pills, "omarkerade NOT är
		// vilseledande"), so the keyword-ish families have NO operator column at
		// all, and every other type keeps its real comparisons. All negation,
		// for every row kind, is the red NOT on the lead.
		const ops = this._qbOpsFor(row.type);
		const chosen = ops.find((o) => o.v + this._qbOpSuffix(o) === row.op) || ops[0];
		// bi-kw joined the family when valueless keyword rows started rendering
		// as full rows: their Is/Is-not IS the lead's NOT, one control is enough.
		const negFamily = ["bi-kw", "bi-coll", "bi-tag", "bi-user"].indexOf(row.type) >= 0;
		if (!negFamily) {
			const opT = this._qbTrigger("qb-op", chosen ? chosen.l : "", "Operator", (btn) => {
				this._qbMenu(btn, ops.map((o) => ({ v: o.v + this._qbOpSuffix(o), label: o.l, glyph: o.g })), row.op,
					(v) => { this._qbPickOp(row, v); }, { dots: false });
			});
			wrap.appendChild(opT);
		}

		// value — every field type that HAS a set of values offers them
		if (chosen && chosen.empty) {
			const spacer = document.createElement("div");
			spacer.className = "qb-val";
			spacer.style.visibility = "hidden";
			wrap.appendChild(spacer);
		} else {
			const fdef = fields.find((f) => f.label === row.field);
			const type = fdef ? fdef.type : "text";
			// Built-in types borrow the UI of the collection type they behave like.
			const uiType = ({ "bi-kw": "choice", "bi-date": "datetime", "bi-user": "user",
				"bi-coll": "bi-coll", "bi-text": "text", "bi-tag": "text" })[type] || type;
			if (uiType === "choice" && (fdef.choices || []).length) {
				const items = fdef.choices.filter((c) => c.active !== false).map((c) => ({
					v: c.label, label: c.label, color: c.color,
					icon: typeof c.icon === "string" && c.icon.indexOf("ti-") === 0 ? c.icon : "",
				}));
				const vt = this._qbTrigger("qb-val-sel", row.value, "Value", (btn) => {
					this._qbMenu(btn, items, row.value, (v) => { row.value = v; this._qbBuild(); this._qbApply(); },
						{ search: items.length > 8, alignRight: true });
				});
				wrap.appendChild(vt);
			} else if (uiType === "user") {
				const users = this._qbUserOptions();
				const vt = this._qbTrigger("qb-val-sel", row.value, users.length ? "Value" : "Name", (btn) => {
					if (!users.length) return;
					this._qbMenu(btn, users.map((n) => ({ v: n, label: n, icon: "ti-user" })), row.value,
						(v) => { row.value = v; this._qbBuild(); this._qbApply(); },
						{ search: users.length > 8, searchPlaceholder: "Search person ...", alignRight: true });
				});
				wrap.appendChild(vt);
			} else if (uiType === "record") {
				// Page links: the target collection's pages, searchable like the
				// property picker itself. Loaded on open so nothing is fetched twice.
				const vt = this._qbTrigger("qb-val-sel", row.value, "Value", async (btn) => {
					const opts = await this._qbRecordOptions(row.src, row.field);
					if (!this._qbEl) return;
					this._qbMenu(btn, opts.map((o) => ({ v: o.name, label: o.name, icon: o.icon })), row.value,
						(v) => {
							row.value = v;
							const hit = opts.find((o) => o.name === v);
							if (hit && hit.guid) row.vguid = hit.guid; else delete row.vguid;
							this._qbBuild(); this._qbApply();
						},
						{ search: true, searchPlaceholder: "Search option ...", alignRight: true });
				});
				wrap.appendChild(vt);
			} else if (uiType === "bi-coll") {
				// The standalone collection filter (@Name). Dynamic collections are
				// left out — the engine calls @"My Finance" an unknown magic tag,
				// which makes sense: a dynamic collection has no records of its own.
				const opts = (this._qbCols || []).map((c) => ({ v: c.name, label: c.name, icon: c.icon }));
				const vt = this._qbTrigger("qb-val-sel", row.value, "Value", (btn) => {
					this._qbMenu(btn, opts, row.value, (v) => { row.value = v; this._qbBuild(); this._qbApply(); },
						{ search: true, searchPlaceholder: "Search Collections ...", alignRight: true });
				});
				wrap.appendChild(vt);
			} else if (uiType === "datetime") {
				// Every value is PICKABLE (his call): the menu leads with the exact-date
				// calendar and then the rolling tokens — Today, This week, Last Monday…
				// A rolling token is why a live search stays live: @thisweek moves with
				// the calendar where 2026-08-14 is frozen the day it was picked.
				const tokLabel = (v) => {
					const t = Plugin.QB_DATE_TOKENS.find((x) => x.v === v);
					return t ? t.label : (v || "");
				};
				const vt = this._qbTrigger("qb-val-sel qb-val-date", tokLabel(row.value), "Value", (btn) => {
					// Every date row carries the calendar glyph (his call) — the exact
					// date keeps its own, so the two kinds still read apart.
					const items = [{ v: "__cal", label: "Pick a date…", icon: "ti-calendar-event" }]
						.concat(Plugin.QB_DATE_TOKENS.map((t) => ({ v: t.v, label: t.label, icon: "ti-calendar" })));
					this._qbMenu(btn, items, row.value, (v) => {
						if (v === "__cal") {
							this._qbOpenCal(btn, /^\d{4}-/.test(row.value || "") ? row.value : "",
								(d) => { row.value = d; this._qbBuild(); this._qbApply(); }, row.field);
							return;
						}
						row.value = v; this._qbBuild(); this._qbApply();
					}, { search: true, searchPlaceholder: "Search option ...", alignRight: true, dots: false });
				});
				wrap.appendChild(vt);
			} else {
				const vi = document.createElement("input");
				vi.className = "qb-val";
				vi.type = "text";
				vi.value = row.value || "";
				vi.placeholder = "Value";   // a grey "0" read as a set number, same trap
				vi.addEventListener("input", () => { row.value = vi.value; this._qbApply(); });
				vi.addEventListener("keydown", (e) => e.stopPropagation());
				wrap.appendChild(vi);
			}
		}

		// The grip sits in the fold column, PAST the trash — that column is empty
		// on condition rows, and having the grip in the middle of the row was
		// eating the value controls' width (his report: "innehållet i en sån
		// grupp åter krympt"). Same column as the fold buttons, so the right
		// edge stays one clean line.
		wrap.appendChild(this._qbDelEl(path));
		wrap.appendChild(this._qbGripEl(path, wrap));
		return wrap;
	}

	// Anchored under the toolbar, clamped to the viewport, so the rows it filters
	// stay on screen while you build.
	_qbPlace() {
		const el = this._qbEl;
		if (!el) return;
		if (!el.parentNode) document.body.appendChild(el);
		const M = 8;
		// The panel is PLACED ONCE per open and then pinned: every rebuild used to
		// re-run the flip-above/below logic against the new height, so picking a
		// value could teleport the whole modal ("modalen hoppar", his recording).
		// Only the max-height follows the pinned top, so growth scrolls inside.
		if (this._qb.pin) {
			const w = el.offsetWidth;
			const left = Math.max(M, Math.min(this._qb.pin.left, window.innerWidth - w - M));
			const top = Math.max(M, Math.min(this._qb.pin.top, window.innerHeight - 120));
			el.style.left = left + "px";
			el.style.top = top + "px";
			el.style.maxHeight = (window.innerHeight - top - M) + "px";
			return;
		}
		if (this._qb.block) {
			// Anchored under the BLOCK, right-aligned to its box, so the rows the
			// query renders stay visible above while you edit. Flips above the block
			// when there is no room below; a block taller than the screen just gets
			// the panel clamped into view.
			const row = document.querySelector('.listitem.listitem-query[data-guid="' + this._qb.block + '"]');
			const box = row && row.querySelector(":scope > .query-container-div");
			const rb = (box || row) && (box || row).getBoundingClientRect();
			const w = el.offsetWidth, h = el.offsetHeight;
			if (rb && rb.width > 2) {
				el.style.left = Math.max(M, Math.min(rb.right - w, window.innerWidth - w - M)) + "px";
				// ABOVE the block (his call): the block sits right under the panel,
				// so the results appear where you are looking. When the block is too
				// close to the top, PIN TO THE VIEWPORT TOP — falling below a tall
				// block meant the bottom of the screen, nowhere near the query
				// (his report). Overlapping the block's first rows is the lesser evil.
				let top = rb.top - 8 - h;
				if (top < M) top = M;
				el.style.top = Math.max(M, Math.min(top, window.innerHeight - h - M)) + "px";
			} else {
				// The block scrolled away or its page changed — stay on screen.
				el.style.left = Math.max(M, (window.innerWidth - w) / 2) + "px";
				el.style.top = Math.max(M, (window.innerHeight - h) / 2) + "px";
			}
			if (!this._qbOutside) {
				this._qbOutside = (e) => { if (el.contains(e.target)) return; };
				document.addEventListener("mousedown", this._qbOutside, true);
			}
			this._qb.pin = { left: parseFloat(el.style.left) || M, top: parseFloat(el.style.top) || M };
			el.style.maxHeight = (window.innerHeight - this._qb.pin.top - M) + "px";
			return;
		}
		// Hang it off the bookmark button and run it to the RIGHT edge, the way the
		// saved-searches popup does: the records stay readable to the left of it.
		// The button is re-resolved every time — the toolbar is rebuilt on view
		// changes, and a held reference goes stale (which parked the panel at the
		// left edge once a rebuild happened).
		const panel = this._qb.input.closest(".panel") || document;
		const btn = panel.querySelector(".ssq-btn");
		const bar = this._qb.input.closest(".records-view-toolbar-inner");
		const anchor = btn || bar || this._qb.input;
		const r = anchor.getBoundingClientRect();
		const w = el.offsetWidth, h = el.offsetHeight;
		// Only right-align when there is actually room to the left of that edge;
		// otherwise fall back to left-aligning against the same anchor.
		const wantRight = r.right;
		const left = (wantRight - w >= M) ? (wantRight - w) : Math.max(M, r.left);
		el.style.left = Math.max(M, Math.min(left, Math.max(M, window.innerWidth - w - M))) + "px";
		el.style.top = Math.max(M, Math.min(r.bottom + 6, window.innerHeight - h - M)) + "px";
		this._qb.pin = { left: parseFloat(el.style.left) || M, top: parseFloat(el.style.top) || M };
		el.style.maxHeight = (window.innerHeight - this._qb.pin.top - M) + "px";
		if (!this._qbOutside) {
			this._qbOutside = (e) => {
				if (el.contains(e.target)) return;
				// Clicking the rows behind is part of using it; only the × / buttons close.
			};
			document.addEventListener("mousedown", this._qbOutside, true);
		}
	}

	// Save the built search, keeping the structure so it can be reopened as rows.
	// Opened from the pencil it UPDATES that search in place; otherwise it creates.
	// The saved search being edited, when the query is exactly one of them.
	_qbEditTarget() {
		if (!this._qb || this._qb.block) return null;
		const live = (this._qb.model.rows || []).filter((n) => this._qbNodeQuery(n));
		const n = live.length === 1 ? live[0] : null;
		if (!n || this._qbKind(n) !== "saved" || !n.sid || n.neg) return null;
		return this._items().some((x) => x.id === n.sid) ? n : null;
	}

	_qbSave(title) {
		if (this._qb.block) return;   // no Save on a block; the button is hidden too
		const q = this._qbCompile(this._qb.model);
		if (!q) return;
		const name = (title || "").trim() || this._qb.title || this._suggestTitle(q, { colName: this._qb.colName });
		// Saving what IS one saved search stores its own rows, never a row that
		// points back at itself.
		const target = this._qbEditTarget();
		const conditions = JSON.parse(JSON.stringify(target ? { join: "AND", rows: target.rows } : this._qb.model)); // reopens as rows
		const existing = this._qb.editId ? this._items().find((x) => x.id === this._qb.editId) : null;
		let id;
		if (existing) {
			id = existing.id;
			existing.title = name;
			existing.query = q;
			existing.conditions = conditions;
			existing.viewId = this._qb.saveViewId;
			existing.viewName = this._qb.saveViewId === Plugin.GLOBAL_VIEW ? "" : (this._qb.saveViewName || "");
			existing.ts = Date.now();
		} else {
			id = "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
			this._items().push({
				id, title: name, query: q, conditions,
				col: this._qb.col, colName: this._qb.colName,
				viewId: this._qb.saveViewId,
				viewName: this._qb.saveViewId === Plugin.GLOBAL_VIEW ? "" : (this._qb.saveViewName || ""),
				ts: Date.now(),
			});
		}
		this._touch();
		this._qb.title = name;
		this._qb.editId = id;
		this._qb.naming = false;
		this._qbClose(false); // keep the query applied
	}
}
