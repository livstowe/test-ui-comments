export function toggleItem(item) {
  return { ...item, enabled: item.enabled };
}
