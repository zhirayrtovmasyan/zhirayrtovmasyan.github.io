// Import the publication table from the private CV's cv.tex; never execute LaTeX.
const fs = require("node:fs");
const { resolve } = require("node:path");

function group(text, start) {
  if (text[start] !== "{") throw new Error("Expected a braced value.");
  let depth = 1;
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "\\") {
      i++;
      continue;
    }
    if (text[i] === "{") depth++;
    if (text[i] === "}" && --depth === 0) return { value: text.slice(start + 1, i), end: i + 1 };
  }
  throw new Error("Unbalanced braces in publication data.");
}

function plain(text) {
  text = text
    .replace(/\\([&%_#$])/g, "$1")
    .replace(/\\(?: |,|;|!)/g, " ")
    .replace(/~/g, " ");
  while (/\\(?:textbf|textsc|emph|mbox)\s*\{/.test(text)) {
    text = text.replace(/\\(?:textbf|textsc|emph|mbox)\s*(?=\{)/, "");
  }
  if (/\\[a-z]+/i.test(text)) throw new Error(`Unsupported LaTeX command in publication: ${text}`);
  return text.replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

const normalized = (title) =>
  plain(title)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");

function parseCv(source, year) {
  source = source.replace(/(?<!\\)%[^\n]*/g, "");
  const section = source.match(/\\section\{Publications and Preprints\}([\s\S]*?)(?=\\section\{|$)/)?.[1];
  const table = section?.match(/\\begin\{tabular\}\{[^}]+\}([\s\S]*?)\\end\{tabular\}/)?.[1];
  if (!table) throw new Error("CV publication table was not found; bibliography was not changed.");
  const papers = [];
  const rows = [...table.matchAll(/\\textsc\{([^{}]+)\}\s*&([\s\S]*?)(?=\\textsc\{|$)/g)];
  const labels = (table.match(/\\textsc\{/g) || []).length;
  if (!rows.length || rows.length !== labels) throw new Error("Could not read every CV publication row.");
  for (const [, label, row] of rows) {
    const parts = row.match(/^([\s\S]*?),\s*``([\s\S]*?),''([\s\S]*)$/);
    if (!parts) throw new Error(`Could not read publication title/authors for ${label}.`);
    const [, authorText, titleText, tail] = parts;
    let title = titleText.trim();
    let url;
    if (title.startsWith("\\href{")) {
      const link = group(title, "\\href".length);
      const caption = group(title, link.end);
      if (title.slice(caption.end).trim()) throw new Error("Unexpected text after linked publication title.");
      url = link.value;
      if (!/^https:\/\//.test(url) || /[\s{}\\]/.test(url)) throw new Error("Publication links must be HTTPS URLs.");
      title = caption.value;
    }
    const authors = plain(authorText)
      .split(/\s*,\s*/)
      .map((name) => {
        const match = name.match(/^((?:\p{L}\.\s*)+)(.+)$/u);
        if (!match) throw new Error(`Expected initials and surname, got ${name}.`);
        return `${match[2]}, ${match[1].trim()}`;
      });
    const venue = tail.match(/\\emph\{/);
    const arxiv = url?.match(/^https:\/\/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?$/)?.[1];
    papers.push({
      title: plain(title),
      authors,
      label: plain(label),
      year: label.match(/\b(20\d{2})\b/)?.[1] || tail.match(/\b(20\d{2})\b/)?.[1],
      fallbackYear: String(year),
      venue: venue ? plain(group(tail, venue.index + "\\emph".length).value) : "",
      underReview: /under review/i.test(label),
      url,
      arxiv,
    });
  }
  if (new Set(papers.map((paper) => normalized(paper.title))).size !== papers.length) throw new Error("Duplicate titles in CV.");
  return papers;
}

function parseBib(source) {
  const entries = [];
  for (const match of source.matchAll(/@(\w+)\s*(?=\{)/g)) {
    const body = group(source, match.index + match[0].length);
    const comma = body.value.indexOf(",");
    if (comma < 0) throw new Error("BibTeX entry is missing its key.");
    const fields = {};
    let rest = body.value.slice(comma + 1).trim();
    while (rest) {
      const field = rest.match(/^(\w+)\s*=\s*/);
      if (!field) throw new Error("Unsupported BibTeX syntax; expected named braced fields.");
      const value = group(rest, field[0].length);
      fields[field[1]] = value.value;
      rest = rest.slice(value.end).replace(/^\s*,?\s*/, "");
    }
    entries.push({ type: match[1], key: body.value.slice(0, comma).trim(), fields, start: match.index, end: body.end });
  }
  if (!entries.length || entries.some((entry) => !entry.fields.title || !entry.fields.author)) throw new Error("Invalid bibliography.");
  return entries;
}

function validateSelection(selection) {
  if (!Array.isArray(selection)) throw new Error("Publication selection must be a JSON array.");
  const keys = new Set();
  const titles = new Set();
  const arxivIds = new Set();
  for (const item of selection) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.key !== "string" ||
      !/^[a-z][a-z0-9_-]*$/i.test(item.key) ||
      typeof item.title !== "string" ||
      !normalized(item.title) ||
      !["excluded", "included", "selected"].includes(item.visibility) ||
      (item.arxiv !== undefined && (typeof item.arxiv !== "string" || !/^\d{4}\.\d{4,5}$/.test(item.arxiv))) ||
      (item._comment !== undefined && typeof item._comment !== "string") ||
      Object.keys(item).some((key) => !["key", "title", "arxiv", "visibility", "_comment"].includes(key))
    ) {
      throw new Error("Invalid publication selection: use key, title, optional arxiv, and visibility (excluded/included/selected).");
    }
    if (keys.has(item.key) || titles.has(normalized(item.title)) || (item.arxiv && arxivIds.has(item.arxiv))) {
      throw new Error("Duplicate key, title, or arXiv ID in publication selection.");
    }
    keys.add(item.key);
    titles.add(normalized(item.title));
    if (item.arxiv) arxivIds.add(item.arxiv);
  }
  return selection;
}

function renderEntry(type, key, fields) {
  return `@${type}{${key},\n${Object.entries(fields)
    .map(([name, value]) => `  ${name.padEnd(8)} = {${value}}`)
    .join(",\n")}\n}`;
}

function applyPublicationSelection(bib, selection) {
  const policies = new Map(validateSelection(selection).map((item) => [item.key, item]));
  const entries = parseBib(bib);
  let output = bib;
  for (const entry of entries.reverse()) {
    const visibility = policies.get(entry.key)?.visibility || "excluded";
    const fields = {
      ...entry.fields,
      selected: String(visibility === "selected"),
      website_visible: String(visibility !== "excluded"),
    };
    if (JSON.stringify(fields) !== JSON.stringify(entry.fields)) {
      output = output.slice(0, entry.start) + renderEntry(entry.type, entry.key, fields) + output.slice(entry.end);
    }
  }
  return output;
}

function syncPublications(cv, bib, selection, year = new Date().getUTCFullYear()) {
  const policies = validateSelection(selection);
  const papers = parseCv(cv, year);
  const entries = parseBib(bib);
  const authorNames = new Map();
  for (const entry of entries) {
    for (const author of entry.fields.author.split(/\s+and\s+/)) {
      const [surname, first] = author.split(/,\s*/);
      if (!surname || !first) throw new Error("Expected BibTeX authors in Surname, First format.");
      const alias = normalized(`${surname}, ${first[0]}`);
      const previous = authorNames.get(alias);
      if (!previous || previous.length < author.length) authorNames.set(alias, author);
    }
  }
  const matched = new Set();
  const replacements = [];
  const additions = [];
  let imported = 0;
  for (const paper of papers) {
    const candidates = entries.filter(
      (entry) => normalized(entry.fields.title) === normalized(paper.title) || (paper.arxiv && entry.fields.arxiv === paper.arxiv)
    );
    if (candidates.length > 1) throw new Error(`Ambiguous bibliography match for ${paper.title}.`);
    const matchingPolicies = policies.filter(
      (item) => item.key === candidates[0]?.key || normalized(item.title) === normalized(paper.title) || (item.arxiv && item.arxiv === paper.arxiv)
    );
    if (matchingPolicies.length > 1) throw new Error(`Ambiguous publication selection for ${paper.title}.`);
    const policy = matchingPolicies[0];
    if (!policy || policy.visibility === "excluded") continue;
    const existing = entries.find((entry) => entry.key === policy.key) || candidates[0];
    if (candidates[0] && existing?.key !== candidates[0].key) throw new Error(`Conflicting selection key for ${paper.title}.`);
    if (existing && existing.key !== policy.key) throw new Error(`Keep the existing BibTeX key ${existing.key} in publication selection.`);
    if (existing && matched.has(existing.key)) throw new Error("Multiple CV papers matched one bibliography entry.");
    if (existing) matched.add(existing.key);
    imported++;
    const fields = { ...existing?.fields };
    fields.title = paper.title;
    fields.author = paper.authors
      .map((author) => {
        const [surname, initial] = author.split(/,\s*/);
        return authorNames.get(normalized(`${surname}, ${initial[0]}`)) || author;
      })
      .join(" and ");
    fields.year = paper.year || fields.year || paper.fallbackYear;
    const withoutYear = (label) => label.replace(/\s*20\d{2}\b/g, "").trim();
    if (!fields.abbr || withoutYear(fields.abbr) !== withoutYear(paper.label)) fields.abbr = paper.label;
    if (paper.underReview) fields.note = "Manuscript under review";
    else if (/under review/i.test(fields.note || "")) delete fields.note;
    const type = paper.underReview
      ? "unpublished"
      : /journal|transactions/i.test(paper.venue)
        ? "article"
        : /conference|proceedings/i.test(paper.venue)
          ? "inproceedings"
          : existing?.type === "unpublished"
            ? "misc"
            : existing?.type || "misc";
    if (paper.venue && !/^(?:manuscript under review|arXiv preprint)$/i.test(paper.venue)) {
      const venueField = type === "article" ? "journal" : "booktitle";
      fields[venueField] = paper.venue;
    }
    if (paper.arxiv) fields.arxiv = paper.arxiv;
    else if (paper.url) fields[/\.pdf(?:\?|$)/i.test(paper.url) ? "pdf" : "html"] = paper.url;
    fields.selected = String(policy.visibility === "selected");
    const key = policy.key;
    if (!existing && [...entries, ...additions].some((entry) => entry.key === key)) throw new Error(`Duplicate BibTeX key: ${key}.`);
    const rendered = renderEntry(type, key, fields);
    if (!existing) additions.push({ key, rendered });
    else if (type !== existing.type || JSON.stringify(fields) !== JSON.stringify(existing.fields)) replacements.push({ ...existing, rendered });
  }
  let output = bib;
  for (const entry of replacements.sort((a, b) => b.start - a.start))
    output = output.slice(0, entry.start) + entry.rendered + output.slice(entry.end);
  if (additions.length) output = output.trimEnd() + "\n\n" + additions.map((entry) => entry.rendered).join("\n\n") + "\n";
  return { output: applyPublicationSelection(output, policies), count: papers.length, imported, skipped: papers.length - imported };
}

if (require.main === module) {
  try {
    const [cvPath, bibPath = "_bibliography/papers.bib", selectionPath = "_data/publication_selection.json", ...extra] = process.argv.slice(2);
    if (!cvPath || extra.length) {
      throw new Error("Usage: node bin/sync_cv_publications.cjs <cv.tex|--selection-only> [papers.bib] [publication_selection.json]");
    }
    const selection = JSON.parse(fs.readFileSync(selectionPath, "utf8"));
    const bib = fs.readFileSync(bibPath, "utf8").replace(/\r\n/g, "\n");
    const result =
      cvPath === "--selection-only"
        ? { output: applyPublicationSelection(bib, selection) }
        : syncPublications(fs.readFileSync(cvPath, "utf8"), bib, selection);
    const { output } = result;
    if (output !== bib) {
      const temporary = resolve(`${bibPath}.tmp`);
      fs.writeFileSync(temporary, output, "utf8");
      fs.renameSync(temporary, bibPath);
    }
    if (result.count !== undefined) console.log(`Checked ${result.count} CV publications: ${result.imported} opted in, ${result.skipped} skipped.`);
    console.log(`Publication selection applied; bibliography ${output === bib ? "already up to date" : "updated"}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { syncPublications, applyPublicationSelection };
