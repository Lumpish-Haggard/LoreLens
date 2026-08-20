# Upstream request to LNReader

Draft for an issue on <https://github.com/LNReader/lnreader>.

**Note on framing.** This is *not* a request for a file-system permission.
LNReader already holds the Android permissions it needs, and they are held by the
app process — the WebView document is sandboxed separately and inherits none of
them. Asking for file access would be asking for the wrong thing and would
rightly be declined. The actual ask is one property on the WebView's `source`.

Copy from the line below.

---

**Title:** Reader WebView has no origin, so custom JS cannot use `localStorage`

**Labels:** enhancement

---

### What happens

Scripts added under the reader's custom JS setting cannot store anything.
`localStorage`, `sessionStorage`, cookies and IndexedDB all fail. Anything a
script wants to remember is lost the moment the reader is closed.

### Why

The reader WebView is created with an inline `html` source and no `baseUrl`, in
`src/screens/reader/components/WebViewReader.tsx`:

```jsx
source={{ html: `...` }}
```

On Android that becomes `loadDataWithBaseURL(null, ...)`, so the document has an
opaque origin. Browsers refuse origin-scoped storage for opaque origins, so
`window.localStorage` throws on access. `domStorageEnabled` is not the problem —
it defaults to `true` and LNReader does not override it.

Measured in the reader on a device (Android 16, LNReader current):

```
origin:          null
secure context:  false
localStorage:    throws
sessionStorage:  throws
```

`secure context: false` follows from the same cause, and takes out
`navigator.clipboard` and everything else gated behind it.

### Suggested change

Give the document an origin by setting `baseUrl`:

```jsx
source={{
  html: `...`,
  baseUrl: 'https://lnreader.local/',   // any stable value
}}
```

react-native-webview documents `baseUrl` as "the base URL to be used for any
relative links in the HTML. This is also used for the origin header with CORS
requests made from the WebView."

### What this would fix

- Custom JS could persist settings between chapters and across sessions. Today
  any script with a per-novel setting has to ask for it again every time the
  novel is opened.
- Cross-origin `fetch` from custom JS would send a real `Origin` header instead
  of `null`. `Origin: null` is the worst case for CORS and many APIs reject it
  outright, which is a common cause of `Failed to fetch` from reader scripts.
- `navigator.clipboard` and other secure-context APIs would start working.

### What to check before merging

A base URL changes how relative URLs resolve, so the two things worth testing
are the ones that depend on that:

- relative `src` attributes in chapter HTML from plugins that emit them;
- the `delayed-src` image loading path, which posts `imgfile` messages and then
  sets `img.src` — worth confirming the base URL does not affect how those
  resolve.

Picking a base URL that no plugin serves from (a `.local` host, say) keeps it
clear of any real source domain.

### Context

Found while building a reader script that shows a character's wiki entry inline
while reading. Happy to test a build if that is useful.
