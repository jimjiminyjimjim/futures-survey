import { notFound } from "next/navigation";

// Next.js only threads a route through its enclosing layout.tsx when a page
// actually matches that path. Without this catch-all, /admin/<anything-else>
// had no matching page, so Next rendered its own 404 boundary directly
// inside the root layout — skipping ../layout.tsx's signed-in/is-admin guard
// entirely. A signed-out or non-admin visitor to an unknown /admin/** path
// would see a bare 404 instead of being redirected to /login or /.
//
// This page matches every /admin/** path with no sibling page.tsx, so
// ../layout.tsx's guard always runs first. Once the guard has confirmed the
// visitor is a signed-in admin, the path still doesn't correspond to a real
// page, so render the genuine 404.
export default function AdminCatchAll() {
  notFound();
}
