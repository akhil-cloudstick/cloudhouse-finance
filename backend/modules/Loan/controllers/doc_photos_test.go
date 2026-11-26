package controllers

import (
	"bytes"
	"html/template"
	"image"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
)

// A 1x1 PNG — enough for the templates to emit an <img>.
const testPhoto template.URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

// The demo data's 1x1 placeholder "photos" must not print as an empty framed box.
func TestUploadDataURLSkipsPlaceholders(t *testing.T) {
	dir := t.TempDir()
	old := config.Env.UploadsDir
	config.Env.UploadsDir = dir
	defer func() { config.Env.UploadsDir = old }()
	write := func(name string, w, h int) {
		img := image.NewRGBA(image.Rect(0, 0, w, h))
		var b bytes.Buffer
		_ = png.Encode(&b, img)
		path := common.ResolvePath(dir, 7, name)
		_ = os.MkdirAll(filepath.Dir(path), 0o755)
		if err := os.WriteFile(path, b.Bytes(), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("tiny.png", 1, 1)
	write("real.png", 120, 160)
	if common.UploadDataURL(7, "/uploads/tiny.png") != "" {
		t.Fatal("a 1x1 placeholder must be skipped")
	}
	if common.UploadDataURL(7, "/uploads/real.png") == "" {
		t.Fatal("a real photo must print")
	}
}

func TestDocPhotosHTMLEmptyWithoutImages(t *testing.T) {
	if got := common.DocPhotosHTML("", "", ""); got != "" {
		t.Fatalf("no images must print nothing, got %q", got)
	}
	got := string(common.DocPhotosHTML("", testPhoto))
	if strings.Count(got, "<img") != 1 || strings.Contains(got, "dp-customer") {
		t.Fatalf("only the one thumbnail should print, got %q", got)
	}
}

// Module on with images: every bond family shows the photo column; module off: no wrapper at all,
// so today's layout is untouched.
func TestBondPhotosOnlyWhenEnabled(t *testing.T) {
	cases := []struct{ policy, lang string }{
		{commonModels.PolicyKML, BondLangEnglish}, {commonModels.PolicyKML, BondLangMalayalam},
		{commonModels.PolicyGML, BondLangEnglish}, {commonModels.PolicyGML, BondLangGujarati},
	}
	for _, c := range cases {
		base := BondData{LoanNumber: "LN-1", CustomerName: "Asha", Policy: c.policy, Day: 1, Month: "March", Year: 2026}
		off, err := renderBondHTML(base, c.lang)
		if err != nil {
			t.Fatalf("%s/%s off: %v", c.policy, c.lang, err)
		}
		if strings.Contains(off, `class="doc-photo-row"`) {
			t.Errorf("%s/%s: module off must not add the photo wrapper", c.policy, c.lang)
		}
		on := base
		on.ShowImages = true
		on.DocPhotos = common.DocPhotosHTML(testPhoto, testPhoto)
		html, err := renderBondHTML(on, c.lang)
		if err != nil {
			t.Fatalf("%s/%s on: %v", c.policy, c.lang, err)
		}
		if !strings.Contains(html, `class="doc-photos"`) || strings.Count(html, `class="dp-`) != 2 {
			t.Errorf("%s/%s: expected the customer photo and one thumbnail", c.policy, c.lang)
		}
	}
}

// TML sheets: module on and no photo hides the box instead of printing the "photo" placeholder.
func TestTMLBondHidesEmptyPhotoBoxes(t *testing.T) {
	base := BondData{LoanNumber: "LN-1", Policy: commonModels.PolicyTML, Day: 1, Month: "March", Year: 2026}
	off, err := renderBondHTML(base, BondLangEnglish)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(off, "Customer<br>photo") || strings.Contains(off, "visibility:hidden") {
		t.Fatal("module off must print today's placeholders")
	}
	base.ShowImages = true
	on, err := renderBondHTML(base, BondLangEnglish)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(on, `class="photo p1" style="visibility:hidden"`) {
		t.Fatal("module on without a customer photo must hide the box")
	}
	base.CustomerPhoto = testPhoto
	withPhoto, _ := renderBondHTML(base, BondLangEnglish)
	if strings.Contains(withPhoto, `class="photo p1" style="visibility:hidden"`) {
		t.Fatal("a customer photo must show")
	}
}

func TestPledgeSlipPhotoColumn(t *testing.T) {
	rows := []pledgeSlipOrnament{{Name: "Chain", Quantity: 1}}
	off, err := renderPledgeSlipHTML(pledgeSlipTemplateData{Ornaments: rows, PhotoCol: true})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(off, "<th>Photo</th>") || !strings.Contains(off, "—</td>") {
		t.Fatal("module off keeps today's Photo column with its dash")
	}
	on, err := renderPledgeSlipHTML(pledgeSlipTemplateData{Ornaments: rows, ShowImages: true, PhotoCol: false})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(on, "<th>Photo</th>") {
		t.Fatal("module on with no ornament photo must drop the Photo column")
	}
	rows[0].Photos = []template.URL{testPhoto, testPhoto, testPhoto}
	on, _ = renderPledgeSlipHTML(pledgeSlipTemplateData{Ornaments: rows, ShowImages: true, PhotoCol: true, DocPhotos: common.DocPhotosHTML(testPhoto)})
	if strings.Count(on, `class="orn-photo"`) != 3 || !strings.Contains(on, "dp-customer") {
		t.Fatal("module on must show every ornament photo and the customer photo")
	}
}

func TestReleaseDocumentsPhotoColumn(t *testing.T) {
	photos := common.DocPhotosHTML(testPhoto)
	for _, lang := range []string{BondLangEnglish, BondLangMalayalam} {
		ra, err := renderReleaseAgreementHTML(ReleaseAgreementData{LoanNumber: "LN-1", Policy: commonModels.PolicyKML, DocPhotos: photos}, lang)
		if err != nil {
			t.Fatal(err)
		}
		pr, err := renderPartialReleaseReceiptHTML(PartialReleaseReceiptData{LoanNumber: "LN-1", DocPhotos: photos}, lang)
		if err != nil {
			t.Fatal(err)
		}
		for name, html := range map[string]string{"release " + lang: ra, "partial " + lang: pr} {
			if !strings.Contains(html, "dp-customer") {
				t.Errorf("%s: customer photo missing", name)
			}
		}
		ra, _ = renderReleaseAgreementHTML(ReleaseAgreementData{LoanNumber: "LN-1", Policy: commonModels.PolicyKML}, lang)
		if strings.Contains(ra, `class="doc-photo-row"`) {
			t.Errorf("release %s: no photos must add no wrapper", lang)
		}
	}
}

// The fit guard: a photo block that would push the document onto another page is dropped, so the
// page count stays what it is without images. Needs Chrome/Chromium; skipped where it is missing.
func TestFitDocPhotosNeverAddsAPage(t *testing.T) {
	if _, err := exec.LookPath("chromium"); err != nil {
		if _, err := exec.LookPath("chromium-browser"); err != nil {
			if _, err := exec.LookPath("google-chrome"); err != nil {
				t.Skip("no Chrome/Chromium on PATH")
			}
		}
	}
	page := func(photoBlock string) string {
		return `<!DOCTYPE html><html><head><style>` + common.DocPhotosStyle + `</style></head><body><p>One short page.</p>` + photoBlock + `</body></html>`
	}
	base, err := renderA4PDF(page(""), "fit test")
	if err != nil {
		t.Fatal(err)
	}
	// Deliberately oversized (not the real side column) so it would need several pages.
	big, err := renderA4PDF(page(`<div class="doc-photos" style="position:static;display:block;height:3000px"></div>`), "fit test")
	if err != nil {
		t.Fatal(err)
	}
	if CountPDFPages(big) != CountPDFPages(base) {
		t.Fatalf("images added pages: %d vs %d", CountPDFPages(big), CountPDFPages(base))
	}
	// A real side column beside a short block fits, so it is kept.
	real := page(`<div class="doc-photo-row"><div class="doc-photo-main"><p>Customer: Asha<br>Phone: 1<br>Address: x<br>y<br>z</p></div>` + string(common.DocPhotosHTML(testPhoto, testPhoto)) + `</div>`)
	kept, err := renderA4PDF(real, "fit test")
	if err != nil {
		t.Fatal(err)
	}
	if CountPDFPages(kept) != CountPDFPages(base) {
		t.Fatalf("side column changed the page count: %d vs %d", CountPDFPages(kept), CountPDFPages(base))
	}
}

// KML bond: ornaments and their photos go on their own last page, the customer photo stays on top.
func TestKMLBondOrnamentPage(t *testing.T) {
	for _, lang := range []string{BondLangEnglish, BondLangMalayalam} {
		d := BondData{LoanNumber: "LN-1", CustomerName: "Asha", Policy: commonModels.PolicyKML, Day: 1, Month: "March", Year: 2026,
			ShowImages: true, DocPhotos: common.DocPhotosHTML(testPhoto), OrnPage: true,
			OrnRows: []bondOrnPhotoRow{{Name: "Bangle", Quantity: 1, Photos: []template.URL{testPhoto, testPhoto}}, {Name: "Ring", Quantity: 1}}}
		html, err := renderBondHTML(d, lang)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(html, ornPageMarker) || strings.Count(html, "<td class=\"ph\"><img") != 1 || !strings.Contains(html, "Bangle") {
			t.Errorf("%s: ornament page with the Bangle's photos expected", lang)
		}
		d.OrnPage = false
		html, _ = renderBondHTML(d, lang)
		if strings.Contains(html, ornPageMarker) {
			t.Errorf("%s: no ornament page without photos", lang)
		}
	}
}
