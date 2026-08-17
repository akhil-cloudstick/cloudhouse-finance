import "../login.css";

/* Landing page Setu redirects the CUSTOMER back to after they finish (or
 * abandon) Aadhaar+OTP signing of the indemnity bond — the `redirectUrl`
 * LoanDetail.tsx passes to POST /loans/:id/indemnity-bond/esign/start.
 *
 * Deliberately a plain, static, unauthenticated page: it's opened on the
 * customer's own device, not a staff session, so it must not try to read the
 * app's auth state or call the API. Signing outcome is NOT read from this
 * redirect — staff confirm it from the loan page ("Check eSign Status", which
 * polls Setu server-side), because a redirect the customer can navigate away
 * from is not something to treat as proof of signature. Without this route
 * the customer landed on a 404 after signing. */
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
