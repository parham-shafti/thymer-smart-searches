// Tests the query builder's PURE logic — model→text (_qbCompile) and
// text→model (_qbParse) — by loading plugin.js itself, so the tests and the
// shipped code can never drift apart. No Thymer, no DOM:
//
//   node test-querybuilder.mjs
//
// What matters here is the ROUND TRIP. The reader is deliberately narrow: it
// recognises the shape this builder emits and carries everything else verbatim
// as a raw node. So for ANY query, compile(parse(q)) must come back equal to q
// — a query that is not understood must still be preserved exactly.
import { readFileSync } from 'fs';

const src = readFileSync(new URL('./plugin.js', import.meta.url), 'utf8');
class AppPlugin { constructor() {} }
const Plugin = new Function('AppPlugin', src + '\n; return Plugin;')(AppPlugin);

const p = new Plugin();
// A stand-in schema: just enough for _qbParseOperand to resolve a field's type.
p._qbCols = [
	{ name: 'Person', guid: 'G1', icon: '', fields: [
		{ label: 'Contact Stage', type: 'choice', choices: [] },
		{ label: 'Habitat', type: 'record' },
		{ label: 'Modified', type: 'datetime' },
		{ label: 'Note', type: 'text' },
	] },
	{ name: 'Actions', guid: 'G2', icon: '', fields: [
		{ label: 'Title', type: 'text' },
		{ label: 'Points', type: 'number' },
		{ label: 'Due Date', type: 'datetime' },
		{ label: 'Action Status', type: 'record' },
	] },
	{ name: 'Incomes', guid: 'G3', icon: '', fields: [
		{ label: 'Due Date', type: 'datetime' },
		{ label: 'Action Status', type: 'record' },
	] },
	{ name: 'Expenses', guid: 'G4', icon: '', fields: [
		{ label: 'Title', type: 'text' },
		{ label: 'Due Date', type: 'datetime' },
		{ label: 'Action Status', type: 'record' },
	] },
];

let fails = 0;
const check = (name, got, want) => {
	const ok = String(got) === String(want);
	if (!ok) fails++;
	console.log((ok ? '  PASS  ' : '  FAIL  ') + name);
	if (!ok) console.log('          got  ' + got + '\n          want ' + want);
};
const cond = (src, field, type, op, value) => ({ kind: 'cond', src, field, type, op, value });
const group = (join, ...rows) => ({ kind: 'group', join, rows });

// ── model → text ────────────────────────────────────────────────────────────
console.log('\ncompile');
check('one condition',
	p._qbCompile(group('AND', cond('Person', 'Contact Stage', 'choice', '=', 'Lead'))),
	'@Person."Contact Stage" = "Lead"');
check('unquoted name when it does not need quotes',
	p._qbCompile(group('AND', cond('Actions', 'Title', 'text', '=', 'x'))),
	'@Actions.Title = "x"');
check('two joined with AND',
	p._qbCompile(group('AND', cond('Actions', 'Title', 'text', '=', 'a'), cond('Actions', 'Points', 'number', '>', '3'))),
	'@Actions.Title = "a" AND @Actions.Points > 3');
check('is empty compiles to = ""',
	p._qbCompile(group('AND', cond('Person', 'Habitat', 'record', '=|e', ''))),
	'@Person.Habitat = ""');
check('an unfinished row contributes nothing',
	p._qbCompile(group('AND', cond('Actions', 'Title', 'text', '=', 'a'), cond('Actions', 'Points', 'number', '=', ''))),
	'@Actions.Title = "a"');

console.log('\ncompile — groups get brackets only where precedence needs them');
check('A AND (B OR C) — required',
	p._qbCompile(group('AND',
		cond('Actions', 'Title', 'text', '=', 'a'),
		group('OR', cond('Actions', 'Title', 'text', '=', 'b'), cond('Actions', 'Title', 'text', '=', 'c')))),
	'@Actions.Title = "a" AND (@Actions.Title = "b" OR @Actions.Title = "c")');
check('A OR (B OR C) — an explicit group keeps its parentheses',
	p._qbCompile(group('OR',
		cond('Actions', 'Title', 'text', '=', 'a'),
		group('OR', cond('Actions', 'Title', 'text', '=', 'b'), cond('Actions', 'Title', 'text', '=', 'c')))),
	'@Actions.Title = "a" OR (@Actions.Title = "b" OR @Actions.Title = "c")');
check('A OR (B AND C) — kept even where precedence would not need it',
	p._qbCompile(group('OR',
		cond('Actions', 'Title', 'text', '=', 'a'),
		group('AND', cond('Actions', 'Title', 'text', '=', 'b'), cond('Actions', 'Title', 'text', '=', 'c')))),
	'@Actions.Title = "a" OR (@Actions.Title = "b" AND @Actions.Title = "c")');
check('an empty group disappears',
	p._qbCompile(group('AND', cond('Actions', 'Title', 'text', '=', 'a'), group('OR'))),
	'@Actions.Title = "a"');

console.log('\nlegacy models still open');
check('a pre-groups model (flat rows, separate base)',
	p._qbCompile(p._qbNormalize({ join: 'AND', base: { query: '@todo' }, rows: [{ src: 'Actions', field: 'Title', type: 'text', op: '=', value: 'a' }] })),
	'@todo AND @Actions.Title = "a"');

// ── text → model → text ─────────────────────────────────────────────────────
// Joins are PER ROW now: the shape prints as rows.length + '/' + each row's
// joiner to the previous one ('2/OR' = two rows, the second ORed on).
const shape = (m) => m.rows.length + '/' + (m.rows.length > 1 ? m.rows.slice(1).map((r) => r.j || 'AND').join(',') : m.join);
const trip = (name, q, wantRows) => {
	const m = p._qbParse(q);
	check('round trip: ' + name, p._qbCompile(m), q);
	if (wantRows != null) check('  ↳ top-level rows: ' + name, shape(m), wantRows);
};

console.log('\nparse — the builder\'s own shape');
trip('single condition', '@Person."Contact Stage" = "Lead"', '1/AND');
trip('two with OR', '@Person."Contact Stage" = "Prospects" OR @Person."Contact Stage" = "Lead"', '2/OR');
trip('two with AND', '@Actions.Title = "a" AND @Actions.Points >= 3', '2/AND');

