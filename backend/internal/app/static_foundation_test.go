package app

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestStaticGzipNegotiationHeadAndRanges(t *testing.T) {
	dir := t.TempDir()
	assets := filepath.Join(dir, "assets")
	if err := os.Mkdir(assets, 0755); err != nil {
		t.Fatal(err)
	}
	original := bytes.Repeat([]byte("const word = 'vocabulary';\n"), 100)
	path := filepath.Join(assets, "app.js")
	if err := os.WriteFile(path, original, 0644); err != nil {
		t.Fatal(err)
	}
	var compressed bytes.Buffer
	writer := gzip.NewWriter(&compressed)
	writer.Write(original)
	writer.Close()
	if err := os.WriteFile(path+".gz", compressed.Bytes(), 0644); err != nil {
		t.Fatal(err)
	}
	a := testApp(t)
	a.cfg.WebDir = dir
	do := func(method, encoding, rng string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, "/assets/app.js", nil)
		req.Header.Set("Accept-Encoding", encoding)
		if rng != "" {
			req.Header.Set("Range", rng)
		}
		rec := httptest.NewRecorder()
		a.Handler().ServeHTTP(rec, req)
		return rec
	}
	rec := do("GET", "gzip", "")
	if rec.Code != 200 || rec.Header().Get("Content-Encoding") != "gzip" || rec.Header().Get("Content-Type") != "text/javascript; charset=utf-8" || rec.Header().Get("Vary") != "Accept-Encoding" {
		t.Fatalf("bad compressed headers: %d %+v", rec.Code, rec.Header())
	}
	reader, err := gzip.NewReader(rec.Body)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := io.ReadAll(reader)
	if err != nil || !bytes.Equal(decoded, original) {
		t.Fatalf("compressed payload differs: %v", err)
	}
	head := do("HEAD", "gzip", "")
	if head.Code != 200 || head.Body.Len() != 0 || head.Header().Get("Content-Length") != rec.Header().Get("Content-Length") {
		t.Fatalf("HEAD differs: %d %+v", head.Code, head.Header())
	}
	part := do("GET", "gzip", "bytes=0-9")
	if part.Code != 206 || !bytes.Equal(part.Body.Bytes(), compressed.Bytes()[:10]) {
		t.Fatalf("range invalid: %d %q", part.Code, part.Body.Bytes())
	}
	plain := do("GET", "gzip;q=0, *;q=1", "")
	if plain.Header().Get("Content-Encoding") != "" || !bytes.Equal(plain.Body.Bytes(), original) {
		t.Fatal("explicit gzip rejection ignored")
	}
	for _, encoding := range []string{"gzip;q=0.5", "br, gzip", "*;q=0.7"} {
		if !acceptsGzip(encoding) {
			t.Errorf("gzip not accepted: %s", encoding)
		}
	}
	for _, encoding := range []string{"", "br", "gzip;q=0", "gzip;q=invalid"} {
		if acceptsGzip(encoding) {
			t.Errorf("gzip accepted incorrectly: %s", encoding)
		}
	}
}
