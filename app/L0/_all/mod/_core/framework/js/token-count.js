import { Tiktoken } from "./vendor/js-tiktoken-lite.js";
import o200kBase from "./vendor/js-tiktoken-o200k_base.js";

let tokenizer = null;

function getTokenizer() {
  if (!tokenizer) {
    tokenizer = new Tiktoken(o200kBase);
  }

  return tokenizer;
}

export function countTextTokens(text = "") {
  const normalizedText = typeof text === "string" ? text : String(text ?? "");

  if (!normalizedText.length) {
    return 0;
  }

  return getTokenizer().encode(normalizedText, "all").length;
}
