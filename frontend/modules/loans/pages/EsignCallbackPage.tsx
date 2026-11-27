import "@/common/styles/login.css";

// Deliberately plain and unauthenticated — opened on the customer's own device, not a staff session.
// Signing outcome is NOT read from this redirect; staff confirm it via "Check eSign Status" polling Setu server-side.
export default function EsignCallbackPage() {
	return (
		<div className="login-page">
			<div className="wrap">
				<main className="card">
					<span className="stud tl"></span>
					<span className="stud tr"></span>
					<span className="stud bl"></span>
					<span className="stud br"></span>
					<h1>Signing complete</h1>
					<p style={{ marginTop: 12, lineHeight: 1.6 }}>
						Thank you — you can close this tab now.
					</p>
					<p style={{ marginTop: 12, lineHeight: 1.6, fontSize: 13, opacity: 0.8 }}>
						If you finished Aadhaar eSign, our branch staff will see it confirmed
						against your loan shortly. If something went wrong, please tell the
						branch — they can send the document again.
					</p>
				</main>
			</div>
		</div>
	);
}
