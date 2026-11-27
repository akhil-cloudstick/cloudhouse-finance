"use client";

import { useEffect } from "react";

/* The landing kit's small motions (landing-kit.css): the header gains a hairline and shadow once the page
 * scrolls, and blocks marked data-reveal fade up as they come into view. Only blocks still below the fold are
 * hidden first, so nothing already on screen flashes, and without JavaScript every block simply shows.
 * Renders nothing. `motionKey` re-runs it when the page's content changes. Same logic as the POS site's
 * useLandingMotion. */
export function LandingMotion({ motionKey }: { motionKey?: string }) {
	useEffect(() => {
		const header = document.querySelector<HTMLElement>(".lp-header");
		const onScroll = () => header?.classList.toggle("is-scrolled", window.scrollY > 8);
		onScroll();
		window.addEventListener("scroll", onScroll, { passive: true });

		const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		const blocks = Array.from(document.querySelectorAll<HTMLElement>(".lp [data-reveal]"));
		let observer: IntersectionObserver | null = null;
		if (!reduced && "IntersectionObserver" in window) {
			observer = new IntersectionObserver(
				(entries) => {
					for (const entry of entries) {
						if (!entry.isIntersecting) continue;
						entry.target.classList.remove("lp-pending");
						observer?.unobserve(entry.target);
					}
				},
				{ rootMargin: "0px 0px -8% 0px" },
			);
			for (const block of blocks) {
				if (block.getBoundingClientRect().top < window.innerHeight) continue;
				block.classList.add("lp-pending");
				observer.observe(block);
			}
		}

		return () => {
			window.removeEventListener("scroll", onScroll);
			observer?.disconnect();
			for (const block of blocks) block.classList.remove("lp-pending");
		};
	}, [motionKey]);

	return null;
}