console.log('\nparse — what used to fall back wholesale');
trip('mixed AND/OR at one level — ONE flat box now', '@Actions.Title = "a" AND @Actions.Title = "b" OR @Actions.Title = "c"', '3/AND,OR');
trip('explicit bracket group', '(@Actions.Title = "a" OR @Actions.Title = "b") AND @Actions.Title = "c"', '2/AND');
// Negation is PER NODE now (his round-3 call): `AND NOT x` comes back as a
// negated ROW on an AND level, and re-emits with explicit brackets — the NOT
// joiner is gone from the reader (legacy models still compile, see below).
{
	const m = p._qbParse('@todo AND NOT @Person.Habitat = "My Areas"');
	check('NOT comes back as a negated row', m.rows.length + '/' + m.join + '/' + m.rows[1].neg, '2/AND/true');
	check('…compiling with explicit brackets', p._qbCompile(m), '@todo AND NOT (@Person.Habitat = "My Areas")');
}
trip('a bare keyword', '@today', '1/AND');
trip('a hashtag', '#ideas AND @Actions.Title = "a"', '2/AND');
{
	const m = p._qbParse('@todo AND NOT @Person.Habitat = "a" AND NOT @Person.Habitat = "b"');
	check('chained NOTs are chained negated rows', m.rows.length + '/' + m.join + '/' + m.rows[1].neg + m.rows[2].neg, '3/AND/truetrue');
	check('…and compile bracketed', p._qbCompile(m), '@todo AND NOT (@Person.Habitat = "a") AND NOT (@Person.Habitat = "b")');
}
// A MIX cannot be said with one joiner. The negated part used to stay a raw
// chip; it is a negated ROW now (per-row NOT), compiling with explicit
// brackets — byte-different, semantically identical (NOT takes one term).
{
	const q = '@Actions.Title = "a" AND @Actions.Title = "b" AND NOT @Actions.Title = "c"';
	const m = p._qbParse(q);
	check('a mix of AND and AND NOT: the negated part is a row now',
		p._qbCompile(m), '@Actions.Title = "a" AND @Actions.Title = "b" AND NOT (@Actions.Title = "c")');
	check('  ↳ top-level rows + neg flag', m.rows.length + '/' + m.join + '/' + m.rows[2].neg, '3/AND/true');
}
trip('an unknown collection is carried, not mangled', '@Nope.Field = "x" OR @Actions.Title = "a"', '2/OR');

console.log('\nparse — the traps');
trip('AND inside a quoted value', '@Actions.Title = "cats and dogs"', '1/AND');
trip('OR inside a quoted value', '@Actions.Title = "or else"', '1/AND');
trip('brackets inside a quoted value', '@Actions.Title = "foo (bar)"', '1/AND');
trip('unbalanced brackets are left alone', '@Actions.Title = "a" AND (broken', '1/AND');
// The round trip is SEMANTIC, not byte-exact: brackets the precedence rules do
// not require are dropped BETWEEN levels the reader flattened, which is the
// builder's documented behaviour (AND binds tighter than OR, proven empirically
// against the app). An explicit GROUP is the exception: its brackets always
// survive, one row or many, because the group only exists as those brackets.
check('deep nesting: byte-identical now that groups keep their parentheses',
	p._qbCompile(p._qbParse('@Actions.Title = "a" AND (@Actions.Title = "b" OR (@Actions.Title = "c" AND (@Actions.Title = "d" OR @Actions.Title = "e")))')),
	'@Actions.Title = "a" AND (@Actions.Title = "b" OR (@Actions.Title = "c" AND (@Actions.Title = "d" OR @Actions.Title = "e")))');
// Brackets around a LONE condition are a group the user built, and a live query
// stores only text — so they are kept on both sides now. Dropping them dissolved
// his one-row group into a loose row on reopen (his report 2026-08-15).
check('a bracket round a lone condition survives the round trip',
	p._qbCompile(p._qbParse('(@Actions.Title = "a") AND @Actions.Points > 3')),
	'(@Actions.Title = "a") AND @Actions.Points > 3');
check('…and it comes back as a GROUP, not a loose row', (function () {
	const b = p._qbNormalize(p._qbParse('(@Actions.Title = "a") AND @Actions.Points > 3'));
	return p._qbKind(b.rows[0]) + '/' + b.rows[0].rows.length;
})(), 'group/1');
check('a required bracket is kept',
	p._qbCompile(p._qbParse('(@Actions.Title = "a" OR @Actions.Title = "b") AND @Actions.Points > 3')),
	'(@Actions.Title = "a" OR @Actions.Title = "b") AND @Actions.Points > 3');

const m = p._qbParse('@Actions.Title = "a" AND (@Actions.Title = "b" OR @Actions.Title = "c")');
check('a bracket group parses INTO a group node', p._qbKind(m.rows[1]) + '/' + (m.rows[1].rows[1].j || 'AND'), 'group/OR');
check('and its children are real conditions', p._qbKind(m.rows[1].rows[0]), 'cond');
// @today is a real row now (the "Date is" family), so the raw-node fallback is
// probed with a keyword that really is unknown.
const raw = p._qbParse('@frobnicate AND @Actions.Title = "a"');
check('an unrecognised leaf is a raw node', p._qbKind(raw.rows[0]) + '/' + raw.rows[0].query, 'raw/@frobnicate');
check('its neighbour is still editable', p._qbKind(raw.rows[1]) + '/' + raw.rows[1].field, 'cond/Title');

console.log('\nthe NOT joiner (legacy models only — the UI is per-row NOT now)');
check('a legacy NOT-join model normalises to AND + negated rows',
	p._qbCompile(p._qbNormalize({ join: 'NOT', rows: [
		{ src: 'Actions', field: 'Title', type: 'text', op: '=', value: 'a' },
		{ src: 'Actions', field: 'Title', type: 'text', op: '=', value: 'b' },
	] })),
	'@Actions.Title = "a" AND NOT (@Actions.Title = "b")');
check('excludes with AND NOT',
	p._qbCompile(group('NOT', cond('Actions', 'Title', 'text', '=', 'a'), cond('Actions', 'Title', 'text', '=', 'b'))),
	'@Actions.Title = "a" AND NOT @Actions.Title = "b"');
check('brackets what it excludes, or NOT would take only the first term',
	p._qbCompile(group('NOT',
		cond('Actions', 'Title', 'text', '=', 'a'),
		group('OR', cond('Actions', 'Title', 'text', '=', 'b'), cond('Actions', 'Title', 'text', '=', 'c')))),
	'@Actions.Title = "a" AND NOT (@Actions.Title = "b" OR @Actions.Title = "c")');
check('and brackets an OR head too',
	p._qbCompile(group('NOT',
		group('OR', cond('Actions', 'Title', 'text', '=', 'a'), cond('Actions', 'Title', 'text', '=', 'b')),
		cond('Actions', 'Title', 'text', '=', 'c'))),
	'(@Actions.Title = "a" OR @Actions.Title = "b") AND NOT @Actions.Title = "c"');
