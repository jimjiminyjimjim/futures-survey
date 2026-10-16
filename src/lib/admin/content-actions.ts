/**
 * Shared result type for admin server actions.
 *
 * The section/statement content-editing actions that used to live in this
 * file (RND-03: addSection/updateSection/deleteSection/moveSection,
 * addStatement/updateStatement/deleteStatement/moveStatement) were deleted
 * on 2026-10-15 when the user descoped round content editing — new rounds
 * copy the previous round's questions unchanged via admin_create_round, and
 * there is no UI to edit them. The underlying DB functions
 * (admin_add_section, admin_add_statement, etc.) are untouched and still
 * enforce the same rules; they are simply no longer called from the UI.
 *
 * This type is kept here (rather than deleted with the rest of the file)
 * because src/lib/admin/round-actions.ts, src/lib/admin/access-actions.ts,
 * and src/components/admin/confirm-dialog.tsx all import it.
 */
export type AdminActionResult = { ok: true } | { ok: false; error: string };
