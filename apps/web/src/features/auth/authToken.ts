export function readAuthTokenFromLocation(
  location: Pick<Location, "hash" | "search"> = window.location
) {
  const hashQuery = location.hash.includes("?")
    ? location.hash.slice(location.hash.indexOf("?"))
    : "";
  const search = hashQuery || location.search;

  return new URLSearchParams(search.replace(/^\?/, "")).get("token") || "";
}

export function consumeAuthTokenFromLocation(
  location: Pick<Location, "hash" | "pathname" | "search"> = window.location,
  replaceLocation: (relativeUrl: string) => void = (relativeUrl) => {
    window.history.replaceState(window.history.state, "", relativeUrl);
  }
) {
  const token = readAuthTokenFromLocation(location);

  if (token) {
    replaceLocation(buildLocationWithoutAuthToken(location));
  }

  return token;
}

export function buildLocationWithoutAuthToken(
  location: Pick<Location, "hash" | "pathname" | "search">
) {
  const hashQueryIndex = location.hash.indexOf("?");

  if (hashQueryIndex >= 0) {
    const hashPath = location.hash.slice(0, hashQueryIndex);
    const hashParams = new URLSearchParams(location.hash.slice(hashQueryIndex + 1));

    hashParams.delete("token");
    const remainingHashQuery = hashParams.toString();

    return `${location.pathname}${location.search}${hashPath}${remainingHashQuery ? `?${remainingHashQuery}` : ""}`;
  }

  const searchParams = new URLSearchParams(location.search);
  searchParams.delete("token");
  const remainingSearch = searchParams.toString();

  return `${location.pathname}${remainingSearch ? `?${remainingSearch}` : ""}${location.hash}`;
}