check('three parts chain the exclusion',
	p._qbCompile(group('NOT', cond('Actions', 'Title', 'text', '=', 'a'), cond('Actions', 'Title', 'text', '=', 'b'), cond('Actions', 'Title', 'text', '=', 'c'))),
	'@Actions.Title = "a" AND NOT @Actions.Title = "b" AND NOT @Actions.Title = "c"');

console.log('\n"Any item" — the built-ins');
const bi = (field, type, op, value) => ({ kind: 'cond', src: 'Any item', field, type, op, value });
check('a status keyword', p._qbCompile(group('AND', bi('Status', 'bi-kw', '=', 'Todo (not done) tasks'))), '@todo');
check('a negated keyword', p._qbCompile(group('AND', bi('Status', 'bi-kw', '!=', 'Waiting (Blocked)'))), 'NOT @waiting');
check('an item type', p._qbCompile(group('AND', bi('Type', 'bi-kw', '=', 'Headings'))), '@heading');
check('a hashtag', p._qbCompile(group('AND', bi('Hashtag', 'bi-tag', '=', 'lateafternoon'))), '#lateafternoon');
check('a collection, quoted only when needed',
	p._qbCompile(group('AND', bi('Collection', 'bi-coll', '=', 'Person'))), '@Person');
check('a keyed date with a rolling token', p._qbCompile(group('AND', bi('Due', 'bi-date', '<=', '@today'))), '@due <= @today');
check('a keyed date with an exact day', p._qbCompile(group('AND', bi('Created', 'bi-date', '>=', '2026-08-01'))), '@created_at >= "2026-08-01"');
check('a user key', p._qbCompile(group('AND', bi('Created by', 'bi-user', '=', 'Parham'))), '@created_by = "Parham"');
check('a collection date with a rolling token',
	p._qbCompile(group('AND', cond('Actions', 'Due Date', 'datetime', '=', '@thisweek'))), '@Actions."Due Date" = @thisweek');

console.log('\n"Any item" — read back');
trip('a lone keyword becomes a row', '@todo AND @overdue', '2/AND');
// Mixed negation stays an AND level: each negated part becomes an "Is not" ROW
// rather than forcing the whole level onto the NOT joiner.
trip('his combo, explicit operators', '@todo AND @today AND NOT @waiting AND #lateafternoon AND NOT @canceled', '5/AND,AND,AND,AND');
trip('a rolling token on a property', '@Actions."Due Date" = @thisweek OR @Actions."Due Date" = "-monday"', '2/OR');
trip('keyed builtin with token', '@due <= @today AND #ideas', '2/AND');
const biM = p._qbParse('@todo AND @overdue');
check('keywords land as Status rows', biM.rows.map((r) => p._qbKind(r) + ':' + r.field).join(','), 'cond:Status,cond:Status');
const dt = p._qbParse('@Actions."Due Date" = @thisweek');
check('the token value survives verbatim', dt.rows[0] && dt.rows[0].value, '@thisweek');
check('his weekly-plan shape round-trips',
	p._qbCompile(p._qbParse('@Page AND ((@Actions."Due Date" = "-monday" OR @Actions."Due Date" = @today) AND @Actions."Due Date" = @thisweek AND (@Actions."Action Status" = "In Progress" OR @Actions."Action Status" = "Need Attention"))')),
	// Keywords canonicalise to lowercase (@Page -> @page; the engine is case-
	// insensitive, verified with the CLI) - a semantic round trip, like brackets.
	'@page AND ((@Actions."Due Date" = "-monday" OR @Actions."Due Date" = @today) AND @Actions."Due Date" = @thisweek AND (@Actions."Action Status" = "In Progress" OR @Actions."Action Status" = "Need Attention"))');

// ── The engine's grammar, as the SDK documents it ───────────────────────────
// Lowercase and/or/not, implicit AND between adjacent terms, bare (unquoted)
// date values. These are HIS live queries, typed long before the builder
// existed. The round trip here is SEMANTIC: the reader canonicalises (uppercase
// joiners, adjacency spelled out as AND, bare/token dates emitted quoted, @Page
// → @page) without ever changing what the query matches.
console.log('\nthe engine grammar — lowercase, adjacency, not, bare dates');
const canon = (name, q, want, wantRows) => {
	const m = p._qbParse(q);
	check('canonical: ' + name, p._qbCompile(m), want);
	if (wantRows != null) check('  ↳ top-level rows: ' + name, shape(m), wantRows);
};
canon('lowercase and', '@todo and @due = "monday"', '@todo AND @due = "monday"', '2/AND');
canon('adjacency + lowercase not', '@todo @nextweek not @overdue',
	'@todo AND @nextweek AND NOT @overdue', '3/AND,AND');
canon('his combined strip query',
	'@waiting @today and @waiting not @canceled or @overdue and @waiting not @canceled',
	'@waiting AND @today AND @waiting AND NOT @canceled OR @overdue AND @waiting AND NOT @canceled', '7/AND,AND,AND,OR,AND,AND');
check('…and every leaf of it is an editable row (no raw chips)',
	JSON.stringify(p._qbParse('@waiting @today and @waiting not @canceled or @overdue and @waiting not @canceled')).indexOf('"raw"'), -1);
canon('a bare date value on a keyed builtin', '@due <= today', '@due <= "today"', '1/AND');
canon('a bare date value on a collection property', '@Actions."Due Date" <= today',
	'@Actions."Due Date" <= "today"', '1/AND');
canon('(group) @Page — adjacency after brackets',
	'(@Expenses."Due Date" = "in 2 week" AND @Expenses."Action Status" = "In Progress") @Page',
	'(@Expenses."Due Date" = "in 2 week" AND @Expenses."Action Status" = "In Progress") AND @page', '2/AND');
canon('plain words stay ONE text search', 'meeting notes @todo', 'meeting notes AND @todo', '2/AND');

console.log('\nhis five-collection live query');
const bigOp = (coll, both) => '(@' + coll + '."Due Date" <= today AND ' + (both
	? '(@' + coll + '."Action Status" = "In Progress" OR @' + coll + '."Action Status" = "Need Attention"))'
	: '@' + coll + '."Action Status" = "In Progress")');
