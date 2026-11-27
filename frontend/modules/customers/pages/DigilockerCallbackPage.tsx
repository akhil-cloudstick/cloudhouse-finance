"use client";

import { Suspense } from "react";
import BrandLogo from "@/common/components/BrandLogo";
import { useSearchParams } from "next/navigation";
import "@/common/styles/login.css";

// Just confirms and tells the customer to close the tab; staff fetch the real result via "Check Status".
function DigilockerCallbackContent() {
	const searchParams = useSearchParams();
	const success = searchParams.get("success") === "True";

	return (
		<div className="login-page">
			<div className="wrap">
				<main className="card">

					<div className="brand">
						<BrandLogo size={104} scalable={false} />
						<h1>
							{success ? (
								<>DigiLocker login complete</>
							) : (
								<>DigiLocker login didn't complete</>
							)}
						</h1>
					</div>

					<p style={{ textAlign: "center", color: "var(--muted, #62626f)", lineHeight: 1.6 }}>
						{success
							? "You can close this tab now. Ask the staff member helping you to check the verification status back on their screen."
							: "The DigiLocker login was cancelled or didn't finish. You can close this tab and ask the staff member to send a new verification link."}
					</p>
				</main>
			</div>
		</div>
	);
}

export default function DigilockerCallbackPage() {
	return (
		<Suspense fallback={null}>
			<DigilockerCallbackContent />
		</Suspense>
	);
}
