# Vendored libraries

Third-party code the app loads on demand, kept in the repo instead of on a
CDN. The service worker caches these like it cached the CDN copies, nothing
outside this repo can change what runs in the app, and each one is pinned to
a version that has been looked at. Verify a file with:

    openssl dgst -sha384 -binary <file> | openssl base64 -A

| Library | Version | File | Source | SHA-384 |
|---|---|---|---|---|
| pdf.js | 4.10.38 | pdfjs/pdf.min.mjs | https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs | +0ti2moQlmLN7WZHE2RHIf5lV8hHxhxEalN0il3YZceG26fUPyOkR0hp9daxk1i7 |
| pdf.js worker | 4.10.38 | pdfjs/pdf.worker.min.mjs | https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs | ToeVvShCxKc6CEvhHeMt0Q8A06pSPDbAlngO9nokrDmh914gk/pYd0N7D0a4Lz2o |
| heic2any | 0.0.4 | heic2any/heic2any.min.js | https://cdnjs.cloudflare.com/ajax/libs/heic2any/0.0.4/heic2any.min.js | OTofQ0MEeiSgh62havBcemCIK0gqj809wX6UA0uPISNMRnR6NZyCdGzX3SbLrgwL |
| html2pdf.js | 0.14.0 | html2pdf/html2pdf.bundle.min.js | https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.14.0/html2pdf.bundle.min.js | EaWTV/aVUkLz3tfwg3+5ycX7Q/d9ET9ruOKUgUuFIRUCfzHO1eo2J62a844iWPmY |

Why pdf.js moved: 3.11.174 had a bug (CVE-2024-4367) that let a crafted PDF
run script in the page. 4.x fixes it, and every `getDocument` call in the app
also passes `isEvalSupported: false` (see `openPdf` in js/utils.js).

The Firebase SDK still loads from www.gstatic.com, pinned by `integrity`
attributes on each script tag (index.html, login.html, group-admin.html).
To upgrade it, change the version in the URL and recompute the hashes with
the command above against the new files.
