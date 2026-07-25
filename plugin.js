/**
 * Saved Searches — save the queries you type into a collection view's filter
 * field, give each one a title, and re-run it from a bookmark button in the
 * view's toolbar.
 *
 * Thymer has pinned searches for the global search panel, but nothing for the
 * per-view filter field, so a query you spent a minute composing is gone the
 * moment you clear it. This plugin adds a bookmark button next to the filter
 * and sort buttons; it opens a list of the searches saved for the collection
 * you're in, with the ones saved in the current view listed first.
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
 * plugin, which would yank the popup out from under you mid-click, so writes
 * are held in memory (plus localStorage as a crash net) and flushed once the
 * popup closes.
 *
 * No `export` keyword — pushed straight into Thymer's plugin store.
 */

const CSS = `
/* Toolbar button — same shape as Thymer's own toolbar icons, so it sits in the
   row without announcing itself as third-party. */
.ssq-btn { display: flex; }
.ssq-btn.ssq-open { color: var(--ed-button-primary-bg, #4caea1); }
/* Filled bookmark is an inline SVG (no filled glyph in the icon font); size it to
   the surrounding icons so it sits level with the filter and sort buttons. */
.ssq-ico { width: 1em; height: 1em; display: block; }

/* Popup — the native command palette's surface and typography (same approach as
   Move To / Quick Capture), so it reads as first-party and follows the theme. */
.ssq-pop {
	position: fixed; z-index: 99999;
	/* Bigger on desktop; on a phone, full width minus a small margin so it can
	   never spill past the screen edge. */
	width: min(480px, calc(100vw - 16px));
	/* Cap to the viewport and let the list scroll inside, so a long list or a
	   short screen never pushes the popup off the top or bottom. dvh tracks the
	   real visible height on mobile; the vh line is the fallback. */
	max-height: calc(100vh - 16px);
	max-height: calc(100dvh - 16px);
	display: flex; flex-direction: column;
	background: var(--cmdpal-bg-color, var(--app-bg, #26262b));
	color: var(--cmdpal-fg-color, var(--text-color, #ddd));
	font-family: var(--font-mono, inherit);
	font-size: var(--text-size-small, .875rem);
	border: 1px solid rgba(127,127,127,.4);
	border-radius: var(--radius-larger, 10px);
	box-shadow: 0 16px 48px rgba(0,0,0,.5);
	overflow: hidden;
}
.ssq-list { flex: 1 1 auto; overflow-y: auto; padding: 6px 0; min-height: 0; }
/* Header: window title on the left, Clear-search button on the right (the button
   is the easy way to empty the filter field, especially on mobile). */
.ssq-head {
	flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between;
	gap: 8px; padding: 8px 8px 8px 12px;
	border-bottom: 1px solid rgba(127,127,127,.18);
}
.ssq-head-title { font-size: 10.5px; letter-spacing: .04em; text-transform: uppercase; opacity: .45; font-weight: 600; }
.ssq-clear {
	display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 9px;
	border: 1px solid rgba(127,127,127,.28); border-radius: 6px; cursor: pointer;
	background: var(--ed-button-bg, transparent); color: var(--ed-button-color, var(--text-color, #ddd));
	font-family: inherit; font-size: 11.5px; white-space: nowrap;
}
.ssq-clear:hover { filter: brightness(1.18); }
.ssq-clear.ssq-clear-off { opacity: .35; cursor: default; pointer-events: none; }
/* Thin divider UNDER each saved item (including the last one in a view group, so
   the group closes with a line before the next section title). Drawn as an inset
   pseudo-element (a border would run edge to edge) with an equal margin on each
   side, spanning the whole item including the grip. The final item before the
   footer is exempt — the footer's own top border separates it there. */
.ssq-group .ssq-opt { position: relative; }
.ssq-group .ssq-opt::after {
	content: ""; position: absolute; bottom: 0; left: 12px; right: 12px;
	border-bottom: 1px solid rgba(127,127,127,.14);
}
/* The last item before the footer gets no divider (the footer's border separates
   there); it's tagged in _render since the last populated group varies. */
.ssq-opt.ssq-nodivider::after { display: none; }
.ssq-sec {
	padding: 12px 12px 3px; font-size: 10.5px; letter-spacing: .04em;
	text-transform: uppercase; opacity: .45;
}
/* First section sits right under the popup header bar, so it needs less top room. */
.ssq-list > .ssq-section:first-child .ssq-sec { padding-top: 6px; }
.ssq-opt {
	display: flex; align-items: center; gap: 8px;
	padding: 9px 10px 9px 6px; cursor: pointer; line-height: 16px;
}
/* Drag handle on the far left of each saved row. touch-action:none so a touch
   drag reorders instead of scrolling the list. */
.ssq-grip {
	flex: 0 0 auto; width: 16px; align-self: stretch;
	display: inline-flex; align-items: center; justify-content: center;
	cursor: grab; opacity: 0; font-size: 15px; touch-action: none;
}
.ssq-opt:hover .ssq-grip { opacity: .4; }
.ssq-grip:hover { opacity: .8 !important; }
.ssq-grip:active { cursor: grabbing; }
.ssq-opt.ssq-active .ssq-grip { opacity: .6; }
.ssq-opt.ssq-dragging { opacity: .45; }
.ssq-drop-line {
	height: 2px; margin: 1px 10px 1px 12px; border-radius: 2px;
	background: var(--ed-button-primary-bg, #4caea1);
}
.ssq-opt:hover:not(.ssq-active) { background: rgba(127,127,127,.12); }
.ssq-opt.ssq-active { background: var(--cmdpal-selected-bg-color, var(--ed-button-primary-bg, #3aa37f)); color: var(--cmdpal-selected-fg-color, #fff); }
.ssq-opt.ssq-active .ti, .ssq-opt.ssq-active .ssq-sub { color: var(--cmdpal-selected-fg-color, #fff); opacity: .85; }
.ssq-opt .ti { opacity: .7; font-size: 14px; flex: 0 0 auto; }
.ssq-txt { flex: 1 1 auto; min-width: 0; }
.ssq-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* The query itself, one muted line under the title — the reason you can tell two
   similar saved searches apart without running them. */
.ssq-sub { opacity: .5; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ssq-edit, .ssq-del {
	flex: 0 0 auto; width: 22px; height: 22px; border-radius: 5px;
	display: inline-flex; align-items: center; justify-content: center;
	opacity: 0; cursor: pointer; font-size: 13px;
}
.ssq-opt:hover .ssq-edit, .ssq-opt:hover .ssq-del { opacity: .5; }
.ssq-edit:hover, .ssq-del:hover { opacity: 1 !important; background: rgba(127,127,127,.22); }
.ssq-opt.ssq-active .ssq-edit, .ssq-opt.ssq-active .ssq-del { opacity: .7; }
.ssq-empty { padding: 10px 12px; opacity: .5; font-size: 12px; }
.ssq-foot { border-top: 1px solid rgba(127,127,127,.18); background: rgba(127,127,127,.07); }
/* Footer rows have no drag handle, so pad them to line up with the row text. */
.ssq-foot .ssq-opt { padding: 7px 10px 7px 12px; }
.ssq-foot .ssq-opt.ssq-disabled { opacity: .4; cursor: default; background: none; }
.ssq-name {
	width: 100%; box-sizing: border-box; border: none; outline: none;
	padding: 8px 12px; font-family: inherit; font-size: inherit;
	background: transparent; color: var(--cmdpal-fg-color, var(--text-color, #eee));
	border-top: 1px solid rgba(127,127,127,.18);
}
.ssq-hint { padding: 4px 12px 8px; font-size: 11px; opacity: .45; }
/* Empty here/global sections stay in the DOM as drop targets but are hidden until
   a drag is in progress, when they appear so a search can be dropped into them. */
.ssq-empty-zone { display: none; }
.ssq-pop.ssq-dragging-active .ssq-empty-zone { display: block; }
.ssq-pop.ssq-dragging-active .ssq-group { min-height: 8px; }
/* The group currently under the pointer during a drag. */
.ssq-group.ssq-drop-over { background: rgba(127,127,127,.06); }
/* Placeholder shown inside an empty drop zone while dragging. */
.ssq-zone-hint { padding: 9px 12px; font-size: 11px; opacity: .4; font-style: italic; }
`;

