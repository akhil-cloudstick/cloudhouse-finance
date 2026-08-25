import { openPrintWindow } from "@/common/utils/print";

/* Printable indemnity bond, in the three languages branches actually hand
 * over the counter. Lives here rather than inside NewLoan.tsx because it is
 * needed at two different points in a loan's life: before submission (the
 * New Loan wizard's print buttons) and afterwards from Loan Details, where
 * staff re-print it for offline wet-ink signing whenever Aadhaar eSign is
 * not used or not available.
 *
 * Every field is optional — the wizard calls this against an unsaved draft
 * whose customer details may still be blank, and a blank renders as the
 * underscore rule a signer fills in by hand. */
export type IndemnityBondParty = {
  /* Loan number, or the wizard's provisional id before submission. */
  loanNumber: string;
  name?: string;
  dob?: string;
  address?: string;
  branchName?: string;
  phone?: string;
};

export type IndemnityBondLang = "en" | "gu" | "hi";

export function printIndemnityBond(
  p: IndemnityBondParty,
  lang: IndemnityBondLang,
  onBlocked: (msg: string) => void
) {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, "0");
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const yy = String(now.getFullYear()).slice(2);
    const monthName = now.toLocaleString("en-IN", { month: "long" });
    const age = p.dob ? Math.floor((now.getTime() - new Date(p.dob).getTime()) / 31557600000) : "____";
    const B = "________________";

    if (lang === "gu") {
      openPrintWindow("વળતર બોન્ડ — " + p.loanNumber, `
        <h1>વળતર બોન્ડ (INDEMNITY BOND)</h1>
        <p>તારીખ: ${dd} / ${mm} / 20${yy}</p>
        <p>પ્રતિ,<br>શાખા વ્યવસ્થાપકશ્રી,<br>અંબિકા ગોલ્ડ ફાઇનાન્સ (NBFC)<br>${p.branchName || B} શાખા</p>
        <p><b>વિષય: ગોલ્ડ લોન એકાઉન્ટ નં. ${p.loanNumber} અંગે વળતર બોન્ડ</b></p>
        <p>હું/અમે, શ્રી/શ્રીમતી <b>${p.name || B}</b>, ઉંમર <b>${age}</b> વર્ષ, રહેવાસી <b>${p.address || B}</b>, આથી સોગંદપૂર્વક જાહેર કરું/કરીએ છું/છીએ અને બાંહેધરી આપું/આપીએ છીએ કે:</p>
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
        <p>આથી હું/અમે આ વળતર બોન્ડ આજ રોજ <b>${dd} / ${mm} / 20${yy}</b> ના રોજ સ્વેચ્છાએ અને કોઈપણ દબાણ વિના હસ્તાક્ષર કરીને અમલમાં મૂકીએ છીએ.</p>
        <p style="margin-top:56px">લોનધારકની સહી: ${B}</p>
        <p>નામ: <b>${p.name || B}</b><br><br>સરનામું: <b>${p.address || B}</b></p>
        <hr style="margin:24px 0">
        <p>મોબાઇલ નં.: <b>${p.phone || B}</b></p>
        <p><b>સાક્ષીઓ</b></p>
        <p><b>સાક્ષી – ૧</b><br><br>નામ: ${B}<br><br>સરનામું: ${B}<br><br>સહી: ${B}</p>
        <p style="margin-top:28px"><b>સાક્ષી – ૨</b><br><br>નામ: ${B}<br><br>સરનામું: ${B}<br><br>સહી: ${B}</p>`,
        onBlocked);
      return;
    }

    if (lang === "hi") {
      openPrintWindow("क्षतिपूर्ति बंधपत्र — " + p.loanNumber, `
        <h1>क्षतिपूर्ति बंधपत्र (INDEMNITY BOND)</h1>
        <p>दिनांक: ${dd} / ${mm} / 20${yy}</p>
        <p>सेवा में,<br>शाखा प्रबंधक,<br>अंबिका गोल्ड फाइनेंस (NBFC)<br>${p.branchName || B} शाखा</p>
        <p><b>विषय: गोल्ड लोन खाता संख्या ${p.loanNumber} के संबंध में क्षतिपूर्ति बंधपत्र</b></p>
        <p>मैं/हम, श्री/श्रीमती <b>${p.name || B}</b>, आयु <b>${age}</b> वर्ष, निवासी <b>${p.address || B}</b>, एतद्द्वारा गंभीरतापूर्वक घोषणा करता/करती हूँ/करते हैं और वचन देता/देती हूँ/देते हैं कि:</p>
        <ol>
          <li>मैं/हम उपर्युक्त गोल्ड लोन खाता संख्या ${p.loanNumber} के अंतर्गत बैंक/NBFC के कानूनी ऋणी (Borrower) हूँ/हैं।</li>
          <li>उक्त गोल्ड लोन की सुरक्षा (Security) के रूप में मैंने/हमने बैंक/NBFC के पास सोने के आभूषण/वस्तुएं गिरवी रखी हैं।</li>
          <li>मैं/हम एतद्द्वारा घोषणा करता/करती हूँ/करते हैं कि बैंक/NBFC के पास गिरवी रखे गए सभी सोने के आभूषण/वस्तुएं मेरी/हमारी वैध संपत्ति हैं तथा मैं/हम ही उनके एकमात्र और पूर्ण स्वामी हूँ/हैं। उक्त सोने पर किसी अन्य व्यक्ति का कोई स्वामित्व, हक, हित, दावा, गिरवी अथवा किसी भी प्रकार का अधिकार नहीं है।</li>
          <li>मैं/हम आगे घोषणा करता/करती हूँ/करते हैं कि उक्त सोना वैध साधनों से प्राप्त किया गया है तथा यह किसी भी अवैध गतिविधि, आपराधिक कृत्य, चोरी, धोखाधड़ी, मनी लॉन्ड्रिंग अथवा किसी अन्य अवैध स्रोत से प्राप्त नहीं हुआ है।</li>
          <li>मैं/हम एतद्द्वारा बैंक/NBFC, उसके अधिकारियों, कर्मचारियों, उत्तराधिकारियों तथा समनुदेशितियों को उक्त गिरवी रखे गए सोने के आभूषणों/वस्तुओं के स्वामित्व, हक, स्रोत, गिरवी अथवा मुक्ति से संबंधित किसी भी हानि, दावे, माँग, दायित्व, नुकसान, लागत, व्यय, कानूनी कार्यवाही अथवा परिणाम के विरुद्ध क्षतिपूर्ति देने तथा उन्हें निर्दोष रखने हेतु सहमत हूँ/हैं।</li>
          <li>यदि भविष्य में कोई तीसरा पक्ष गिरवी रखे गए सोने के स्वामित्व, कब्जे अथवा स्रोत के संबंध में कोई दावा, आपत्ति अथवा कानूनी कार्यवाही करता है, तो मैं/हम स्वयं अपने खर्च पर उसका निपटारा करने हेतु पूर्णतः उत्तरदायी होऊँगा/होंगे तथा इससे उत्पन्न होने वाली समस्त हानि, नुकसान, लागत, व्यय एवं दायित्वों के विरुद्ध बैंक/NBFC को पूर्ण रूप से क्षतिपूर्ति दूंगा/देंगे।</li>
          <li>मैं/हम घोषणा करता/करती हूँ/करते हैं कि इस बंधपत्र में दी गई समस्त जानकारी मेरी/हमारी जानकारी एवं विश्वास के अनुसार सत्य, सही एवं पूर्ण है। मैं/हम समझता/समझती हूँ/समझते हैं कि बैंक/NBFC इस घोषणा पर विश्वास करते हुए उक्त गोल्ड लोन स्वीकृत करता है अथवा जारी रखता है।</li>
          <li>यह क्षतिपूर्ति बंधपत्र अपरिवर्तनीय होगा तथा मुझ पर/हम पर एवं मेरे/हमारे कानूनी उत्तराधिकारियों, निष्पादकों, प्रशासकों तथा प्रतिनिधियों पर तब तक वैध, बाध्यकारी एवं प्रवर्तनीय रहेगा जब तक इसके अंतर्गत उत्पन्न सभी दायित्वों का पूर्ण निर्वहन नहीं हो जाता।</li>
        </ol>
        <p>इसके साक्ष्य स्वरूप, मैंने/हमने यह क्षतिपूर्ति बंधपत्र आज <b>${now.getDate()}</b> ${monthName}, 20${yy} को स्वेच्छा से एवं बिना किसी दबाव के निष्पादित किया है।</p>
        <p style="margin-top:56px"><b>ऋणी के हस्ताक्षर</b></p>
        <p>नाम: <b>${p.name || B}</b><br><br>पता: <b>${p.address || B}</b></p>
        <hr style="margin:24px 0">
        <p>मोबाइल नं.: <b>${p.phone || B}</b></p>
        <p><b>साक्षीगण</b></p>
        <p><b>साक्षी संख्या 1</b><br><br>नाम: ${B}<br><br>पता: ${B}<br><br>हस्ताक्षर: ${B}</p>
        <p style="margin-top:28px"><b>साक्षी संख्या 2</b><br><br>नाम: ${B}<br><br>पता: ${B}<br><br>हस्ताक्षर: ${B}</p>`,
        onBlocked);
      return;
    }

    openPrintWindow("Indemnity Bond — " + p.loanNumber, `
      <h1>INDEMNITY BOND</h1>
      <p>Date: ${dd} / ${mm} / 20${yy}</p>
      <p>To<br>The Branch Manager<br>Ambika Gold Finance (NBFC)<br>${p.branchName || B} Branch</p>
      <p><b>Subject: Indemnity Bond in respect of Gold Loan Account No. ${p.loanNumber}</b></p>
      <p>I/We, Mr./Ms. <b>${p.name || B}</b>, aged <b>${age}</b> years, residing at <b>${p.address || B}</b>, do hereby solemnly affirm, declare and undertake as under:</p>
      <ol>
        <li>That I/we am/are the borrower(s) under Gold Loan Account No. <b>${p.loanNumber}</b> with your Bank/NBFC.</li>
        <li>That I/we have pledged certain gold ornaments/articles with the Bank/NBFC as security for the above-mentioned gold loan.</li>
        <li>I/We hereby declare that the gold ornaments/articles pledged with the Bank/NBFC are my/our lawful property and that I/we am/are the sole and absolute owner(s) thereof. No other person has any ownership, title, interest, claim, lien or right of any nature whatsoever in respect of the said gold.</li>
        <li>I/We further declare that the said gold has been acquired through lawful means and has not been obtained, purchased, possessed, or derived from any illegal activity, criminal offence, theft, fraud, money laundering, or any other unlawful source.</li>
        <li>I/We hereby agree to indemnify and keep indemnified the Bank/NBFC, its officers, employees, successors and assigns against any loss, claim, demand, liability, damage, cost, expense, legal proceedings or consequences whatsoever arising out of or in connection with the ownership, title, source, pledge or release of the said gold ornaments/articles.</li>
        <li>In the event that any third party raises any claim, objection, dispute or legal proceedings regarding the ownership, possession or source of the pledged gold, I/we shall be solely responsible for resolving the same at my/our own cost and shall fully indemnify and hold harmless the Bank/NBFC against all losses, damages, costs, expenses and liabilities arising therefrom.</li>
        <li>I/We declare that all statements made herein are true, correct and complete to the best of my/our knowledge and belief. I/We understand that this declaration is being relied upon by the Bank/NBFC for the purpose of granting and/or continuing the above-mentioned gold loan.</li>
        <li>This Indemnity Bond shall be irrevocable and shall remain valid, binding and enforceable upon me/us and my/our legal heirs, executors, administrators and representatives until all obligations arising hereunder have been fully discharged.</li>
      </ol>
      <p>IN WITNESS WHEREOF, I/we have executed this Indemnity Bond on this <b>${now.getDate()}</b> day of <b>${monthName}</b>, 20${yy}.</p>
      <p style="margin-top:56px"><b>Signature of Borrower</b></p>
      <p>Name: <b>${p.name || B}</b><br><br>Address: <b>${p.address || B}</b></p>
      <hr style="margin:24px 0">
      <p>Mobile No.: <b>${p.phone || B}</b></p>
      <p><b>Witnesses</b></p>
      <p><b>Witness No. 1</b><br><br>Name: ${B}<br><br>Address: ${B}<br><br>Signature: ${B}</p>
      <p style="margin-top:28px"><b>Witness No. 2</b><br><br>Name: ${B}<br><br>Address: ${B}<br><br>Signature: ${B}</p>`,
      onBlocked);
  }