const bigQ = [bigOp('Actions', true), bigOp('Incomes', true), bigOp('Expenses', false)].join('  OR ');
const bigM = p._qbParse(bigQ);
check('top level: one OR per collection', shape(bigM), '3/OR,OR');
check('every leaf is an editable row (no raw chips)', JSON.stringify(bigM).indexOf('"raw"'), -1);
check('compiles canonical (bare today → quoted, brackets only where needed)',
	p._qbCompile(bigM),
	'(@Actions."Due Date" <= "today" AND (@Actions."Action Status" = "In Progress" OR @Actions."Action Status" = "Need Attention"))'
	+ ' OR (@Incomes."Due Date" <= "today" AND (@Incomes."Action Status" = "In Progress" OR @Incomes."Action Status" = "Need Attention"))'
	+ ' OR (@Expenses."Due Date" <= "today" AND @Expenses."Action Status" = "In Progress")');
check('the ≤ glyph reads the same as <=',
	p._qbCompile(p._qbParse('@Actions."Due Date" ≤ today AND @Actions."Action Status" = "In Progress"')),
	'@Actions."Due Date" <= "today" AND @Actions."Action Status" = "In Progress"');

// ── Per-row NOT (the pill on every condition row) ───────────────────────────
// `NOT (one condition)` in a MIXED level cannot use the NOT joiner, so it used
// to fall back to a verbatim chip (his 2026-08-14 report, the five-collection
// query with "AND NOT (Due Date <= today) AND @Page" in every branch). It is a
// negated ROW now: keyword families negate through their operator, everything
// else through the row's `neg` flag, which compiles wrapped.
console.log('\nper-row NOT');
{
	const m = p._qbParse('NOT (@Actions."Due Date" <= today)');
	check('NOT (comparison) is a negated cond row', p._qbKind(m.rows[0]) + '/' + m.rows[0].field + '/' + m.rows[0].neg, 'cond/Due Date/true');
	check('…compiling wrapped, value canonically quoted', p._qbCompile(m), 'NOT (@Actions."Due Date" <= "today")');
}
canon('his mixed-negation branch',
	'@Actions."Action Status" = "In Progress" AND NOT (@Actions."Due Date" <= today) AND @Page',
	'@Actions."Action Status" = "In Progress" AND NOT (@Actions."Due Date" <= "today") AND @page', '3/AND,AND');
check('…with zero raw chips',
	JSON.stringify(p._qbParse('@Actions."Action Status" = "In Progress" AND NOT (@Actions."Due Date" <= today) AND @Page')).indexOf('"raw"'), -1);
{
	const m = p._qbParse('@todo AND NOT (@due <= today) AND #x');
	check('a negated KEYED builtin is a row too', p._qbKind(m.rows[1]) + '/' + m.rows[1].field + '/' + m.rows[1].neg, 'cond/Due/true');
	check('…and compiles wrapped', p._qbCompile(m), '@todo AND NOT (@due <= "today") AND #x');
}
check('NOT (a record condition) round-trips bytes',
	p._qbCompile(p._qbParse('@Actions.Title = "a" AND NOT (@Actions."Action Status" = "Source item") AND @page')),
	'@Actions.Title = "a" AND NOT (@Actions."Action Status" = "Source item") AND @page');
{
	const m = p._qbParse('@todo AND NOT (@a = "1" OR @b = "2") AND #x');
	check('a negated GROUP is an editable group now', p._qbKind(m.rows[1]) + '/' + m.rows[1].neg + '/' + (m.rows[1].rows[1].j || 'AND'), 'group/true/OR');
	check('…compiling byte-identical', p._qbCompile(m), '@todo AND NOT (@a = "1" OR @b = "2") AND #x');
}
check('a lone NOT (collection keyword) negates through the operator',
	p._qbCompile(p._qbParse('NOT (@Person)')), 'NOT @Person');

console.log('\nNOT over an implicit AND gets its brackets');
check('a raw adjacency part is bracketed under the NOT joiner',
	p._qbCompile(group('NOT',
		cond('Actions', 'Title', 'text', '=', 'a'),
		{ kind: 'raw', query: '@frob @nicate', title: '' })),
	'@Actions.Title = "a" AND NOT (@frob @nicate)');

console.log('\nper-row joiners — one box mixes AND/OR freely');
p._qb = { defaultSrc: 'Actions', model: null };
{
	// Four flat rows, the third ORed on — his two-collection shape WITHOUT any
	// groups: (A AND B) OR (C AND D) comes straight from the row joiners.
	const m2 = { kind: 'group', join: 'AND', rows: [
		cond('Actions', 'Title', 'text', '=', 'a'),
		Object.assign(cond('Actions', 'Title', 'text', '=', 'b'), { j: 'AND' }),
		Object.assign(cond('Expenses', 'Title', 'text', '=', 'c'), { j: 'OR' }),
		Object.assign(cond('Expenses', 'Title', 'text', '=', 'd'), { j: 'AND' }),
	] };
	const q2 = p._qbCompile(m2);
	check('(A AND B) OR (C AND D) from row joiners alone', q2,
		'@Actions.Title = "a" AND @Actions.Title = "b" OR @Expenses.Title = "c" AND @Expenses.Title = "d"');
	const back = p._qbParse(q2);
	check('…and it reopens FLAT with the same joiners', shape(back), '4/AND,OR,AND');
	// An unfinished row's joiner must not leak into the text.
	m2.rows.splice(2, 0, Object.assign(cond('', '', 'plaintext', '=', ''), { j: 'OR' }));
	check('an empty row drops out, joiner and all', p._qbCompile(m2), q2);
}
{
	// "Add condition group" on the ROOT appends; on a GROUP's box it creates a
	// PARALLEL sibling right after that group (his call — no eternal nesting).
	const m3 = { kind: 'group', join: 'AND', rows: [cond('Actions', 'Title', 'text', '=', 'a')] };
	p._qb.model = m3;
	p._qbAddGroup(m3);
	check('root: a new group is appended as its own box', m3.rows.map((n) => p._qbKind(n)).join(','), 'cond,group');
	check('…opening on AND', m3.rows[1].join + '/' + m3.rows[1].j, 'AND/AND');
	check('…and empty it adds nothing to the text', p._qbCompile(m3), '@Actions.Title = "a"');
	// press it in the nested group's box → sibling, not child
	const gA = m3.rows[1];
	gA.rows = [cond('Expenses', 'Title', 'text', '=', 'b')];
	p._qbAddGroup(gA);
	check('group box: the new group lands as a PARALLEL sibling', m3.rows.map((n) => p._qbKind(n)).join(','), 'cond,group,group');
	check('…right after the group it was pressed in', gA === m3.rows[1] && p._qbKind(m3.rows[2]) === 'group', true);
	check('…and gA itself gained no child group', gA.rows.map((n) => p._qbKind(n)).join(','), 'cond');
}
p._qb = null;

