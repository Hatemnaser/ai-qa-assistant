export function resolveImportedProjectName(
  sourceProjectName: string,
  existingProjectNames: readonly string[]
) {
  const names = new Set(
    existingProjectNames.map((name) => name.toLocaleLowerCase("en-US"))
  );

  for (
    let sequence = 1;
    sequence <= existingProjectNames.length + 2;
    sequence += 1
  ) {
    const suffix =
      sequence === 1 ? " (Imported)" : ` (Imported ${sequence})`;
    const availableChars = 120 - suffix.length;
    const sourceName = sourceProjectName.slice(0, availableChars).trimEnd();
    const candidate = `${sourceName}${suffix}`;

    if (!names.has(candidate.toLocaleLowerCase("en-US"))) {
      return candidate;
    }
  }

  throw new Error("Unable to resolve an imported project name.");
}
