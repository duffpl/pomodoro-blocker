// Shared by popup.js and options.js (plain script include, no modules).
// Normalizes lines to lowercase bare domains; throws on entries that don't
// look like a domain after stripping scheme/path/leading www.
function parseDomains(text) {
  const domains = [];
  for (let line of text.split("\n")) {
    line = line.trim().toLowerCase();
    if (!line) continue;
    line = line.replace(/^[a-z]+:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(line)) {
      throw new Error(`Invalid domain: ${line}`);
    }
    domains.push(line);
  }
  return [...new Set(domains)];
}