// His weekly plan: @Page factored ONCE at the top over an OR of per-collection
// groups — the shape the builder should make easy. Lowercase and/or, nested
// three deep, still inside the depth cap; canonicalisation drops only the
// per-collection brackets AND does not need (AND binds tighter than OR).
console.log('\nhis weekly plan — @Page factored over the OR-groups');
{
	const wq = '@Page and ('
		+ '(@Actions."Due Date" = "-monday" and (@Actions."Action Status" = "In Progress" or @Actions."Action Status" = "Need Attention"))'
		+ ' or (@Incomes."Due Date" = "-monday" and (@Incomes."Action Status" = "In Progress" or @Incomes."Action Status" = "Need Attention"))'
		+ ' or (@Expenses."Due Date" = "-monday" and @Expenses."Action Status" = "In Progress"))';
	const m = p._qbParse(wq);
	check('top level: Page AND (the OR of groups)', m.join + '/' + m.rows.length + '/' + p._qbKind(m.rows[0]) + '/' + p._qbKind(m.rows[1]), 'AND/2/cond/group');
	check('the OR level holds one group per collection', (m.rows[1].rows[1].j || 'AND') + '/' + m.rows[1].rows.length, 'OR/3');
	check('no raw chips anywhere', JSON.stringify(m).indexOf('"raw"'), -1);
	check('canonical compile — his parentheses survive', p._qbCompile(m),
		'@page AND ((@Actions."Due Date" = "-monday" AND (@Actions."Action Status" = "In Progress" OR @Actions."Action Status" = "Need Attention"))'
		+ ' OR (@Incomes."Due Date" = "-monday" AND (@Incomes."Action Status" = "In Progress" OR @Incomes."Action Status" = "Need Attention"))'
		+ ' OR (@Expenses."Due Date" = "-monday" AND @Expenses."Action Status" = "In Progress"))');
}

// Mixed joiners inside ONE box read top-down with the engine's precedence.
console.log('\nper-row joiners — precedence in the text');
{
	const g = { kind: 'group', join: 'AND', rows: [
		cond('Actions', 'Title', 'text', '=', 'a'),
		Object.assign(cond('Actions', 'Title', 'text', '=', 'b'), { j: 'OR' }),
		Object.assign(cond('Actions', 'Title', 'text', '=', 'c'), { j: 'OR' }),
	] };
	check('a OR b OR c stays bracket-free', p._qbCompile(g),
		'@Actions.Title = "a" OR @Actions.Title = "b" OR @Actions.Title = "c"');
	g.rows[2].j = 'AND';
	check('a OR b AND c — AND binds tighter, no brackets needed', p._qbCompile(g),
		'@Actions.Title = "a" OR @Actions.Title = "b" AND @Actions.Title = "c"');
}

// Drag-move at the model level: within a group, across groups, and out into
// a brand-new one (the drop zone).
console.log('\nmoving rows');
p._qb = { defaultSrc: 'Actions', model: null };
{
	const m = p._qbNormalize({ join: 'AND', rows: [
		cond('Actions', 'Title', 'text', '=', 'a'),
		cond('Actions', 'Title', 'text', '=', 'b'),
		cond('Actions', 'Title', 'text', '=', 'c'),
	] });
	p._qb.model = m;
	p._qbMoveRow('2', { path: '', index: 0 });
	check('reorder within the level', p._qbCompile(m), '@Actions.Title = "c" AND @Actions.Title = "a" AND @Actions.Title = "b"');
	p._qbMoveRow('0', { newGroup: true });
	// A one-row group compiles bare — `(x)` would be stripped on read anyway —
	// so the new box earns its parentheses when its second row arrives.
	check('drop on the zone → the row lands in a NEW group at the end',
		m.rows.map((n) => p._qbKind(n)).join(',') + '/' + p._qbCompile(m),
		'cond,cond,group/@Actions.Title = "a" AND @Actions.Title = "b" AND (@Actions.Title = "c")');
	p._qbMoveRow('0', { path: '2', index: 1 });
	check('move INTO a group', p._qbCompile(m), '@Actions.Title = "b" AND (@Actions.Title = "c" AND @Actions.Title = "a")');
}
p._qb = null;

// A new-group drop zone sits in EVERY gap, so a row can become a group right
// below the one it came from — not only at the very bottom (his report).
// A one-row group is a real group: it must still be one after the text has been
// written to a live query block and read back (his bug — it came back as a loose
// row between two groups, with no header of its own).
console.log('\na one-row group survives a live-query round trip');
{
	const m = p._qbNormalize({ join: 'AND', rows: [
		{ kind: 'group', join: 'AND', rows: [cond('Actions', 'Title', 'text', '=', 'a'),
			{ ...cond('Actions', 'Title', 'text', '=', 'b'), j: 'OR' }] },
		{ kind: 'group', join: 'AND', j: 'OR', rows: [cond('Expenses', 'Due Date', 'datetime', '<=', 'today')] },
	] });
	const back = p._qbNormalize(p._qbParse(p._qbCompile(m)));
	check('both groups come back as groups', back.rows.map((n) => p._qbKind(n)).join(','), 'group,group');
	check('and the text is byte-identical', p._qbCompile(back), p._qbCompile(m));
}

// Grip-click selects a row, cmd+C copies it, selecting a group and cmd+V pastes
// a DEEP copy into it (his ask 2026-08-15). Model level: the keys just call these.
// "Is exactly" on a page link: `=` is a CONTAINS in the engine, so Morning also
// matched Early Morning (his report). The operator pins the page's identity by
// compiling the name test AND @linkto = "<guid>", and the pair reads back as ONE
// row so the builder shows what the user built.
console.log('\nIs exactly on a page link');
{
	const exact = { kind: 'cond', src: 'Actions', field: 'Action Status', type: 'record',
		op: '=|x', value: 'Morning', vguid: 'GUIDMORNING', j: 'AND' };
	const m = p._qbNormalize({ join: 'AND', rows: [exact] });
	const text = '@Actions."Action Status" = "Morning" AND @linkto = "GUIDMORNING"';
	check('it compiles to the name test plus the identity test', p._qbCompile(m), text);
	const back = p._qbNormalize(p._qbParse(text));
	check('and the pair folds back into ONE row', back.rows.length, 1);
	check('…wearing the exact operator', back.rows[0].op, '=|x');
	check('…keeping the page guid', back.rows[0].vguid, 'GUIDMORNING');
	check('…byte-identical on the way out', p._qbCompile(back), text);
	// Without a guid there is nothing to pin: the row stays an ordinary contains
	// rather than compiling to nothing.
	const noGuid = p._qbNormalize({ join: 'AND', rows: [
		{ kind: 'cond', src: 'Actions', field: 'Action Status', type: 'record',
		  op: '=|x', value: 'Morning', j: 'AND' } ] });
	check('a guid-less exact row falls back to contains', p._qbCompile(noGuid),
		'@Actions."Action Status" = "Morning"');
	// A lone @linkto the builder did not write stays a verbatim chip.
	const lone = p._qbNormalize(p._qbParse('@linkto = "GUIDX" AND @Actions.Title = "a"'));
	check('a lone @linkto is left as its own chip', p._qbKind(lone.rows[0]), 'raw');
}