class Plugin extends AppPlugin {

	// Longest query text kept as a title suggestion before it gets truncated.
	static TITLE_SUGGEST_MAX = 40;

	// A search whose viewId is this is collection-global: it shows in every view of
	// the collection rather than being tied to one. Real view ids never look like this.
	static GLOBAL_VIEW = "*";

	onLoad() {
		// All state as class fields: Thymer can call onUnload() on an instance
		// whose onLoad() never ran (editor validate/preview cycle).
		this._cache = null;   // in-memory store, authoritative for this session
		this._rev = 0;        // timestamp of the last write, used to pick the newer copy
		this._dirty = false;  // pending config write, flushed when the popup closes
		this._pop = null;     // open popup, if any
		this._popCtx = null;  // context (panel/input/collection/view) the popup belongs to
		this._active = -1;    // keyboard-highlighted row
		// The saved search currently loaded in the filter field, so editing the
		// field's query and reopening the popup offers "Update «Title»". Cleared
		// when the field is emptied — that's the signal for "I'm starting fresh".
		this._loaded = null;  // {id, query}

		this.ui.injectCSS(CSS);
		// A plugin reload doesn't always unload the previous instance, so clear any
		// popup it left behind before this one starts drawing its own.
		document.querySelectorAll(".ssq-pop").forEach((p) => p.remove());

		this._onDocDown = this._onDocDown.bind(this);
		this._onKeyDown = this._onKeyDown.bind(this);
		this._onReposition = this._onReposition.bind(this);
		this._onFieldInput = this._onFieldInput.bind(this);
		document.addEventListener("mousedown", this._onDocDown, true);
		document.addEventListener("keydown", this._onKeyDown, true);
		document.addEventListener("input", this._onFieldInput, true);
		window.addEventListener("resize", this._onReposition);

		// The toolbar is re-rendered on every view switch and panel change, so the
		// button has to be re-attached rather than added once.
		this._items(); // seed the store now, so a write owed from a previous session is known
		this._observer = new MutationObserver(() => this._scheduleAttach());
		this._observer.observe(document.body, { childList: true, subtree: true });
		this._attachAll();
	}

