"use client";

import { useState, type InputHTMLAttributes } from "react";

/* A password field with an eye toggle to reveal what was typed. Takes every
 * normal input prop; `type` is owned here. */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
	const [shown, setShown] = useState(false);
	return (
		<div className="sa-pw">
			<input {...props} type={shown ? "text" : "password"} />
			<button
				type="button"
				className="sa-pw-toggle"
				onClick={() => setShown((v) => !v)}
				aria-label={shown ? "Hide password" : "Show password"}
				title={shown ? "Hide password" : "Show password"}
			>
				<svg
					className="sa-icon"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.7"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					{shown ? (
						<>
							<path d="M3 3l18 18" />
							<path d="M10.6 6.1A10.6 10.6 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3.2 3.9M6.6 7.6A16.5 16.5 0 0 0 2.5 12s3.5 6 9.5 6c1.5 0 2.8-.4 4-.9" />
							<path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
						</>
					) : (
						<>
							<path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12Z" />
							<circle cx="12" cy="12" r="3" />
						</>
					)}
				</svg>
			</button>
		</div>
	);
}