// Switching the OPERATOR must pin the page itself, not hope the value list was
// already loaded: his five rows kept falling back to Contains because only the
// warmed ones could find a guid (measured: cold cache = 0 of 5).
console.log('\nIs exactly resolves its guid when the operator is picked');
{
	p._qbRecCache = { 'Actions|Action Status': [{ name: 'Morning', guid: 'GUIDMORNING' }] };
	p._qb = { defaultSrc: 'Actions', model: null };
	p._qbEl = null;
	const row = { kind: 'cond', src: 'Actions', field: 'Action Status', type: 'record',
		op: '=', value: 'Morning', j: 'AND' };
	p._qb.model = p._qbNormalize({ join: 'AND', rows: [row] });
	const r0 = p._qb.model.rows[0];
	// _qbPickOp is async — AWAIT it. Chaining a .then() here let the suite finish
	// and exit before the checks ran, which reports a green that never happened.
	await p._qbPickOp(r0, '=|x');
	check('the operator sticks', r0.op, '=|x');
	check('and the page guid came with it', r0.vguid, 'GUIDMORNING');
	check('…and it compiles to the identity test', p._qbCompile(p._qb.model),
		'@Actions."Action Status" = "Morning" AND @linkto = "GUIDMORNING"');
	// A value that names no page must not pretend to be exact.
	const bad = p._qbNormalize({ join: 'AND', rows: [{ kind: 'cond', src: 'Actions',
		field: 'Action Status', type: 'record', op: '=', value: 'Nonesuch', j: 'AND' }] }).rows[0];
	await p._qbPickOp(bad, '=|x');
	check('an unresolvable value stays Contains', bad.op, '=');
}
p._qb = null; p._qbRecCache = null;

console.log('\ncopy and paste a row or a group');
p._qb = { defaultSrc: 'Actions', model: null };
{
	const m = p._qbNormalize({ join: 'AND', rows: [
		cond('Actions', 'Title', 'text', '=', 'a'),
		{ kind: 'group', join: 'AND', j: 'OR', rows: [cond('Expenses', 'Title', 'text', '=', 'b')] },
	] });
	p._qb.model = m; p._qbEl = null; p._qbClip = null;
	const row = m.rows[0], grp = m.rows[1];
	p._qb.sel = row;
	check('copy needs a selection and takes one', p._qbCopySel(), true);
	p._qb.sel = grp;
	check('paste lands INSIDE the selected group', p._qbPasteSel() && grp.rows.length, 2);
	check('…as a copy, not the original', grp.rows[1] === row, false);
	// Compiled as a ROOT here, so no parentheses — those are added when a group
	// sits INSIDE another one (_qbNodeQuery), which is not what this checks.
	check('…carrying the same condition', p._qbCompile(grp),
		'@Expenses.Title = "b" AND @Actions.Title = "a"');
	// The pasted node is the new selection, so a second paste chains under it.
	p._qbPasteSel();
	check('a second paste lands after the first', grp.rows.length, 3);
	// Editing the original must not reach the copies.
	row.value = 'CHANGED';
	check('the copies are independent', p._qbCompile(grp).indexOf('CHANGED'), -1);
	// A condition pasted into a group with a NESTED group inside joins the
	// group's own BOX, not the tail after the sub-groups (his report: it landed
	// "utanför i en separat egen grupp"). Same placement as Add condition.
	{
		const branch = { kind: 'group', join: 'AND', j: 'AND', rows: [
			cond('Actions', 'Due Date', 'datetime', '<=', 'today'),
			{ kind: 'group', join: 'AND', j: 'AND', rows: [cond('Actions', 'Title', 'text', '=', 'x')] },
		] };
		m.rows.push(branch);
		p._qb.sel = m.rows[0];            // a plain condition row
		p._qbCopySel();
		p._qb.sel = branch;
		p._qbPasteSel();
		check('a pasted condition joins the box, before the nested group',
			branch.rows.map((n) => p._qbKind(n)).join(','), 'cond,cond,group');
	}

	// A whole GROUP copies too, and pasting it after a row keeps it a group.
	p._qb.sel = grp; p._qbCopySel();
	p._qb.sel = m.rows[0];
	p._qbPasteSel();
	check('a copied group pastes as a group, right after the row',
		p._qbKind(m.rows[1]), 'group');
	check('…without disturbing the original', p._qbKind(m.rows[2]), 'group');
}
p._qb = null; p._qbClip = null;

console.log('\nnew group at a chosen slot');
p._qb = { defaultSrc: 'Actions', model: null };
{
	const m = p._qbNormalize({ join: 'AND', rows: [
		cond('Actions', 'Title', 'text', '=', 'a'),
		cond('Actions', 'Title', 'text', '=', 'b'),
		cond('Actions', 'Title', 'text', '=', 'c'),
	] });
	p._qb.model = m;
	p._qbEl = null;
	p._qbMoveRow('2', { newGroup: true, at: 1 });
	check('the new group lands in the gap it was dropped in',
		m.rows.map((n) => p._qbKind(n)).join(','), 'cond,group,cond');
	check('…holding the dragged row', p._qbCompile(m.rows[1]), '@Actions.Title = "c"');
}
p._qb = null;

// Swapping a row's COLLECTION keeps field/operator/value when the new one has
// the same field — the point of duplicating a group (his ask 2026-08-15).
console.log('\nswapping a collection keeps what still fits');
{
	const row = { kind: 'cond', src: 'Actions', field: 'Due Date', type: 'datetime', op: '<=', value: 'today' };
	p._qbApplySrcPick(row, 'Incomes');
	check('same field and type survive the swap',
		row.src + '/' + row.field + '/' + row.op + '/' + row.value, 'Incomes/Due Date/<=/today');
	const row2 = { kind: 'cond', src: 'Actions', field: 'Points', type: 'number', op: '>=', value: '3' };
	p._qbApplySrcPick(row2, 'Incomes');
	check('a field the new collection lacks resets the row',
		row2.src + '/' + row2.field + '/' + row2.value, 'Incomes/Due Date/');
}

