import readline from "node:readline";

function attachPrefixedLineLog(stream, prefix, onLine = null) {
  const reader = readline.createInterface({
    crlfDelay: Infinity,
    input: stream
  });

  reader.on("line", (line) => {
    if (typeof onLine === "function") {
      onLine(line);
    }

    console.log(`${prefix} ${line}`);
  });

  return reader;
}

export { attachPrefixedLineLog };
