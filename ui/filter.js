export function filterItems(items, query) {
  const phrase = query.trim().normalize('NFC').toLocaleLowerCase('en');
  return items.filter((item) => item.name.toLocaleLowerCase('en').includes(phrase));
}
