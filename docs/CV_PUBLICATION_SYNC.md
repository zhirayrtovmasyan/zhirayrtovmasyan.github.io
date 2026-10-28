# Sync publications from the CV repository

The private `zhirayrtovmasyan/CV` repository supplies `cv.tex` and `cv.pdf`.
Its existing workflow can update the website's PDF and bibliography together,
using the same `WEBSITE_CV_TOKEN` secret and repository permissions as the PDF sync.
Only the publication table is imported; the LaTeX source stays in the private repository.

## Choose which papers appear

Edit [`_data/publication_selection.json`](../_data/publication_selection.json) in the
website repository. The five current papers are initially `selected`, preserving
both current listings.

| `visibility`              | Publications page | Homepage |
| ------------------------- | ----------------- | -------- |
| `excluded`                | Hidden            | Hidden   |
| `included`                | Shown             | Hidden   |
| `selected`                | Shown             | Shown    |
| Not in the selection file | Hidden            | Hidden   |

New CV papers are **not imported automatically**. To opt one in, add a record:

```json
{
  "key": "tovmasyan2027example",
  "title": "Exact title from the CV",
  "arxiv": "2701.12345",
  "visibility": "included"
}
```

Use a unique, stable `key` (letters, digits, underscores, or hyphens; starting
with a letter). Keep existing keys unchanged. `title` identifies the CV paper;
the optional `arxiv` ID lets it continue matching if its title changes. Omit
`arxiv` for papers without one. The selection file contains identifiers and
visibility choices; the CV still supplies publication metadata.

After committing a newly added record to the website, run the CV repository's
sync workflow manually or push a CV update to import that paper. Changing the
visibility of a paper already in the bibliography needs only a website commit:
the deployment workflow applies selection before building, without needing the
private CV source. Removing a record has the same visibility effect as `excluded`.

Hidden existing papers keep their bibliography details so they can be shown again.
The importer generates `selected` and `website_visible` fields for the native
bibliography queries; change the selection file instead of editing those flags.
The downloadable CV always retains its complete publication list.

## Activate

1. Review and commit the website changes, including `bin/sync_cv_publications.cjs`,
   before activating the CV workflow. The importer must exist on the website's
   default deployment branch for the workflow to run successfully.
2. In the CV repository, replace `.github/workflows/sync-cv.yml` with
   [the updated workflow](examples/sync-cv.yml). It watches both `cv.tex` and `cv.pdf`.
3. Review and commit that workflow in the CV repository, then run it manually from
   Actions or push a CV update. It stages only `assets/pdf/cv.pdf` and
   `_bibliography/papers.bib`, and skips commits when neither file changed.

The website's existing deployment workflow responds to the resulting commit.
Both the homepage and Publications page use the same native bibliography renderer.
No second token, public CV source, scheduled polling, or theme override is needed.

## Local preview

```bash
# Update opted-in publication details and apply visibility:
node bin/sync_cv_publications.cjs /path/to/CV/cv.tex
# Or change visibility without access to the private CV:
node bin/sync_cv_publications.cjs --selection-only
node --test test/cv_publications.test.cjs
git diff -- _bibliography/papers.bib
```

The importer reads the `Publications and Preprints` tabular section in the current
CV format: `\textsc{venue/status}` followed by authors, a quoted title (optionally
wrapped in `\href`), and venue details. It understands the CV's `\textbf`,
`\textsc`, `\emph`, and `\mbox` wrappers. Unreadable or duplicate rows fail the sync
before the bibliography or PDF is staged. If that table's structure changes,
update the importer and its tests together.

Opted-in papers match by normalized title, arXiv ID, or an existing paper's
selection key. Existing BibTeX keys, full author names, DOI and other extra
metadata are retained. Titles, author order, venue/status, explicit publication
years, and available title links come from the CV. A new undated manuscript uses
the calendar year of its first sync; subsequent syncs keep it.

Entries omitted from the CV and links not supplied there are retained, so shortening
the CV does not delete website publications or curated links. A renamed unpublished
paper without an arXiv ID needs its title updated in the selection file while
keeping the same key. Non-publication CV sections are never copied.