// The wrap-below button: everything after the cut becomes ONE group that
// joins as a unit — the one-click fix for Page AND gA OR gI OR gG.
console.log('\ngroup everything below');
{
	const m = p._qbNormalize(p._qbParse('@page AND (@Actions.Title = "a") OR (@Incomes."Due Date" <= "today") OR (@Expenses.Title = "c")'));
	// as built: Page binds only to the first branch
	check('before: Page binds only the first branch', p._qbCompile(m).indexOf('@page AND ((') , -1);
	p._qbWrapBelow(m, 1);
	check('after: ONE wrapped group joins Page as a unit', p._qbCompile(m),
		'@page AND ((@Actions.Title = "a") OR (@Incomes."Due Date" <= "today") OR (@Expenses.Title = "c"))');
	check('…and the shape survives reopen', (function () {
		const b = p._qbParse(p._qbCompile(m));
		return b.rows.length + '/' + p._qbKind(b.rows[1]) + '/' + b.rows[1].rows.length;
	})(), '2/group/3');
}
{
	// the self-drop guard
	const m = p._qbNormalize(p._qbParse('(@Actions.Title = "a" OR @Actions.Title = "b") AND @Actions.Title = "c"'));
	p._qb = { model: m };
	const before = p._qbCompile(m);
	p._qbMoveRow('0', { path: '0', index: 0 });   // drop the group into itself
	check('a group refuses to land inside itself', p._qbCompile(m), before);
	p._qb = null;
}

// The single-child hoist is GONE (his report: outdenting the second-to-last
// group collapsed the wrapper). A wrapper with one child survives the session.
console.log('\nwrapper levels survive now');
{
	const m = p._qbNormalize({ join: 'OR', rows: [
		{ kind: 'group', join: 'AND', rows: [
			cond('Actions', 'Title', 'text', '=', 'a'),
			cond('Actions', 'Title', 'text', '=', 'b'),
		] },
	] });
	check('one group inside a group stays nested', p._qbKind(m.rows[0]) + '/' + m.rows[0].rows.length, 'group/2');
	check('…and compiles to the same query', p._qbCompile(m), '(@Actions.Title = "a" AND @Actions.Title = "b")');
}

// Indent = TUCK into the sibling group above, nothing else (his rule: a
// group indented once cannot indent again — no in-place wrapping, depth
// comes from children having children). Outdent still exits one level.
console.log('\nindent = tuck only');
p._qb = { defaultSrc: 'Actions', model: null };
{
	const m = p._qbNormalize({ join: 'AND', rows: [
		cond('Actions', 'Title', 'text', '=', 'a'),
		{ kind: 'group', join: 'AND', j: 'AND', rows: [cond('Expenses', 'Title', 'text', '=', 'b')] },
	] });
	p._qb.model = m;
	p._qbEl = null;
	const orig = m.rows[1];
	check('indent with only a cond above is a refused no-op', p._qbIndentGroup(orig, 1), false);
	check('…and the model is untouched', m.rows.length === 2 && m.rows[1] === orig, true);
	const m2 = p._qbNormalize({ join: 'AND', rows: [
		{ kind: 'group', join: 'AND', j: 'AND', rows: [cond('Actions', 'Title', 'text', '=', 'a')] },
		{ kind: 'group', join: 'AND', j: 'OR', rows: [cond('Expenses', 'Title', 'text', '=', 'b')] },
	] });
	p._qb.model = m2;
	const gA = m2.rows[0], gB = m2.rows[1];
	p._qbIndentGroup(gB, 1);
	check('indent tucks into the group above', m2.rows.length === 1 && gA.rows[gA.rows.length - 1] === gB, true);
	p._qbIndentGroup(gB, -1);
	check('outdent lands it back after its old parent', m2.rows.length === 2 && m2.rows[1] === gB, true);
}
p._qb = null;

// His stack rules (2026-08-14): every group inside another one can outdent,
// including the FIRST child; only a group with a GROUP directly above it can
// indent (a first child has none, so it cannot indent again).
console.log('\nstack: first child outdents, later children do both');
p._qb = { defaultSrc: 'Actions', model: null };
{
	const stack = { kind: 'group', join: 'AND', j: 'OR', rows: [
		{ kind: 'group', join: 'AND', j: 'AND', rows: [cond('Actions', 'Title', 'text', '=', 'a')] },
		{ kind: 'group', join: 'AND', j: 'OR', rows: [cond('Expenses', 'Title', 'text', '=', 'b')] },
	] };
	const m = p._qbNormalize({ join: 'AND', rows: [cond('Actions', 'Title', 'text', '=', 'p'), stack] });
	p._qb.model = m; p._qbEl = null;
	const W = m.rows[1], A = W.rows[0], B = W.rows[1];
	// The second child indents INTO the first one (a group can have children).
	p._qbIndentGroup(B, 1);
	check('second child indents into the group above it',
		W.rows.length === 1 && A.rows[A.rows.length - 1] === B, true);
	p._qbIndentGroup(B, -1);
	check('…and outdents back beside it', W.rows.length === 2 && W.rows[1] === B, true);
	// The first child cannot indent (no group above it) but MUST outdent.
	check('first child refuses to indent', p._qbIndentGroup(A, 1), false);
	p._qbIndentGroup(A, -1);
	check('first child outdents in FRONT of its old parent',
		m.rows.length === 3 && m.rows[1] === A && m.rows[2] === W, true);
}
p._qb = null;

// Undoing a one-group stack must not rewrite the query: the child takes over
// the wrapper's joiner as the wrapper is pruned.
console.log('\nun-stacking a lone child keeps the query');
p._qb = { defaultSrc: 'Actions', model: null };
{
	const m = p._qbNormalize({ join: 'AND', rows: [
		cond('Actions', 'Title', 'text', '=', 'a'),
		{ kind: 'group', join: 'AND', j: 'OR', rows: [
			{ kind: 'group', join: 'AND', j: 'AND', rows: [cond('Expenses', 'Title', 'text', '=', 'b')] },
		] },
	] });
	p._qb.model = m; p._qbEl = null;
	const inner = m.rows[1].rows[0];
	const before = p._qbCompile(m);
	p._qbIndentGroup(inner, -1);
	check('the wrapper is gone', m.rows.length === 2 && m.rows[1] === inner, true);
	check('the child inherited the wrapper\'s OR', inner.j, 'OR');
	check('and the query text is unchanged', p._qbCompile(m), before);
}
p._qb = null;

