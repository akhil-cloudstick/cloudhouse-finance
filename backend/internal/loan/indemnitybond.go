package loan

import (
	"context"
	"fmt"
	"html/template"
	"strings"
	"time"

	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/chromedp"
)

// BondData carries everything the indemnity bond template needs, resolved
// from a Loan + its preloaded Customer/Branch (see Service.
// StartIndemnityBondSign) — mirrors the fields frontend/components/
// NewLoan.tsx's printIndemnity() assembles via buildDraft(), so the eSigned
// PDF matches what staff already see on the pre-save print preview.
type BondData struct {
	LoanNumber   string
	CustomerName string
	Age          int // 0 means unknown (customer has no DOB on file) — rendered as a blank
	Address      string
	BranchName   string
	Phone        string
	Day          int
	Month        string // full month name, e.g. "August"
	Year         int
}

// blank is the placeholder used wherever printIndemnity's frontend template
// falls back to "________________" for a missing field.
const blank = "________________"

func orBlank(s string) string {
	if strings.TrimSpace(s) == "" {
		return blank
	}
	return s
}

func ageOrBlank(age int) string {
	if age <= 0 {
		return "____"
	}
	return fmt.Sprintf("%d", age)
}

// bondTemplates holds one html/template per supported language, each a
// direct port of printIndemnity's inline HTML string for that language
// (frontend/components/NewLoan.tsx ~lines 292-386) — same wording, same
// structure, wrapped in the same print.ts body/table/ol styling so the
// eSigned PDF matches what staff already see when printing the bond by
// hand today.
var bondTemplates = map[string]*template.Template{
	"en": template.Must(template.New("bond_en").Parse(bondHTMLEnglish)),
	"hi": template.Must(template.New("bond_hi").Parse(bondHTMLHindi)),
	"gu": template.Must(template.New("bond_gu").Parse(bondHTMLGujarati)),
}

// bondPageStyle mirrors frontend/lib/print.ts's openPrintWindow stylesheet
// (minus the .noprint print button, irrelevant for a PDF render).
const bondPageStyle = `
body{font-family:Georgia,'Times New Roman',serif;color:#1a1a1a;margin:40px auto;max-width:760px;line-height:1.55;font-size:14px;padding:0 20px}
h1{font-size:20px;text-align:center;margin:0 0 2px;letter-spacing:1px}
ol li{margin-bottom:10px;text-align:justify}
`

