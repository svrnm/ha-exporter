/** Home Assistant name from Settings → System (`location_name`). Empty if not reported yet. */
export function haConfiguredLocationName(inst) {
  if (!inst) return '';
  const n = inst.location_name;
  if (typeof n === 'string' && n.trim()) return n.trim();
  return '';
}
