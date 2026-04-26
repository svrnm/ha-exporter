import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Tooltip } from '@mui/material';
import BrightnessAutoIcon from '@mui/icons-material/BrightnessAuto';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import CheckIcon from '@mui/icons-material/Check';

import { useColorSchemePreference } from '../ColorSchemeProvider.jsx';

const OPTIONS = [
  { value: 'system', Icon: BrightnessAutoIcon, labelKey: 'app.theme.system' },
  { value: 'light', Icon: LightModeIcon, labelKey: 'app.theme.light' },
  { value: 'dark', Icon: DarkModeIcon, labelKey: 'app.theme.dark' },
];

function menuIcon(preference) {
  if (preference === 'light') return LightModeIcon;
  if (preference === 'dark') return DarkModeIcon;
  return BrightnessAutoIcon;
}

export function ColorSchemeMenu() {
  const { t } = useTranslation();
  const { preference, setPreference } = useColorSchemePreference();
  const [anchor, setAnchor] = useState(null);
  const HeaderIcon = menuIcon(preference);

  return (
    <>
      <Tooltip title={t('app.theme.label')}>
        <IconButton
          color="inherit"
          onClick={(e) => setAnchor(e.currentTarget)}
          aria-label={t('app.theme.label')}
        >
          <HeaderIcon />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        {OPTIONS.map(({ value, Icon, labelKey }) => {
          const selected = value === preference;
          return (
            <MenuItem
              key={value}
              selected={selected}
              onClick={() => {
                setPreference(value);
                setAnchor(null);
              }}
            >
              <ListItemIcon>
                <Icon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary={t(labelKey)} />
              <Box component="span" sx={{ width: 24, display: 'inline-flex', justifyContent: 'center' }}>
                {selected ? <CheckIcon fontSize="small" color="primary" /> : null}
              </Box>
            </MenuItem>
          );
        })}
      </Menu>
    </>
  );
}
