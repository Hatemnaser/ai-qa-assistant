import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  createReferenceCountedLock,
  getFocusWrapTarget,
  shouldRequestDialogClose,
} from "../src/ui/useDialogAccessibility";

describe("dialog accessibility lifecycle", () => {
  it("keeps shared page locking active until every nested dialog releases it", () => {
    const events: string[] = [];
    const acquire = createReferenceCountedLock(
      () => events.push("locked"),
      () => events.push("unlocked")
    );
    const releaseFirst = acquire();
    const releaseSecond = acquire();

    assert.deepEqual(events, ["locked"]);
    releaseFirst();
    releaseFirst();
    assert.deepEqual(events, ["locked"]);
    releaseSecond();
    assert.deepEqual(events, ["locked", "unlocked"]);
  });

  it("wraps focus only at the edges of a dialog", () => {
    const first = { id: "first" };
    const middle = { id: "middle" };
    const last = { id: "last" };
    const focusableElements = [first, middle, last];

    assert.equal(getFocusWrapTarget(focusableElements, last, false), first);
    assert.equal(getFocusWrapTarget(focusableElements, first, true), last);
    assert.equal(getFocusWrapTarget(focusableElements, middle, false), null);
    assert.equal(getFocusWrapTarget(focusableElements, middle, true), null);
    assert.equal(getFocusWrapTarget(focusableElements, {}, false), first);
    assert.equal(getFocusWrapTarget(focusableElements, {}, true), last);
    assert.equal(getFocusWrapTarget([], null, false), null);
  });

  it("requests Escape close only when the dialog allows it", () => {
    assert.equal(shouldRequestDialogClose("Escape", true), true);
    assert.equal(shouldRequestDialogClose("Escape", false), false);
    assert.equal(shouldRequestDialogClose("Escape", true, true), false);
    assert.equal(shouldRequestDialogClose("Enter", true), false);
  });

  it("wires every aria-modal Vue component to the shared lifecycle", async () => {
    const modalSources = await findAriaModalSources();

    assert.ok(modalSources.length > 0, "expected at least one aria-modal component");

    for (const { relativePath, source } of modalSources) {
      assert.match(
        source,
        /import \{ useDialogAccessibility \} from "\.\.\/\.\.\/\.\.\/ui\/useDialogAccessibility";/,
        `${relativePath} must import the shared dialog lifecycle`
      );
      assert.match(
        source,
        /const \{ dialogRef, onDialogKeydown \} = useDialogAccessibility\(\{/,
        `${relativePath} must initialize the shared dialog lifecycle`
      );
      assert.match(source, /ref="dialogRef"/, `${relativePath} must bind the dialog element ref`);
      assert.match(
        source,
        /@keydown="onDialogKeydown"/,
        `${relativePath} must contain keyboard focus and Escape handling`
      );

      if (/class="btn-close"[\s\S]{0,240}:disabled=/.test(source)) {
        assert.match(
          source,
          /canClose:/,
          `${relativePath} must preserve its disabled-close state for Escape`
        );
      }
    }
  });
});

type ModalSource = {
  relativePath: string;
  source: string;
};

const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));

async function findAriaModalSources() {
  const sources: ModalSource[] = [];
  await visitSourceDirectory("", sources);
  return sources.filter(({ source }) => source.includes('aria-modal="true"'));
}

async function visitSourceDirectory(relativeDirectory: string, sources: ModalSource[]) {
  const entries = await readdir(path.join(sourceRoot, relativeDirectory), { withFileTypes: true });

  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);

    if (entry.isDirectory()) {
      await visitSourceDirectory(relativePath, sources);
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith(".vue")) continue;

    sources.push({
      relativePath,
      source: await readFile(path.join(sourceRoot, relativePath), "utf8"),
    });
  }
}