const bondHTMLEnglish = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Indemnity Bond — {{.LoanNumber}}</title><style>{{.Style}}</style></head><body>
<h1>INDEMNITY BOND</h1>
<p>Date: {{printf "%02d" .Day}} / {{.MonthNum}} / {{.Year}}</p>
<p>To<br>The Branch Manager<br>Ambika Gold Finance (NBFC)<br>{{.BranchName}} Branch</p>
<p><b>Subject: Indemnity Bond in respect of Gold Loan Account No. {{.LoanNumber}}</b></p>
<p>I/We, Mr./Ms. <b>{{.CustomerName}}</b>, aged <b>{{.Age}}</b> years, residing at <b>{{.Address}}</b>, do hereby solemnly affirm, declare and undertake as under:</p>
<ol>
<li>That I/we am/are the borrower(s) under Gold Loan Account No. <b>{{.LoanNumber}}</b> with your Bank/NBFC.</li>
<li>That I/we have pledged certain gold ornaments/articles with the Bank/NBFC as security for the above-mentioned gold loan.</li>
<li>I/We hereby declare that the gold ornaments/articles pledged with the Bank/NBFC are my/our lawful property and that I/we am/are the sole and absolute owner(s) thereof. No other person has any ownership, title, interest, claim, lien or right of any nature whatsoever in respect of the said gold.</li>
<li>I/We further declare that the said gold has been acquired through lawful means and has not been obtained, purchased, possessed, or derived from any illegal activity, criminal offence, theft, fraud, money laundering, or any other unlawful source.</li>
<li>I/We hereby agree to indemnify and keep indemnified the Bank/NBFC, its officers, employees, successors and assigns against any loss, claim, demand, liability, damage, cost, expense, legal proceedings or consequences whatsoever arising out of or in connection with the ownership, title, source, pledge or release of the said gold ornaments/articles.</li>
<li>In the event that any third party raises any claim, objection, dispute or legal proceedings regarding the ownership, possession or source of the pledged gold, I/we shall be solely responsible for resolving the same at my/our own cost and shall fully indemnify and hold harmless the Bank/NBFC against all losses, damages, costs, expenses and liabilities arising therefrom.</li>
<li>I/We declare that all statements made herein are true, correct and complete to the best of my/our knowledge and belief. I/We understand that this declaration is being relied upon by the Bank/NBFC for the purpose of granting and/or continuing the above-mentioned gold loan.</li>
<li>This Indemnity Bond shall be irrevocable and shall remain valid, binding and enforceable upon me/us and my/our legal heirs, executors, administrators and representatives until all obligations arising hereunder have been fully discharged.</li>
</ol>
<p>IN WITNESS WHEREOF, I/we have executed this Indemnity Bond on this <b>{{.Day}}</b> day of <b>{{.Month}}</b>, {{.Year}}.</p>
<p>Name: <b>{{.CustomerName}}</b><br>Address: <b>{{.Address}}</b></p>
<p>Mobile No.: <b>{{.Phone}}</b></p>
</body></html>`

const bondHTMLHindi = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>क्षतिपूर्ति बंधपत्र — {{.LoanNumber}}</title><style>{{.Style}}</style></head><body>
<h1>क्षतिपूर्ति बंधपत्र (INDEMNITY BOND)</h1>
<p>दिनांक: {{printf "%02d" .Day}} / {{.MonthNum}} / {{.Year}}</p>
<p>सेवा में,<br>शाखा प्रबंधक,<br>अंबिका गोल्ड फाइनेंस (NBFC)<br>{{.BranchName}} शाखा</p>
<p><b>विषय: गोल्ड लोन खाता संख्या {{.LoanNumber}} के संबंध में क्षतिपूर्ति बंधपत्र</b></p>
<p>मैं/हम, श्री/श्रीमती <b>{{.CustomerName}}</b>, आयु <b>{{.Age}}</b> वर्ष, निवासी <b>{{.Address}}</b>, एतद्द्वारा गंभीरतापूर्वक घोषणा करता/करती हूँ/करते हैं और वचन देता/देती हूँ/देते हैं कि:</p>
<ol>
<li>मैं/हम उपर्युक्त गोल्ड लोन खाता संख्या {{.LoanNumber}} के अंतर्गत बैंक/NBFC के कानूनी ऋणी (Borrower) हूँ/हैं।</li>
<li>उक्त गोल्ड लोन की सुरक्षा (Security) के रूप में मैंने/हमने बैंक/NBFC के पास सोने के आभूषण/वस्तुएं गिरवी रखी हैं।</li>
<li>मैं/हम एतद्द्वारा घोषणा करता/करती हूँ/करते हैं कि बैंक/NBFC के पास गिरवी रखे गए सभी सोने के आभूषण/वस्तुएं मेरी/हमारी वैध संपत्ति हैं तथा मैं/हम ही उनके एकमात्र और पूर्ण स्वामी हूँ/हैं। उक्त सोने पर किसी अन्य व्यक्ति का कोई स्वामित्व, हक, हित, दावा, गिरवी अथवा किसी भी प्रकार का अधिकार नहीं है।</li>
<li>मैं/हम आगे घोषणा करता/करती हूँ/करते हैं कि उक्त सोना वैध साधनों से प्राप्त किया गया है तथा यह किसी भी अवैध गतिविधि, आपराधिक कृत्य, चोरी, धोखाधड़ी, मनी लॉन्ड्रिंग अथवा किसी अन्य अवैध स्रोत से प्राप्त नहीं हुआ है।</li>
<li>मैं/हम एतद्द्वारा बैंक/NBFC, उसके अधिकारियों, कर्मचारियों, उत्तराधिकारियों तथा समनुदेशितियों को उक्त गिरवी रखे गए सोने के आभूषणों/वस्तुओं के स्वामित्व, हक, स्रोत, गिरवी अथवा मुक्ति से संबंधित किसी भी हानि, दावे, माँग, दायित्व, नुकसान, लागत, व्यय, कानूनी कार्यवाही अथवा परिणाम के विरुद्ध क्षतिपूर्ति देने तथा उन्हें निर्दोष रखने हेतु सहमत हूँ/हैं।</li>
<li>यदि भविष्य में कोई तीसरा पक्ष गिरवी रखे गए सोने के स्वामित्व, कब्जे अथवा स्रोत के संबंध में कोई दावा, आपत्ति अथवा कानूनी कार्यवाही करता है, तो मैं/हम स्वयं अपने खर्च पर उसका निपटारा करने हेतु पूर्णतः उत्तरदायी होऊँगा/होंगे तथा इससे उत्पन्न होने वाली समस्त हानि, नुकसान, लागत, व्यय एवं दायित्वों के विरुद्ध बैंक/NBFC को पूर्ण रूप से क्षतिपूर्ति दूंगा/देंगे।</li>
<li>मैं/हम घोषणा करता/करती हूँ/करते हैं कि इस बंधपत्र में दी गई समस्त जानकारी मेरी/हमारी जानकारी एवं विश्वास के अनुसार सत्य, सही एवं पूर्ण है। मैं/हम समझता/समझती हूँ/समझते हैं कि बैंक/NBFC इस घोषणा पर विश्वास करते हुए उक्त गोल्ड लोन स्वीकृत करता है अथवा जारी रखता है।</li>
<li>यह क्षतिपूर्ति बंधपत्र अपरिवर्तनीय होगा तथा मुझ पर/हम पर एवं मेरे/हमारे कानूनी उत्तराधिकारियों, निष्पादकों, प्रशासकों तथा प्रतिनिधियों पर तब तक वैध, बाध्यकारी एवं प्रवर्तनीय रहेगा जब तक इसके अंतर्गत उत्पन्न सभी दायित्वों का पूर्ण निर्वहन नहीं हो जाता।</li>
</ol>
<p>इसके साक्ष्य स्वरूप, मैंने/हमने यह क्षतिपूर्ति बंधपत्र आज <b>{{.Day}}</b> {{.Month}}, {{.Year}} को स्वेच्छा से एवं बिना किसी दबाव के निष्पादित किया है।</p>
<p>नाम: <b>{{.CustomerName}}</b><br>पता: <b>{{.Address}}</b></p>
<p>मोबाइल नं.: <b>{{.Phone}}</b></p>
</body></html>`

