type MessageCatalog = Record<string, string>;

type UnionToIntersection<Value> = (
  Value extends unknown ? (candidate: Value) => void : never
) extends (candidate: infer Intersection) => void
  ? Intersection
  : never;

export function mergeMessageCatalogs<
  const Catalogs extends readonly MessageCatalog[],
>(...catalogs: Catalogs): UnionToIntersection<Catalogs[number]> {
  const messages: MessageCatalog = {};

  for (const catalog of catalogs) {
    for (const [key, value] of Object.entries(catalog)) {
      if (Object.hasOwn(messages, key)) {
        throw new Error(`Duplicate i18n message key: ${key}`);
      }

      messages[key] = value;
    }
  }

  return messages as UnionToIntersection<Catalogs[number]>;
}
