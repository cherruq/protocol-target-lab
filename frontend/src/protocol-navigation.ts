const names = new Intl.Collator("en", { sensitivity: "accent", numeric: true });

export function protocolNavigationItems<T extends { id: string; name: string }>(
  protocols: readonly T[],
  search: string,
): T[] {
  const query = search.trim().toLocaleLowerCase();
  return protocols
    .filter((protocol) =>
      !query || [protocol.name, protocol.id].some((value) => value.toLocaleLowerCase().includes(query)),
    )
    .sort((a, b) => names.compare(a.name, b.name) || names.compare(a.id, b.id));
}