const bondHTMLGujarati = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>વળતર બોન્ડ — {{.LoanNumber}}</title><style>{{.Style}}</style></head><body>
<h1>વળતર બોન્ડ (INDEMNITY BOND)</h1>
<p>તારીખ: {{printf "%02d" .Day}} / {{.MonthNum}} / {{.Year}}</p>
<p>પ્રતિ,<br>શાખા વ્યવસ્થાપકશ્રી,<br>અંબિકા ગોલ્ડ ફાઇનાન્સ (NBFC)<br>{{.BranchName}} શાખા</p>
<p><b>વિષય: ગોલ્ડ લોન એકાઉન્ટ નં. {{.LoanNumber}} અંગે વળતર બોન્ડ</b></p>
<p>હું/અમે, શ્રી/શ્રીમતી <b>{{.CustomerName}}</b>, ઉંમર <b>{{.Age}}</b> વર્ષ, રહેવાસી <b>{{.Address}}</b>, આથી સોગંદપૂર્વક જાહેર કરું/કરીએ છું/છીએ અને બાંહેધરી આપું/આપીએ છીએ કે:</p>
<ol>
<li>હું/અમે ઉપરોક્ત ગોલ્ડ લોન એકાઉન્ટના કાયદેસર લોનધારક (Borrower) છીએ.</li>
<li>ઉપરોક્ત ગોલ્ડ લોનની સુરક્ષા (Security) તરીકે મેં/અમે બેંક/NBFC પાસે સોનાના દાગીના/વસ્તુઓ ગીરવે મૂકેલ છે.</li>
<li>હું/અમે આથી જાહેર કરું/કરીએ છીએ કે બેંક/NBFC પાસે ગીરવે મૂકવામાં આવેલ તમામ સોનાના દાગીના/વસ્તુઓ મારા/અમારા કાયદેસરના અને સંપૂર્ણ માલિકીના છે. આ સોના પર અન્ય કોઈપણ વ્યક્તિનો માલિકી હક, હિત, દાવો, ગીરો, અધિકાર અથવા અન્ય કોઈ પ્રકારનો હક નથી.</li>
<li>હું/અમે વધુમાં જાહેર કરું/કરીએ છીએ કે ગીરવે મૂકવામાં આવેલ સોનું કાયદેસર રીતે પ્રાપ્ત કરાયેલ છે અને તે કોઈપણ ગેરકાયદેસર પ્રવૃત્તિ, ચોરી, છેતરપિંડી, ગુનાહિત કૃત્ય, મની લોન્ડરિંગ અથવા અન્ય કોઈ ગેરકાયદેસર સ્ત્રોતમાંથી પ્રાપ્ત થયેલ નથી.</li>
<li>ઉપરોક્ત સોનાની માલિકી, સ્ત્રોત, ગીરો અથવા તેની મુક્તિ સંબંધિત કોઈપણ પ્રકારના દાવા, વિવાદ, નુકસાન, જવાબદારી, ખર્ચ, કાનૂની કાર્યવાહી અથવા અન્ય પરિણામો માટે હું/અમે સંપૂર્ણપણે જવાબદાર રહીશ/રહીશું અને બેંક/NBFC તથા તેના અધિકારીઓ, કર્મચારીઓ અને પ્રતિનિધિઓને આવા તમામ નુકસાન, ખર્ચ અને જવાબદારીઓ સામે સંપૂર્ણ વળતર (Indemnity) આપવા તથા તેમને નિર્દોષ રાખવા સંમત છીએ.</li>
<li>જો ભવિષ્યમાં કોઈપણ વ્યક્તિ અથવા સંસ્થા ઉપરોક્ત સોનાની માલિકી, કબજો અથવા તેના સ્ત્રોત અંગે કોઈ દાવો, વાંધો અથવા કાનૂની કાર્યવાહી કરે, તો તે અંગેનો સંપૂર્ણ ખર્ચ, જવાબદારી અને તેનો નિકાલ હું/અમે મારી/અમારી જવાબદારી પર કરીશ/કરીશું અને તેનાથી બેંક/NBFCને થનારા તમામ નુકસાન, ખર્ચ અથવા જવાબદારીઓ માટે હું/અમે સંપૂર્ણ વળતર આપીશ/આપીશું.</li>
<li>હું/અમે જાહેર કરું/કરીએ છીએ કે આ બોન્ડમાં દર્શાવેલ તમામ વિગતો મારી/અમારી જાણ અને માન્યતા મુજબ સાચી, સંપૂર્ણ અને યથાર્થ છે. બેંક/NBFC આ ઘોષણા પર વિશ્વાસ રાખીને ગોલ્ડ લોન મંજૂર કરે છે અથવા ચાલુ રાખે છે તે બાબત મને/અમને સંપૂર્ણ જાણ છે.</li>
<li>આ વળતર બોન્ડ મારા/અમારા તેમજ મારા/અમારા કાનૂની વારસદારો, પ્રતિનિધિઓ, વહીવટદારો અને ઉત્તરાધિકારીઓ પર બંધનકર્તા રહેશે અને આ બોન્ડ હેઠળની તમામ જવાબદારીઓ પૂર્ણ ન થાય ત્યાં સુધી અમલમાં રહેશે.</li>
</ol>
<p>આથી હું/અમે આ વળતર બોન્ડ આજ રોજ <b>{{printf "%02d" .Day}} / {{.MonthNum}} / {{.Year}}</b> ના રોજ સ્વેચ્છાએ અને કોઈપણ દબાણ વિના હસ્તાક્ષર કરીને અમલમાં મૂકીએ છીએ.</p>
<p>નામ: <b>{{.CustomerName}}</b><br>સરનામું: <b>{{.Address}}</b></p>
<p>મોબાઇલ નં.: <b>{{.Phone}}</b></p>
</body></html>`

// bondTemplateData wraps BondData with the extra pre-formatted fields the
// templates above reference (Style, MonthNum) — kept separate from BondData
// itself so BondData stays a plain, easily-constructed value in service.go.
type bondTemplateData struct {
	BondData
	Style    template.CSS
	MonthNum string
}

// renderBondHTML executes the language's template against data, returning
// the full HTML document string ready to hand to RenderIndemnityBondPDF.
func renderBondHTML(lang string, data BondData) (string, error) {
	tmpl, ok := bondTemplates[lang]
	if !ok {
		return "", fmt.Errorf("indemnity bond: unsupported language %q (expected en, hi, or gu)", lang)
	}
	td := bondTemplateData{
		BondData: BondData{
			LoanNumber:   data.LoanNumber,
			CustomerName: orBlank(data.CustomerName),
			Age:          data.Age,
			Address:      orBlank(data.Address),
			BranchName:   orBlank(data.BranchName),
			Phone:        orBlank(data.Phone),
			Day:          data.Day,
			Month:        data.Month,
			Year:         data.Year,
		},
		Style:    template.CSS(bondPageStyle),
		MonthNum: fmt.Sprintf("%02d", monthNumber(data.Month)),
	}
	// Age is templated with {{.Age}} directly (not a string field), so a
	// missing DOB needs to render as "____" the same way the frontend does
	// — swap it in as a formatted string via a small wrapper type instead
	// of forcing every template to branch on zero.
	var sb strings.Builder
	if err := tmpl.Execute(&sb, struct {
		bondTemplateData
		Age string
	}{td, ageOrBlank(data.Age)}); err != nil {
		return "", fmt.Errorf("indemnity bond: render template: %w", err)
	}
	return sb.String(), nil
}

func monthNumber(name string) int {
	for i := 1; i <= 12; i++ {
		if time.Month(i).String() == name {
			return i
		}
	}
	return 0
}

// RenderIndemnityBondPDF renders the indemnity bond for the given loan/
// customer data and language into a PDF, via a headless Chromium tab driven
// by chromedp. Chromium's own font stack/text-shaping handles Hindi/
// Gujarati correctly (matras, conjuncts) the same way it does when staff
// print the bond from the browser today — a plain Go PDF library cannot do
// this. Requires a Chrome/Chromium binary on the host; chromedp returns a
// clear error if none is found.
func RenderIndemnityBondPDF(data BondData, lang string) ([]byte, error) {
	html, err := renderBondHTML(lang, data)
	if err != nil {
		return nil, err
	}

	ctx, cancel := chromedp.NewContext(context.Background())
	defer cancel()
	ctx, cancel = context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	var pdfBytes []byte
	err = chromedp.Run(ctx,
		chromedp.Navigate("data:text/html;charset=utf-8,"+template.URLQueryEscaper(html)),
		chromedp.WaitReady("body"),
		chromedp.ActionFunc(func(ctx context.Context) error {
			buf, _, err := page.PrintToPDF().
				WithPrintBackground(true).
				WithPreferCSSPageSize(false).
				Do(ctx)
			if err != nil {
				return err
			}
			pdfBytes = buf
			return nil
		}),
	)
	if err != nil {
		return nil, fmt.Errorf("indemnity bond: render PDF (is Chrome/Chromium installed and on PATH?): %w", err)
	}
	return pdfBytes, nil
}