// ── Saved searches as chips and as builder rows ───────────────────────────
// His real "This Month" (Finance), and a one-term search to combine it with.
console.log('\nsaved searches — recognition, compile, round trip');
{
	const TM = '(@Incomes."Due Date" >= "2026-09-25" AND @Incomes."Due Date" <= "2026-10-24") OR (@Expenses."Due Date" >= "2026-09-25" AND @Expenses."Due Date" <= "2026-10-24")';
	const IP = '@Expenses."Action Status" = "In Progress"';
	const AB = '@Actions.Title = "a" AND @Actions.Title = "b"';
	const items = [
		{ id: 'tm', title: 'This Month', query: TM, col: 'fin' },
		{ id: 'ip', title: 'In Progress', query: IP, col: 'other' },
		{ id: 'ab', title: 'AB', query: AB, col: 'fin' },
	];
	const titles = (hits) => hits.map((h) => h.item.title).join(' | ');

	check('split at top-level AND/OR only', p._ssSplit('(a OR b) AND "x and y" OR c').map((x) => x.s + '-' + x.e).join(' '), '0-8 13-22 26-27');
	check('a saved search alone is one chip', titles(p._ssMatch(TM, items, 'fin')), 'This Month');
	check('chip + more text', titles(p._ssMatch('(' + TM + ') AND @Actions.Title = "x"', items, 'fin')), 'This Month');
	check('two chips combined', titles(p._ssMatch('(' + TM + ') AND ' + IP, items, 'fin')), 'This Month | In Progress');
	check('NOT stays outside the chip', (() => { const t = 'NOT ' + IP; const h = p._ssMatch(t, items, 'fin')[0]; return h && t.slice(h.cs, h.e); })(), IP);
	check('an edited search is no chip', p._ssMatch(TM.replace('10-24', '10-31'), items, 'fin').length, 0);
	check('the precedence trap gets no chip', p._ssMatch('(a) OR (b) AND x', [{ id: 'q', title: 'Q', query: '(a) OR (b)', col: 'fin' }], 'fin').length, 0);
	check('an unbracketed multi-term search beside more text is no chip', p._ssMatch(AB + ' AND @Actions.Title = "c"', items, 'fin').length, 0);

	const tm = p._qbSavedNode(items[0]);
	const ip = p._qbSavedNode(items[1]);
	check('a saved node alone compiles to its snapshot, unbracketed', p._qbCompile({ join: 'AND', rows: [tm] }), TM);
	ip.j = 'AND';
	check('two saved nodes: the multi-term one is bracketed', p._qbCompile({ join: 'AND', rows: [tm, ip] }), '(' + TM + ') AND ' + IP);
	const ab = p._qbSavedNode(items[2]); ab.j = 'AND';
	const c = cond('Actions', 'Title', 'text', '=', 'c'); c.j = 'AND';
	check('an AND-only saved search is bracketed beside more', p._qbCompile({ join: 'AND', rows: [ab, c] }), '(' + AB + ') AND @Actions.Title = "c"');
	check('...and is recognised again', titles(p._ssMatch(p._qbCompile({ join: 'AND', rows: [ab, c] }), items, 'fin')), 'AB');
	check('not edited', p._qbSavedEdited(tm), false);

	// A negated saved search is written NOT (…), the builder's form for every
	// negated comparison, and is still a chip in that form.
	check('NOT (saved) is still a chip', titles(p._ssMatch('NOT (' + IP + ') AND @Actions.Title = "x"', items, 'fin')), 'In Progress');
	for (const text of [TM, '(' + TM + ') AND ' + IP, 'NOT (' + IP + ') AND @Actions.Title = "x"', '(' + TM + ') OR @Actions.Title = "x"']) {
		const m = p._qbParseWithSaved(text, items, 'fin');
		check('field → model → field: ' + text.slice(0, 50), p._qbCompile(m), text);
	}
	const m2 = p._qbParseWithSaved('(' + TM + ') AND ' + IP, items, 'fin', 1);
	check('the model holds two saved nodes', m2.rows.map((r) => r.kind + ':' + r.title).join(' '), 'saved:This Month saved:In Progress');
	check('the clicked one opens folded out', m2.rows.map((r) => r.open).join(' '), 'false true');
	const n = p._qbParseWithSaved('NOT ' + IP, items, 'fin').rows[0];
	check('a NOT before a chip negates the saved node', n.kind + ' ' + n.neg, 'saved true');

	// Editing a row inside a folded-out saved search: it compiles from its rows
	// now and the field text stops matching (snapshot rule).
	const tm2 = p._qbSavedNode(items[0], true);
	tm2.rows[0].rows[1].value = '2026-10-31';
	check('editing inside marks it edited', p._qbSavedEdited(tm2), true);
	check('...and it compiles from its rows', p._qbCompile({ join: 'AND', rows: [tm2] }), TM.replace('<= "2026-10-24")', '<= "2026-10-31")'));
	check('normalize keeps a saved node whole', JSON.stringify(p._qbNormalize(JSON.parse(JSON.stringify({ rows: [tm] }))).rows[0].base), JSON.stringify(tm.base));
	const empty = { kind: 'saved', sid: null, rows: [], j: 'AND' };
	check('the empty pick row compiles to nothing', p._qbCompile(p._qbNormalize({ rows: [empty, cond('Actions', 'Title', 'text', '=', 'z')] })), '@Actions.Title = "z"');
}

// The config-write storm (2026-10-11): a reload that reads back an older config
// must not make the plugin write the same revision again and again.
console.log('\nconfig writes — one per revision');
{
	const store = {};
	globalThis.window = { localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } } };
	globalThis.document = { querySelectorAll: () => [] };
	let writes = 0;
	const q = new Plugin();
	q._cache = [{ id: 'a', title: 'A', query: 'x' }];
	q.getConfiguration = () => ({ custom: {} });
	q.getGuid = () => 'G';
	q.data = { getAllGlobalPlugins: () => [{ guid: 'G', saveConfiguration: () => { writes++; } }] };
	q._rev = 111; q._dirty = true; await q._flush();
	q._dirty = true; await q._flush();            // what a stale reload would cause
	check('the same revision is written once', writes, 1);
	q._rev = 222; q._dirty = true; await q._flush(); // a real change
	check('a new revision is written', writes, 2);
	delete globalThis.window; delete globalThis.document;
}

console.log('\nempty input');
check('empty query yields no model', String(p._qbParse('')), 'null');
check('empty model compiles to nothing', p._qbCompile(p._qbNormalize({})), '');

console.log(fails ? '\n' + fails + ' FAILED\n' : '\nall passed\n');
process.exit(fails ? 1 : 0);
