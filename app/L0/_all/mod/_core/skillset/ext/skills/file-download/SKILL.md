---
name: File Download
description: Download app files, generated blobs, or external URLs
metadata:
  when:
    tags:
      - onscreen
---

Use this skill when the user asks how to let the browser download a file, whether it lives in the app filesystem, is generated at runtime, or comes from an external URL.

## Downloading App Filesystem Files

The server serves authenticated files directly at their layer paths. Use a URL built from `location.href` so the request carries the session cookie and the server enforces read permissions.

### From the authenticated user's home folder (`~/`)

`/~/...` maps to `L2/<username>/...` for the currently logged-in user.

```js
const u = new URL(location.href);
u.pathname = '/~/BTC_ETH_ratio_chart.pdf';
const a = document.createElement('a');
a.href = u.toString();
a.download = 'BTC_ETH_ratio_chart.pdf';
a.click();
```

### From a specific layer path (`/L0/`, `/L1/`, `/L2/`)

Use the full layer path directly. The server checks that the authenticated user has read access before serving.

```js
function downloadAppFile(layerPath, filename) {
  // layerPath example: 'L0/_all/mod/_core/reports/template.pdf'
  const u = new URL(location.href);
  u.pathname = `/${layerPath}`;
  const a = document.createElement('a');
  a.href = u.toString();
  a.download = filename;
  a.click();
}

// Examples:
downloadAppFile('L0/_all/mod/_core/reports/template.pdf', 'template.pdf');
downloadAppFile('L2/alice/exports/summary.csv', 'summary.csv');
```

Read permissions follow the same rules as the file APIs:
- `L2/<username>/` own files only
- `L0/<group>/` and `L1/<group>/` group members only
- unauthenticated requests return 401 and unauthorized paths return 403

## Downloading Runtime-Generated In-Memory Content

For files generated on the fly, create a `Blob`, make an object URL, and revoke it after the click.

```js
function downloadBlob(content, filename, mimeType = 'text/plain') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

downloadBlob('hello world', 'note.txt', 'text/plain');

const csv = 'name,value\nalice,42\nbob,17';
downloadBlob(csv, 'data.csv', 'text/csv');

const json = JSON.stringify({ status: 'ok', items: [1, 2, 3] }, null, 2);
downloadBlob(json, 'result.json', 'application/json');

const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
downloadBlob(bytes, 'output.pdf', 'application/pdf');
```

## Downloading External Files

Fetch the remote file through the server proxy so the request is not blocked by CORS, then turn the response into a Blob download.

```js
async function downloadExternalFile(externalUrl, filename) {
  const response = await space.api.call('proxy', {
    method: 'POST',
    body: { url: externalUrl }
  });

  if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

await downloadExternalFile('https://example.com/report.pdf', 'report.pdf');
```

If the external URL is public and CORS allows direct access from the browser, you can skip the proxy and fetch it directly with `fetch(externalUrl)` and the same Blob pattern.
