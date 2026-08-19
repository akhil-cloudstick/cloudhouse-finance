# Legacy prototype (reference only)

This is the pre-Next.js prototype the current `frontend/` app was ported
from — plain HTML/CSS/JS with a `localStorage`-backed mock data layer
(`data.js`). It is **not** part of the shipped application and nothing in
`frontend/` imports it; it's kept only because many components' doc
comments say "ported from `legacy/app.js`'s `renderX()`" and it's useful to
have the original render logic on hand when checking that a port preserved
behavior.

Moved here (out of `frontend/`) so it's clearly not part of the built
frontend's source tree — see the Cloudhouse frontend standard's "no foreign
files in the source tree" rule.
