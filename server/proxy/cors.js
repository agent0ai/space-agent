const API_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Expose-Headers": "*"
};

function applyApiCorsHeaders(res) {
  Object.entries(API_CORS_HEADERS).forEach(([name, value]) => {
    res.setHeader(name, value);
  });
}

function handleApiPreflight(req, res) {
  if (req.method !== "OPTIONS") {
    return false;
  }

  applyApiCorsHeaders(res);
  res.writeHead(204);
  res.end();
  return true;
}

module.exports = {
  API_CORS_HEADERS,
  applyApiCorsHeaders,
  handleApiPreflight
};
