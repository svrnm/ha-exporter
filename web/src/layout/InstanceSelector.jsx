import { MenuItem, Select, Typography } from '@mui/material';
import { useInstance } from './InstanceContext.jsx';

/** `location_name` from Home Assistant (Settings → System), else instance id. */
export function instanceDisplayName(inst) {
  if (!inst) return '';
  const n = inst.location_name;
  if (typeof n === 'string' && n.trim()) return n.trim();
  return inst.instance_id;
}

export function InstanceSelector() {
  const { instances, selected, setSelected, selectedInstance } = useInstance();
  if (instances.length === 0) return null;
  if (instances.length === 1) {
    const label = instanceDisplayName(instances[0] ?? selectedInstance);
    if (!label) return null;
    return (
      <Typography
        variant="body2"
        color="text.secondary"
        noWrap
        component="span"
        sx={{ maxWidth: 220, flexShrink: 0 }}
        title={instances[0]?.instance_id}
      >
        {label}
      </Typography>
    );
  }
  return (
    <Select
      value={selected || ''}
      onChange={(e) => setSelected(e.target.value)}
      size="small"
      variant="outlined"
      sx={{
        minWidth: 160,
        maxWidth: 280,
        '& .MuiSelect-select': { py: 0.75 },
      }}
      title={selected}
    >
      {instances.map((inst) => (
        <MenuItem key={inst.instance_id} value={inst.instance_id} title={inst.instance_id}>
          {instanceDisplayName(inst)}
        </MenuItem>
      ))}
    </Select>
  );
}
