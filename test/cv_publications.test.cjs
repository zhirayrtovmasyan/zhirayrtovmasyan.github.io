const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { syncPublications: syncWithSelection, applyPublicationSelection } = require("../bin/sync_cv_publications.cjs");

const selection = [
  {
    key: "existing2026",
    title: "SCAFFOLD under Hessian Similarity: Sharp Convergence Rates",
    arxiv: "2610.35663",
    visibility: "selected",
  },
];
const syncPublications = (cv, bibliography, year) => syncWithSelection(cv, bibliography, selection, year);

const table = (rows) => `\\section{Publications and Preprints}
\\begin{tabular}{D|C}
${rows}
\\end{tabular}
\\section{Experience}
Private material outside the publication table is never imported.`;

const row = (label, title, tail = "\\emph{manuscript under review}.") =>
  `\\textsc{${label}}
  & \\textbf{Z.\\ Tovmasyan}, S.\\ Hanzely, \`\`${title},'' ${tail} \\\\
\\multicolumn{2}{c}{} \\\\`;

const bib = `---
---

@unpublished{existing2026,
  abbr     = {Under Review},
  title    = {SCAFFOLD under Hessian Similarity: Sharp Convergence Rates},
  author   = {Tovmasyan, Zhirayr and Hanzely, S.},
  year     = {2026},
  note     = {Manuscript under review},
  doi      = {10.1234/retained},
  selected = {true}
}
`;
const title = "\\href{https://arxiv.org/abs/2610.35663}{\\mbox{SCAFFOLD} under Hessian Similarity: Sharp Convergence Rates}";