	onUnload() {
		if (this._observer) { this._observer.disconnect(); this._observer = null; }
		if (this._attachTimer) { clearTimeout(this._attachTimer); this._attachTimer = null; }
		document.removeEventListener("mousedown", this._onDocDown, true);
		document.removeEventListener("keydown", this._onKeyDown, true);
		document.removeEventListener("input", this._onFieldInput, true);
		window.removeEventListener("resize", this._onReposition);
		this._closePopup();
		document.querySelectorAll(".ssq-btn").forEach((b) => b.remove());
		document.querySelectorAll(".ssq-pop").forEach((p) => p.remove());
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
			const raw = JSON.parse(window.localStorage.getItem("ssq_savedSearches") || "null");
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

	_touch() {
		this._dirty = true;
		this._rev = Date.now();
		// Also a crash net: the config is only written when the popup closes.
		try {
			window.localStorage.setItem("ssq_savedSearches", JSON.stringify({ rev: this._rev, items: this._items() }));
		} catch (e) {}
		this._repaintButtons(); // a collection may have gained or lost its first saved search
	}

	// A config write reloads the plugin, and a plugin reload wipes whatever is typed
	// in the collection filter field (Thymer's own behaviour, nothing to do with
	// this plugin). Saving a search while a query is on screen would therefore
	// clear the very search you just saved, so the write waits for a moment when no
	// filter field holds anything — until then the change lives in memory and
	// localStorage, and _attachAll retries on the next DOM tick.
	_canFlush() {
		return ![...document.querySelectorAll("input.query-input--field.is-collection-filter")]
			.some((i) => i.value.trim());
	}

	async _flush() {
		// Never write while the popup is open: the write reloads the plugin, which
		// would tear the open popup down mid-interaction (reorder, rename, save).
		// The write lands on close, or on a later attach tick once the field empties.
		if (!this._dirty || this._pop || !this._canFlush()) return;
		this._dirty = false;
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
		// A panel switch (or a plugin reload with a popup open) destroys the toolbar
		// the popup was anchored to and would strand it on screen, so an orphaned
		// popup is closed on the same tick that re-attaches the button.
		if (this._pop && this._popBtn && !document.contains(this._popBtn)) this._closePopup();
		if (this._dirty) this._flush(); // retry a write that was waiting for an empty filter field

		document.querySelectorAll(".records-view-toolbar-actions").forEach((bar) => {
			let btn = bar.querySelector(".ssq-btn");
			if (!btn) {
				btn = document.createElement("button");
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
	// collection name (the fallback for panels rendered without a heading).
	_colOf(panel) {
		if (!panel) return "";
		const heading = panel.querySelector(".panel-heading[data-banner-drop]");
		if (heading) return heading.getAttribute("data-banner-drop");
		const bar = panel.querySelector(".panel-bar[data-plugin]");
		return bar ? "name:" + bar.getAttribute("data-plugin") : "";
	}

	// Everything the popup needs to know about where it was opened from.
	_context(btn) {
		const panel = btn.closest(".panel") || document;
		const input = panel.querySelector("input.query-input--field.is-collection-filter");
		if (!input) return null;
		const bar = panel.querySelector(".panel-bar[data-plugin]");
		const colName = bar ? bar.getAttribute("data-plugin") : "";
		const col = this._colOf(panel);
		// Desktop exposes the active view as a pressed toolbar button; mobile has no
		// such button, which used to leave every saved search ungrouped in one list.
		// Fall back to the focused view component's config, whose `id` matches the
		// button's data-view and whose `label` is the view name.
		const view = panel.querySelector('.records-view-switcher-button[aria-pressed="true"]');
		let viewId = view ? view.getAttribute("data-view") : "";
		let viewName = view ? view.textContent.trim() : "";
		if (!viewId) {
			const vc = window.g_focusedComponent && window.g_focusedComponent.options && window.g_focusedComponent.options.viewConfig;
			if (vc && vc.id) { viewId = vc.id; viewName = vc.label || ""; }
		}
		return { panel, input, col, colName, viewId, viewName };
	}

	// Clearing the filter field means "starting fresh", so the search that was
	// loaded there is no longer the thing being edited.
	_onFieldInput(e) {
		const t = e.target;
		if (t && t.matches && t.matches("input.query-input--field.is-collection-filter") && !t.value.trim()) {
			this._loaded = null;
		}
	}

	// ── Running a search ─────────────────────────────────────────────────────
	// Thymer's filter field is a plain input whose handler listens for "input",
	// so this is exactly what typing does.
	_apply(input, query) {
		input.value = query;
		input.dispatchEvent(new Event("input", { bubbles: true }));
	}

	// Load a saved search into the field and remember it as the one being edited.
	_run(input, search) {
		this._loaded = { id: search.id, query: search.query };
		this._apply(input, search.query);
	}

	// ── Popup ────────────────────────────────────────────────────────────────
	_togglePopup(btn) {
		if (this._pop && this._popBtn === btn) { this._closePopup(); return; }
		this._closePopup();
		const ctx = this._context(btn);
		if (!ctx) return;
		this._popBtn = btn;
		this._popCtx = ctx;
		this._active = -1;
		this._pop = document.createElement("div");
		this._pop.className = "ssq-pop";
		document.body.appendChild(this._pop);
		btn.classList.add("ssq-open");
		this._render();
		this._position();
	}

	_closePopup() {
		document.querySelectorAll(".ssq-btn.ssq-open").forEach((b) => b.classList.remove("ssq-open"));
		// Sweep every popup, not just this._pop: a reload can leave one behind that
		// this instance has no reference to, and two stacked popups look broken.
		document.querySelectorAll(".ssq-pop").forEach((p) => p.remove());
		this._pop = null;
		this._popBtn = null;
		this._popCtx = null;
		this._rows = null;
		this._flush(); // config write happens here, never mid-interaction
	}

	_position() {
		if (!this._pop || !this._popBtn) return;
		const r = this._popBtn.getBoundingClientRect();
		// A zero rect means the toolbar was torn down mid-click; anchoring to it
		// would park the popup in the top-left corner of the window.
		if (!r.width && !r.height) { this._closePopup(); return; }
		const M = 8; // keep this gap from every screen edge
		const vw = window.innerWidth, vh = window.innerHeight;
		const w = this._pop.offsetWidth;
		const h = this._pop.offsetHeight;
		// Right-align to the button, then clamp within the viewport.
		const left = Math.max(M, Math.min(r.right - w, vw - w - M));
		// Below the button by default; flip above when there's more room there;
		// then clamp so a tall popup on a short screen still fits fully.
		const below = r.bottom + 6, above = r.top - 6 - h;
		let top = below;
		if (below + h > vh - M && r.top - 6 - h > M) top = above;
		top = Math.max(M, Math.min(top, vh - h - M));
		this._pop.style.left = left + "px";
		this._pop.style.top = top + "px";
	}

	_onReposition() { this._position(); }

	_render() {
		const ctx = this._popCtx;
		if (!this._pop || !ctx) return;
		const G = Plugin.GLOBAL_VIEW;
		const mine = this._items().filter((s) => s.col === ctx.col);
		const here = mine.filter((s) => s.viewId !== G && s.viewId === ctx.viewId);
		const global = mine.filter((s) => s.viewId === G);
		const elsewhere = mine.filter((s) => s.viewId !== G && s.viewId !== ctx.viewId);

		this._pop.innerHTML = "";
		this._rows = [];

		// Header with a Clear-search button (empties the filter field — the reliable
		// way to clear it on mobile, where the field's own × is fiddly to hit).
		const head = document.createElement("div");
		head.className = "ssq-head";
		const htitle = document.createElement("div");
		htitle.className = "ssq-head-title";
		htitle.textContent = "Saved searches";
		const clear = document.createElement("button");
		clear.className = "ssq-clear" + (ctx.input.value.trim() ? "" : " ssq-clear-off");
		clear.textContent = "Clear Search";
		clear.addEventListener("click", (e) => {
			e.stopPropagation();
			if (!ctx.input.value.trim()) return;
			this._apply(ctx.input, "");
			this._loaded = null;
			this._render();   // footer + clear button update; popup stays open
			this._position();
		});
		head.appendChild(htitle);
		head.appendChild(clear);
		this._pop.appendChild(head);

		const list = document.createElement("div");
		list.className = "ssq-list";
		this._pop.appendChild(list);

		if (!mine.length) {
			const empty = document.createElement("div");
			empty.className = "ssq-empty";
			empty.textContent = "No searches saved in " + (ctx.colName || "this collection") + " yet.";
			list.appendChild(empty);
		}

		// Sections in display order: the current view, then collection-global
		// searches, then searches belonging to other views. The first two are always
		// present as drag drop-targets (drop a search into "Whole collection" to make
		// it global, or into a view's section to move it there); when empty they are
		// hidden until a drag is in progress. "Other views" is a display bucket only.
		const sections = [];
		if (ctx.viewId && ctx.viewId !== G) {
			sections.push({ kind: "here", label: ctx.viewName || "This view", viewId: ctx.viewId, viewName: ctx.viewName || "", items: here, hint: "Drop here to show only in " + (ctx.viewName || "this view") });
		}
		sections.push({ kind: "global", label: "Whole collection", viewId: G, viewName: "", items: global, hint: "Drop here to show in every view" });
		if (elsewhere.length) sections.push({ kind: "other", label: "Other views", viewId: "other", items: elsewhere, showView: true });

		// A header would be noise when the current view is the only populated group.
		const populated = sections.filter((s) => s.items.length);
		const soloHere = populated.length === 1 && populated[0].kind === "here";
		sections.forEach((sec) => this._renderSection(list, sec, soloHere));

		// The last real row before the footer gets no divider (empty drop zones carry
		// no rows, so this is the last item of the last populated section).
		const rows = list.querySelectorAll(".ssq-group .ssq-opt");
		if (rows.length) rows[rows.length - 1].classList.add("ssq-nodivider");

		const foot = document.createElement("div");
		foot.className = "ssq-foot";
		this._pop.appendChild(foot);
		const q = ctx.input.value.trim();

		if (!q) {
			this._footOpt(foot, "ti-plus", "Type a search to save it", null, true);
			return;
		}

		// If a saved search is loaded in the field and you've edited its query,
		// the primary action is to update that search in place — this is the
		// "edit directly in the field" path, no rename dialog needed.
		const loaded = this._loaded && mine.find((s) => s.id === this._loaded.id);
		if (loaded && loaded.query !== q) {
			this._footOpt(foot, "ti-pencil", "Update “" + loaded.title + "”", q, false, () => {
				const it = this._items().find((x) => x.id === loaded.id);
				if (it) { it.query = q; it.ts = Date.now(); }
				this._loaded = { id: loaded.id, query: q };
				this._touch();
				this._render();      // back to the list, with the change shown
				this._position();
			});
			this._footOpt(foot, "ti-plus", "Save as a new search…", null, false, () => this._renameDialog({ query: q }));
		} else {
			this._footOpt(foot, "ti-plus", "Save current search…", null, false, () => this._renameDialog({ query: q }));
		}
	}

	_footOpt(foot, icon, label, sub, disabled, onRun) {
		const el = document.createElement("div");
		el.className = "ssq-opt" + (disabled ? " ssq-disabled" : "");
		el.innerHTML = '<span class="ti ' + icon + '"></span><div class="ssq-txt"><div class="ssq-title"></div>' +
			(sub ? '<div class="ssq-sub"></div>' : "") + "</div>";
		el.querySelector(".ssq-title").textContent = label;
		if (sub) el.querySelector(".ssq-sub").textContent = sub;
		foot.appendChild(el);
		if (disabled || !onRun) return;
		el.addEventListener("click", (e) => { e.stopPropagation(); onRun(); });
		this._rows.push({ el, run: onRun });
	}

	// One section = a header + a group of rows. The group carries `data-view` (a
	// view id, "*" for global, or "other"), which drag uses to decide where a
	// dropped search now belongs. Empty here/global sections stay in the DOM as
	// drop targets but are hidden until a drag reveals them.
	_renderSection(list, sec, soloHere) {
		const box = document.createElement("div");
		box.className = "ssq-section" + (sec.items.length ? "" : " ssq-empty-zone");
		if (!(soloHere && sec.kind === "here")) {
			const h = document.createElement("div");
			h.className = "ssq-sec";
			h.textContent = sec.label;
			box.appendChild(h);
		}
		const g = document.createElement("div");
		g.className = "ssq-group";
		g.setAttribute("data-view", sec.viewId);
		if (sec.viewName) g.setAttribute("data-viewname", sec.viewName);
		sec.items.forEach((s) => this._row(g, s, !!sec.showView));
		if (!sec.items.length && sec.hint) {
			const p = document.createElement("div");
			p.className = "ssq-zone-hint";
			p.textContent = sec.hint;
			g.appendChild(p);
		}
		box.appendChild(g);
		list.appendChild(box);
	}

	_row(group, s, showView) {
		const row = document.createElement("div");
		row.className = "ssq-opt";
		row.setAttribute("data-id", s.id);
		const txt = document.createElement("div");
		txt.className = "ssq-txt";
		const t = document.createElement("div");
		t.className = "ssq-title";
		t.textContent = s.title;
		const sub = document.createElement("div");
		sub.className = "ssq-sub";
		sub.textContent = (showView && s.viewName ? s.viewName + " · " : "") + s.query;
		txt.appendChild(t);
		txt.appendChild(sub);

		const edit = document.createElement("span");
		edit.className = "ssq-edit ti ti-pencil";
		edit.setAttribute("title", "Rename");
		edit.addEventListener("click", (e) => {
			e.stopPropagation();
			this._renameDialog({ query: s.query, editId: s.id, title: s.title });
		});

		const del = document.createElement("span");
		del.className = "ssq-del ti ti-trash";
		del.setAttribute("title", "Delete");
		del.addEventListener("click", (e) => {
			e.stopPropagation();
			const items = this._items();
			const i = items.findIndex((x) => x.id === s.id);
			if (i >= 0) items.splice(i, 1);
			if (this._loaded && this._loaded.id === s.id) this._loaded = null;
			this._touch();
			this._render();
			this._position();
		});

		const grip = document.createElement("span");
		grip.className = "ssq-grip ti ti-grip-vertical";
		grip.setAttribute("title", "Drag to reorder");
		grip.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); });
		grip.addEventListener("pointerdown", (e) => this._startDrag(e, row));

		row.appendChild(grip);
		row.appendChild(txt);
		row.appendChild(edit);
		row.appendChild(del);
		const run = () => {
			this._run(this._popCtx.input, s);
			this._closePopup();
		};
		row.addEventListener("click", (e) => {
			// A drag that just ended fires a trailing click; don't run the search then.
			if (Date.now() < (this._suppressClickUntil || 0)) return;
			e.stopPropagation();
			run();
		});
		group.appendChild(row);
		this._rows.push({ el: row, run });
	}

	// Pointer drag that can cross sections. Dropping in another section reassigns
	// the search's view (a view's section → that view; "Whole collection" → global);
	// dropping in its own section reorders. Empty here/global sections are revealed
	// as drop targets for the duration of the drag.
	_startDrag(e, row) {
		if (e.button != null && e.button !== 0) return; // left / touch only
		e.preventDefault();
		e.stopPropagation();
		const list = this._pop && this._pop.querySelector(".ssq-list");
		if (!list) return;
		this._pop.classList.add("ssq-dragging-active"); // reveal empty drop zones
		const line = document.createElement("div");
		line.className = "ssq-drop-line";
		let moved = false, targetGroup = null;
		row.classList.add("ssq-dragging");
		const clearOver = () => list.querySelectorAll(".ssq-group.ssq-drop-over").forEach((g) => g.classList.remove("ssq-drop-over"));

		const onMove = (ev) => {
			const y = ev.clientY;
			const groups = [...list.querySelectorAll(".ssq-group")];
			if (!groups.length) return;
			let g = groups.find((gr) => { const r = gr.getBoundingClientRect(); return y >= r.top && y <= r.bottom; });
			if (!g) g = (y < groups[0].getBoundingClientRect().top) ? groups[0] : groups[groups.length - 1];
			targetGroup = g;
			clearOver();
			g.classList.add("ssq-drop-over");
			const others = [...g.querySelectorAll(".ssq-opt")].filter((r) => r !== row);
			let before = null;
			for (const r of others) {
				const rect = r.getBoundingClientRect();
				if (y < rect.top + rect.height / 2) { before = r; break; }
			}
			const hint = g.querySelector(".ssq-zone-hint");
			if (before) g.insertBefore(line, before);
			else if (hint) g.insertBefore(line, hint);
			else g.appendChild(line);
			moved = true;
		};
		const onUp = () => {
			document.removeEventListener("pointermove", onMove, true);
			document.removeEventListener("pointerup", onUp, true);
			row.classList.remove("ssq-dragging");
			clearOver();
			if (this._pop) this._pop.classList.remove("ssq-dragging-active");
			if (moved && line.parentNode) line.parentNode.insertBefore(row, line);
			line.remove();
			if (moved && targetGroup) {
				this._suppressClickUntil = Date.now() + 350; // swallow the trailing click
				this._commitDrag(targetGroup, row);
			} else {
				this._render(); this._position(); // nothing changed; drop the revealed zones
			}
		};
		document.addEventListener("pointermove", onMove, true);
		document.addEventListener("pointerup", onUp, true);
	}

	// Decide what a drop means from the group it landed in.
	_commitDrag(targetGroup, row) {
		const ctx = this._popCtx;
		const item = this._items().find((x) => x.id === row.getAttribute("data-id"));
		if (!item || !ctx) { this._render(); this._position(); return; }
		const tv = targetGroup.getAttribute("data-view");

		// "Other views" is a display bucket, not a reassignment target: reorder if the
		// row already lives there, otherwise leave it be.
		if (tv === "other") {
			if (item.viewId !== Plugin.GLOBAL_VIEW && item.viewId !== ctx.viewId) this._commitOrder(targetGroup);
			else { this._render(); this._position(); }
			return;
		}
		// Same section → pure reorder.
		if (tv === item.viewId) { this._commitOrder(targetGroup); return; }
		// Cross section → reassign the view (or make global), THEN reorder against the
		// target group's DOM so the item keeps the exact spot it was dropped at rather
		// than snapping to wherever its array index happens to fall.
		if (tv === Plugin.GLOBAL_VIEW) { item.viewId = Plugin.GLOBAL_VIEW; item.viewName = ""; }
		else { item.viewId = tv; item.viewName = targetGroup.getAttribute("data-viewname") || ""; }
		this._commitOrder(targetGroup);
	}

	// Reorder the backing array to match the group's new visual order, permuting
	// only the slots those items already occupy so other views are untouched.
	_commitOrder(group) {
		const ids = [...group.querySelectorAll(".ssq-opt")].map((r) => r.getAttribute("data-id"));
		const items = this._items();
		const byId = {};
		items.forEach((it) => { byId[it.id] = it; });
		const pos = [];
		items.forEach((it, i) => { if (ids.indexOf(it.id) >= 0) pos.push(i); });
		ids.forEach((id, k) => { if (byId[id]) items[pos[k]] = byId[id]; });
		this._touch();
		this._render();
		this._position();
	}

	// Inline title field. Names a new search (opts.query) or renames an existing one
	// (opts.editId + opts.title). A new search is filed under the current view; move
	// it to another view or make it global afterwards by dragging it between sections.
	_renameDialog(opts) {
		const ctx = this._popCtx;
		if (!this._pop || !ctx) return;
		const isRename = opts.editId != null;
		const query = opts.query;
		this._pop.innerHTML = "";
		this._rows = null;

		const hint = document.createElement("div");
		hint.className = "ssq-sec";
		hint.textContent = isRename ? "Rename search" : "Name this search";
		const sub = document.createElement("div");
		sub.className = "ssq-hint";
		sub.textContent = query;
		const input = document.createElement("input");
		input.className = "ssq-name";
		input.type = "text";
		input.placeholder = "Title";
		input.value = opts.title != null ? opts.title : this._suggestTitle(query, ctx);
		const foot = document.createElement("div");
		foot.className = "ssq-hint";
		foot.textContent = "Enter to save · Esc to cancel";

		this._pop.appendChild(hint);
		this._pop.appendChild(sub);
		this._pop.appendChild(input);
		this._pop.appendChild(foot);
		this._position();
		input.focus();
		input.select();

		input.addEventListener("keydown", (e) => {
			e.stopPropagation();
			if (e.key === "Enter") {
				e.preventDefault();
				const title = input.value.trim() || opts.title || this._suggestTitle(query, ctx);
				if (isRename) {
					const it = this._items().find((x) => x.id === opts.editId);
					if (it) it.title = title;
					this._touch();
					this._render();  // back to the list; nothing touched the field, so stay open
					this._position();
				} else {
					const id = "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
					this._items().push({
						id, title, query,
						col: ctx.col, colName: ctx.colName,
						viewId: ctx.viewId, viewName: ctx.viewName,
						ts: Date.now(),
					});
					// Treat the field as now holding this saved search, so tweaking it
					// and reopening offers "Update".
					this._loaded = { id, query };
					this._touch();
					// Stay open after saving — the popup only closes on an outside
					// click or when a search is chosen.
					this._render();
					this._position();
				}
			} else if (e.key === "Escape") {
				e.preventDefault();
				if (isRename) { this._render(); this._position(); } // back to list, keep open
				else this._closePopup();
			}
		});
	}

	// A first guess at a title: the query with its leading "@Collection." dropped,
	// since that part is the same for every search in the collection.
	_suggestTitle(query, ctx) {
		let t = query.replace(/^@[^\s.]+\.?\s*/, "").trim() || query;
		if (t.length > Plugin.TITLE_SUGGEST_MAX) t = t.slice(0, Plugin.TITLE_SUGGEST_MAX - 1).trim() + "…";
		return t;
	}

	// ── Global handlers ──────────────────────────────────────────────────────
	_onDocDown(e) {
		if (!this._pop) return;
		if (this._pop.contains(e.target)) return;
		if (this._popBtn && this._popBtn.contains(e.target)) return;
		this._closePopup();
	}

	_onKeyDown(e) {
		if (!this._pop) return;
		// While the name field is on screen it owns Enter/Escape (its own listener).
		if (this._pop.querySelector(".ssq-name")) return;
		if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); this._closePopup(); return; }
		if (!this._rows || !this._rows.length) return;
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			e.preventDefault(); e.stopPropagation();
			const n = this._rows.length;
			this._active = e.key === "ArrowDown"
				? (this._active + 1) % n
				: (this._active <= 0 ? n - 1 : this._active - 1);
			this._rows.forEach((r, i) => r.el.classList.toggle("ssq-active", i === this._active));
			const cur = this._rows[this._active].el;
			if (cur.scrollIntoView) cur.scrollIntoView({ block: "nearest" });
		} else if (e.key === "Enter" && this._active >= 0) {
			e.preventDefault(); e.stopPropagation();
			this._rows[this._active].run();
		}
	}
}
