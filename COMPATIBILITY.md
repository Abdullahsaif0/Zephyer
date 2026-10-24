# Live website compatibility smoke test

Run: 2026-10-23T18:43:29.840Z

Automated Chromium extension tests on public pages. Counts are initial discovery after a short settle, before full-page scan. Fetch checks stop after response headers; they do not prove complete download or conversion. Login walls and anti-bot responses are recorded as blocked, never passed. Manual account-specific social-feed verification remains pending.

Default policy: JPEG/PNG with Smart cleanup. Useful/excluded/pending counts are recorded separately. An excluded image is a filtering outcome, not a browser failure.

| Category | Website | Detection | Candidates / useful / excluded / pending | Sample fetch | Notes |
|---|---|---|---:|---|---|
| Social galleries | [Pinterest](https://www.pinterest.com/search/pins/?q=mountains) | incomplete shell | 1 / 1 / 0 / 0 | 200 image/png | HTTP 200; Pinterest; Screenshot review: blank content shell with one PNG candidate; full image-feed compatibility is unverified. |
| Image search | [Google Images](https://www.google.com/search?tbm=isch&q=mountains) | challenge page (HTTP 200) | 0 / 0 / 0 / 0 | not tested | HTTP 200; https://www.google.com/search?q=mountains&udm=2&sei=Gqrbap_XHLmW9u8Po5WHiQ0; Screenshot review: Google returned an unusual-traffic challenge; search images were unavailable. |
| Image search | [Bing Images](https://www.bing.com/images/search?q=mountains) | navigation/network blocked | 0 / 0 / 0 / 0 | not tested | TimeoutError: page.goto: Timeout 25000ms exceeded. Call log: [2m  - navigating to "https://www.bing.com/images/search?q=mountains", waiting until "domcontentloaded"[22m  |
| Social galleries | [Instagram](https://www.instagram.com/nasa/) | navigation/network blocked | 0 / 0 / 0 / 0 | not tested | TimeoutError: page.goto: Timeout 25000ms exceeded. Call log: [2m  - navigating to "https://www.instagram.com/nasa/", waiting until "domcontentloaded"[22m  |
| Commerce | [IKEA](https://www.ikea.com/us/en/) | navigation/network blocked | 0 / 0 / 0 / 0 | not tested | TimeoutError: page.goto: Timeout 25000ms exceeded. Call log: [2m  - navigating to "https://www.ikea.com/us/en/", waiting until "domcontentloaded"[22m  |
| Commerce | [Shopify store](https://www.allbirds.com/) | navigation/network blocked | 0 / 0 / 0 / 0 | not tested | TimeoutError: page.goto: Timeout 25000ms exceeded. Call log: [2m  - navigating to "https://www.allbirds.com/", waiting until "domcontentloaded"[22m  |
| Publishing | [Smashing Magazine](https://www.smashingmagazine.com/) | detection passed | 30 / 18 / 12 / 0 | TimeoutError: signal timed out | HTTP 200; Smashing Magazine — For Web Designers And Developers |
| Publishing | [WordPress](https://wordpress.org/news/) | detection passed | 36 / 12 / 24 / 0 | 200 image/jpeg | HTTP 200; WordPress News – The latest news about WordPress and the WordPress community |
| Commerce | [Amazon](https://www.amazon.com/) | incomplete shell | 0 / 0 / 0 / 0 | not tested | HTTP 202; ; Screenshot review: blank content shell; no image content rendered within the smoke-test window. |
| Photography | [Pexels](https://www.pexels.com/search/mountains/) | HTTP 403 blocked/rate-limited | 1 / 0 / 1 / 0 | not tested | HTTP 403; Just a moment... |
| Photography | [Unsplash](https://unsplash.com/s/photos/mountains) | HTTP 403 blocked/rate-limited | 1 / 0 / 1 / 0 | not tested | HTTP 403; Oh noes! |
| Publishing | [The Guardian](https://www.theguardian.com/international) | detection passed | 141 / 111 / 30 / 0 | 200 image/jpeg | HTTP 200; Latest news, sport and opinion from the Guardian |
| Photography | [Wikimedia Commons](https://commons.wikimedia.org/wiki/Main_Page) | navigation/network blocked | 0 / 0 / 0 / 0 | not tested | TimeoutError: page.goto: Timeout 25000ms exceeded. Call log: [2m  - navigating to "https://commons.wikimedia.org/wiki/Main_Page", waiting until "domcontentloaded"[22m  |
| Science and education | [NASA](https://www.nasa.gov/) | navigation/network blocked | 0 / 0 / 0 / 0 | not tested | TimeoutError: page.goto: Timeout 25000ms exceeded. Call log: [2m  - navigating to "https://www.nasa.gov/", waiting until "domcontentloaded"[22m  |
| Science and education | [Wikipedia](https://en.wikipedia.org/wiki/Mountain) | detection passed | 31 / 15 / 16 / 0 | 200 image/jpeg | HTTP 200; Mountain - Wikipedia |
| Science and education | [Smithsonian](https://www.si.edu/) | HTTP 403 blocked/rate-limited | 1 / 0 / 1 / 0 | not tested | HTTP 403; Just a moment... |
| Design portfolios | [Dribbble](https://dribbble.com/) | navigation/network blocked | 0 / 0 / 0 / 0 | not tested | TimeoutError: page.goto: Timeout 25000ms exceeded. Call log: [2m  - navigating to "https://dribbble.com/", waiting until "domcontentloaded"[22m  |
| Design portfolios | [Behance](https://www.behance.net/) | navigation/network blocked | 0 / 0 / 0 / 0 | not tested | TimeoutError: page.goto: Timeout 25000ms exceeded. Call log: [2m  - navigating to "https://www.behance.net/", waiting until "domcontentloaded"[22m  |
| Documentation and software | [MDN](https://developer.mozilla.org/en-US/) | navigation/network blocked | 0 / 0 / 0 / 0 | not tested | TimeoutError: page.goto: Timeout 25000ms exceeded. Call log: [2m  - navigating to "https://developer.mozilla.org/en-US/", waiting until "domcontentloaded"[22m  |
| Documentation and software | [GitHub](https://github.com/) | navigation/network blocked | 0 / 0 / 0 / 0 | not tested | TimeoutError: page.goto: Timeout 25000ms exceeded. Call log: [2m  - navigating to "https://github.com/", waiting until "domcontentloaded"[22m  |

Screenshot review corrected the automated candidate-only labels for Google, Pinterest and Amazon. Blank/challenge pages are not compatibility passes. The untouched automated observations are retained in test-results/compatibility/automatic-results.json. Failed navigations have no current screenshot; old image files in the evidence folder must not be treated as current results.

This 1.4.0 attempt detected content on WordPress, Smashing Magazine, The Guardian and Wikipedia. Three pages returned HTTP 403, ten navigations were blocked/timed out, Google served an HTTP-200 challenge, and Pinterest/Amazon did not render usable content. Sample fetches check response headers only; authenticated feeds, full scans and real-site downloads are not certified.