test("imports a nested LaTeX title's arXiv link while retaining full names, DOI, and key", () => {
  const { output, count } = syncPublications(table(row("Under Review", title)), bib, 2027);
  assert.equal(count, 1);
  assert.match(output, /arxiv\s*= \{2610\.35663\}/);
  assert.match(output, /doi\s*= \{10\.1234\/retained\}/);
  assert.match(output, /author\s*= \{Tovmasyan, Zhirayr and Hanzely, S\.\}/);
  assert.match(output, /@unpublished\{existing2026,/);
  assert.match(output, /year\s*= \{2026\}/);
  assert.doesNotMatch(output, /Private material/);
});

test("repeated sync is byte-for-byte idempotent", () => {
  const source = table(row("Under Review", title));
  const first = syncPublications(source, bib).output;
  assert.equal(syncPublications(source, first).output, first);
});

test("new CV papers stay off the website until explicitly opted in", () => {
  const source = table(row("Under Review", title) + "\n" + row("Under Review", "A new optimization result"));
  const { output, count, imported, skipped } = syncPublications(source, bib, 2026);
  assert.equal(count, 2);
  assert.equal(imported, 1);
  assert.equal(skipped, 1);
  assert.doesNotMatch(output, /A new optimization result/);
  assert.equal(syncPublications(source, output, 2027).output, output);
});

test("included papers appear only on Publications; selected papers appear on both listings", () => {
  const source = table(row("Under Review", title) + "\n" + row("Under Review", "A new optimization result"));
  const policies = [...selection, { key: "new2026", title: "A new optimization result", visibility: "included" }];
  const { output, imported } = syncWithSelection(source, bib, policies, 2026);
  assert.equal(imported, 2);
  const existing = output.match(/@unpublished\{existing2026,([\s\S]*?)\n\}/)[1];
  const added = output.match(/@unpublished\{new2026,([\s\S]*?)\n\}/)[1];
  assert.match(existing, /selected\s*= \{true\}/);
  assert.match(existing, /website_visible\s*= \{true\}/);
  assert.match(added, /selected\s*= \{false\}/);
  assert.match(added, /website_visible\s*= \{true\}/);
  assert.equal(syncWithSelection(source, output, policies, 2027).output, output);
});

test("explicitly excluded new papers are not imported", () => {
  const source = table(row("Under Review", title) + "\n" + row("Under Review", "An excluded result"));
  const policies = [...selection, { key: "excluded2026", title: "An excluded result", visibility: "excluded" }];
  const { output, skipped } = syncWithSelection(source, bib, policies, 2026);
  assert.equal(skipped, 1);
  assert.doesNotMatch(output, /An excluded result/);
});

test("excluding or unlisting an existing paper hides it without deleting its metadata", () => {
  for (const policies of [[], [{ ...selection[0], visibility: "excluded" }]]) {
    const { output, imported } = syncWithSelection(table(row("Under Review", title)), bib, policies);
    assert.equal(imported, 0);
    assert.match(output, /@unpublished\{existing2026,/);
    assert.match(output, /doi\s*= \{10\.1234\/retained\}/);
    assert.match(output, /selected\s*= \{false\}/);
    assert.match(output, /website_visible\s*= \{false\}/);
    assert.doesNotMatch(output, /arxiv\s*=/);
  }
});

test("selection changes take effect without reading the private CV", () => {
  const hidden = applyPublicationSelection(bib, []);
  const included = applyPublicationSelection(hidden, [{ ...selection[0], visibility: "included" }]);
  assert.match(included, /selected\s*= \{false\}/);
  assert.match(included, /website_visible\s*= \{true\}/);
  const featured = applyPublicationSelection(included, selection);
  assert.match(featured, /selected\s*= \{true\}/);
  assert.match(featured, /website_visible\s*= \{true\}/);
  assert.match(featured, /doi\s*= \{10\.1234\/retained\}/);
  assert.equal(applyPublicationSelection(featured, selection), featured);
});

test("invalid or duplicate visibility settings fail instead of silently changing visibility", () => {
  for (const policies of [
    undefined,
    {},
    [{ ...selection[0], visibility: "selectd" }],
    [...selection, selection[0]],
    [{ ...selection[0], arxiv: 2610.35663 }],
  ]) {
    assert.throws(() => applyPublicationSelection(bib, policies));
  }
});

test("updated title selectors preserve stable keys and metadata for renamed undated drafts", () => {
  const revised = "SCAFFOLD with a revised title";
  const policy = [{ key: "existing2026", title: revised, visibility: "selected" }];
  const { output } = syncWithSelection(table(row("Under Review", revised)), bib, policy);
  assert.equal((output.match(/@unpublished/g) || []).length, 1);
  assert.match(output, /@unpublished\{existing2026,/);
  assert.match(output, /doi\s*= \{10\.1234\/retained\}/);
});

test("matches a renamed paper by arXiv ID instead of duplicating it", () => {
  const original = syncPublications(table(row("Under Review", title)), bib).output;
  const revised = title.replace("Sharp Convergence Rates", "Improved Rates");
  const output = syncPublications(table(row("Under Review", revised)), original).output;
  assert.equal((output.match(/@unpublished/g) || []).length, 1);
  assert.match(output, /Improved Rates/);
});

test("updates venue/status/year and primary links on acceptance", () => {
  const linked = "\\href{https://openreview.net/forum?id=example}{SCAFFOLD under Hessian Similarity: Sharp Convergence Rates}";
  const source = table(row("ICLR 2027", linked, "\\emph{International Conference on Learning Representations}, 2027."));
  const output = syncPublications(source, bib).output;
  assert.match(output, /abbr\s*= \{ICLR 2027\}/);
  assert.match(output, /year\s*= \{2027\}/);
  assert.match(output, /booktitle\s*= \{International Conference on Learning Representations\}/);
  assert.match(output, /@inproceedings\{existing2026,/);
  assert.match(output, /html\s*= \{https:\/\/openreview.net\/forum\?id=example\}/);
  assert.doesNotMatch(output, /under review/i);
});

test("adds PDF links and retains bibliography entries omitted from the CV", () => {
  const source = table(row("JNVA 2026", "\\href{https://example.org/paper.pdf}{Another result}", "\\emph{A Journal}, 2026."));
  const policies = [...selection, { key: "another2026", title: "Another result", visibility: "included" }];
  const output = syncWithSelection(source, bib, policies).output;
  assert.match(output, /pdf\s*= \{https:\/\/example.org\/paper.pdf\}/);
  assert.match(output, /existing2026/);
});

test("rejects missing, empty, malformed, or partially readable tables", () => {
  for (const source of ["no publications", table(""), table(row("Under Review", title) + "\\textsc{Bad entry} & unreadable")]) {
    assert.throws(() => syncPublications(source, bib));
  }
});

test("rejects duplicate source titles and ambiguous bibliography matches", () => {
  const source = table(row("Under Review", title));
  assert.throws(() => syncPublications(table(row("Under Review", title).repeat(2)), bib), /Duplicate titles/);
  assert.throws(() => syncPublications(source, bib + bib.replace("existing2026", "duplicate2026")), /Ambiguous/);
});

test("does not execute unsupported commands or accept unsafe URLs", () => {
  assert.throws(() => syncPublications(table(row("Under Review", "\\input{secret}")), bib), /Unsupported LaTeX/);
  assert.throws(() => syncPublications(table(row("Under Review", "\\href{javascript:alert(1)}{A title}")), bib), /HTTPS/);
});

test("CLI leaves the bibliography unchanged if any CV row cannot be parsed", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cv-publications-"));
  const cvPath = path.join(directory, "cv.tex");
  const bibPath = path.join(directory, "papers.bib");
  try {
    fs.writeFileSync(cvPath, table(row("Under Review", title) + "\\textsc{Bad entry} & unreadable"));
    fs.writeFileSync(bibPath, bib);
    const result = spawnSync(process.execPath, [path.resolve(__dirname, "../bin/sync_cv_publications.cjs"), cvPath, bibPath], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Could not read publication/);
    assert.equal(fs.readFileSync(bibPath, "utf8"), bib);
    assert.equal(fs.existsSync(bibPath + ".tmp"), false);
  } finally {
    fs.unlinkSync(cvPath);
    fs.unlinkSync(bibPath);
    fs.rmdirSync(directory);
  }
});

test("selection-only CLI updates visibility without any CV source file", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cv-selection-"));
  const bibPath = path.join(directory, "papers.bib");
  const selectionPath = path.join(directory, "selection.json");
  try {
    fs.writeFileSync(bibPath, bib);
    fs.writeFileSync(selectionPath, JSON.stringify([{ ...selection[0], visibility: "included" }]));
    const result = spawnSync(
      process.execPath,
      [path.resolve(__dirname, "../bin/sync_cv_publications.cjs"), "--selection-only", bibPath, selectionPath],
      { encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr);
    const output = fs.readFileSync(bibPath, "utf8");
    assert.match(output, /selected\s*= \{false\}/);
    assert.match(output, /website_visible\s*= \{true\}/);
    assert.match(output, /doi\s*= \{10\.1234\/retained\}/);
  } finally {
    fs.unlinkSync(bibPath);
    fs.unlinkSync(selectionPath);
    fs.rmdirSync(directory);
  }
});
