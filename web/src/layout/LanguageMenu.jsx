import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton, Menu, MenuItem, Tooltip } from '@mui/material';
import TranslateIcon from '@mui/icons-material/Translate';

const LANGS = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
];

export function LanguageMenu() {
  const { t, i18n } = useTranslation();
  const [anchor, setAnchor] = useState(null);

  const current = (i18n.resolvedLanguage || i18n.language || 'en').slice(0, 2);

  return (
    <>
      <Tooltip title={t('app.language')}>
        <IconButton color="inherit" onClick={(e) => setAnchor(e.currentTarget)}>
          <TranslateIcon />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        {LANGS.map((lng) => (
          <MenuItem
            key={lng.code}
            selected={lng.code === current}
            onClick={() => {
              void i18n.changeLanguage(lng.code);
              setAnchor(null);
            }}
          >
            {lng.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
