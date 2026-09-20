import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

function source(path: string) {
  return readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
}

describe("project shell preservation contracts", () => {
  it("exposes project options as a labelled menu from both card and detail triggers", async () => {
    const [page, card] = await Promise.all([
      source("features/projects/ProjectsPage.vue"), source("features/projects/components/ProjectCard.vue"),
    ]);
    for (const text of [page, card]) {
      assert.match(text, /aria-haspopup="menu"/);
      assert.match(text, /:aria-expanded=/);
      assert.match(text, /:aria-controls=/);
    }
    assert.match(page, /:id="projectMenuId"\s+role="menu"\s+:aria-label=/);
    assert.equal((page.match(/role="menuitem"/g) || []).length, 3);
    assert.match(page, /event\.key === "Escape" && !event\.isComposing/);
    assert.match(page, /projectMenuOpener\?\.focus\(\)/);
    assert.match(page, /event\.key === "ArrowDown" \|\| event\.key === "ArrowUp"/);
    assert.match(page, /window\.innerHeight - menuRect\.height - 8/);
  });

  it("bounds long project-import feedback independently of the pinned composer", async () => {
    const css = await source("styles/components/_workspace-page.scss");
    const feedback = css.match(/\.projects-page--detail > \.project-portability-feedback \{([^}]+)\}/)?.[1] || "";
    assert.match(feedback, /max-height: min\(180px, 25dvh\)/);
    assert.match(feedback, /overflow-y: auto/);
    assert.match(feedback, /flex-shrink: 0/);
    const main = css.match(/\.project-detail__main \{([^}]+)\}/)?.[1] || "";
    assert.match(main, /grid-template-rows: minmax\(0, 1fr\) auto/);
    assert.match(main, /min-height: 0/);
  });

  it("preserves explicit project operations without opening creation for an empty account", async () => {
    const page = await source("features/projects/ProjectsPage.vue");
    assert.doesNotMatch(page, /openCreateModalForEmptyWorkspace|hasOpenedEmptyCreateModal/);
    assert.match(page, /@click="openCreateProjectModal"/);
    assert.match(page, /ProjectAddChatsModal/);
    assert.match(page, /ProjectDeleteModal/);
    assert.match(page, /exportProjectZip\(project\.id/);
    assert.match(page, /refreshAndOpenImportedProject\(result/);
    assert.match(page, /<slot name="composer" :project-id="activeProject\.id" \/>/);
    assert.doesNotMatch(page, /<ChatComposer/);
  });
});
