# Changelog

## v2.0.0 (2026-10-29)

Saved Searches is now **Smart Searches**. It started as a place to keep the queries you type; it is now a way to build them.

- **Build searches without typing syntax.** The bookmark button opens a query builder: pick a field, an operator and a value. Join conditions with AND, OR or NOT, and put conditions in groups when part of a search needs the other joiner. Groups go as deep as you need, each level indented. The filter updates while you build; Done keeps it and Cancel puts back what was there.
- **Saved searches show by name.** In the filter field a saved search appears as a chip with its name instead of its long query. Click the chip to open it in the builder, or the × to take it out. Chips combine with AND, OR and ordinary conditions.
- **Saved searches as building blocks.** "Add saved search" puts one into the builder as a single row. Fold it out to see or change its conditions. When the field holds exactly one saved search, "Update" saves your change to it.
- **A library instead of the popup.** Pick a saved search from a list grouped by this view, Whole collection and other views, with a filter. Rename, delete and drag to reorder or move from the same list, and start a new search from its last row.
- **Live Queries too.** A live query block on a page gets two buttons: edit it in the builder, and refresh its results. Keywords like `@page` work as they do in the block.
- **Dates the way you say them.** Date fields offer Today, This week, Next Friday and more, or Pick a date, which opens a full date picker where you can type "next friday" or "25 aug 2026". With Supertask installed, Supertask's own date picker opens.
- **Operators follow the field.** A choice field lists its options, a page link picks a page and adds "Is exactly" (because `=` on a link means contains), and Set / Not Set ask whether a field has a value at all.
- **Keyboard.** Arrow keys move between the controls, menus jump as you type, and ⌘C / ⌘V copy and paste a selected row or group.

Fixes:

- **The filter could stop working after settings were saved.** Right after a collection's or plugin's settings changed, the filter field could reject every query with `No collection "X"` until you switched views. Smart Searches now repairs the filter so it keeps working. (The cause is in Thymer and has been reported.)
- **Running a saved search in a sorted view** used to leave the rows in their old order. The view now sorts again.
- **More than one workspace.** If you used the plugin in two workspaces, one workspace's saved searches could be copied into the other. Each workspace now keeps its own.

Upgrading: your saved searches stay as they are. The old popup is gone; everything it did is in the builder and its library.

## v1.1.0 (2026-07-25)

- **Collection-wide searches.** A saved search can now belong to the whole collection instead of a single view, under a "Whole collection" section that shows in every view.
- **Move searches between views by dragging.** Drag a search into another view's section to move it there, or into "Whole collection" to make it global. Empty sections appear as drop targets while you drag, so you can always drop into the current view or make a search global even when nothing is there yet. Dropped searches keep the exact position you release them at.

## v1.0.0 (2026-07-24)

First public release.

- Save the query in a collection view's filter field under a title, and re-run it from a bookmark button in the view's toolbar. The bookmark is filled when the collection already has saved searches.
- Grouped per collection; searches saved in the current view are listed first, the rest under "Other views" (grouping falls back to the focused view's config so it still works on mobile).
- Edit a saved search directly in the filter field: run it, tweak the query, and reopen to **Update** it in place, or **Save as a new search**. Rename via the pencil, delete via the trash, and drag the grip to reorder within a group.
- **Clear Search** button in the popup header to empty the filter field, especially useful on mobile.
- Stored in the plugin's configuration so it syncs across devices, mirrored to local storage as a safety net; the write is deferred until the filter field is empty so a plugin reload never wipes an in-progress query.
- Responsive: wider on desktop, full-width-minus-margin on mobile, clamped to stay fully on screen with the list scrolling inside.
