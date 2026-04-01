import { buildProxyUrl } from "./proxy-url.js";

function getFilenameFromContentDisposition(contentDisposition) {
  if (!contentDisposition) {
    return null;
  }

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) {
    return decodeURIComponent(utf8Match[1]);
  }

  const quotedMatch = contentDisposition.match(/filename="([^"]+)"/i);
  if (quotedMatch) {
    return quotedMatch[1];
  }

  const plainMatch = contentDisposition.match(/filename=([^;]+)/i);
  return plainMatch ? plainMatch[1].trim() : null;
}

function getFilenameFromUrl(url) {
  const pathname = new URL(url, window.location.href).pathname;
  const candidate = pathname.split("/").filter(Boolean).pop();
  return candidate || "download";
}

export async function downloadProxiedFile(targetUrl, options = {}) {
  const proxyPath = options.proxyPath || "/api/proxy";
  const response = await fetch(buildProxyUrl(targetUrl, { proxyPath }));

  if (!response.ok) {
    throw new Error(`Download failed with status ${response.status}`);
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const contentDisposition = response.headers.get("content-disposition");
  const filename =
    options.filename || getFilenameFromContentDisposition(contentDisposition) || getFilenameFromUrl(targetUrl);

  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();

  setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 0);

  return {
    filename,
    size: blob.size,
    type: blob.type || response.headers.get("content-type") || "application/octet-stream"
  };
}
