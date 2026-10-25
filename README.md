# Genealogy Atlas

An interactive atlas of dynasties, genealogical lines, and heraldry across Europe, Asia, Antiquity, and Greek mythology.

**Open the atlas:** <https://llazzaroni.github.io/genealogy/>

## Explore

1. Choose a map: **Europe**, **Asia**, **Antiquity**, or **Greek Mythology**.
2. Double-click a house to open its genealogy.
3. Hover a person to inspect available information and use the node controls to explore connected relatives and regionality.
4. Use the top-right back and forward buttons to navigate between the atlas and opened houses.

The genealogy view emphasizes dynastic continuity: paternal lines are placed vertically, spouses appear beside their partners, and side branches are arranged to remain legible where the underlying pedigree permits.

## Data and Scope

The atlas is an evolving research and visualization project. It combines genealogical data assembled from public sources, including Geneall, with manually curated dynasty, regional, and heraldic information.

Historical genealogy is incomplete and sometimes contradictory.

## Technical Notes

This repository is the static GitHub Pages publication. It contains only the browser frontend and generated public data required to run the atlas; data processing, collection, and analytical tooling are maintained separately.

To preview the published site locally:

```bash
cd genealogy-site
python -m http.server 8000
```

Then open <http://localhost:8000>.

## Feedback

Corrections, source suggestions, and reports of broken links or mistaken relationships are welcome through the repository issues.
