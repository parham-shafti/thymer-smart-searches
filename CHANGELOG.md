# Changelog

## v1.1.0 — 2026-07-25

- **Collection-wide searches.** A saved search can now belong to the whole collection instead of a single view, under a "Whole collection" section that shows in every view.
- **Move searches between views by dragging.** Drag a search into another view's section to move it there, or into "Whole collection" to make it global. Empty sections appear as drop targets while you drag, so you can always drop into the current view or make a search global even when nothing is there yet. Dropped searches keep the exact position you release them at.

## v1.0.0 — 2026-07-24

First public release.

- Save the query in a collection view's filter field under a title, and re-run it from a bookmark button in the view's toolbar. The bookmark is filled when the collection already has saved searches.
- Grouped per collection; searches saved in the current view are listed first, the rest under "Other views" (grouping falls back to the focused view's config so it still works on mobile).
- Edit a saved search directly in the filter field: run it, tweak the query, and reopen to **Update** it in place, or **Save as a new search**. Rename via the pencil, delete via the trash, and drag the grip to reorder within a group.
- **Clear Search** button in the popup header to empty the filter field — especially useful on mobile.
- Stored in the plugin's configuration so it syncs across devices, mirrored to local storage as a safety net; the write is deferred until the filter field is empty so a plugin reload never wipes an in-progress query.
- Responsive: wider on desktop, full-width-minus-margin on mobile, clamped to stay fully on screen with the list scrolling inside.
