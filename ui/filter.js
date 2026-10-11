export function filterItems(items, query) {
  const phrase = query.trim().toLocaleLowerCase('en');
  return items.filter((item) => item.name.toLocaleLowerCase('en').includes(phrase));
}
