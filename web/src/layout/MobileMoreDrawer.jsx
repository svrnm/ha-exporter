import BrightnessAutoIcon from '@mui/icons-material/BrightnessAuto';
import CheckIcon from '@mui/icons-material/Check';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import IosShareIcon from '@mui/icons-material/IosShare';
import LightModeIcon from '@mui/icons-material/LightMode';
import LogoutIcon from '@mui/icons-material/Logout';
import SyncOutlinedIcon from '@mui/icons-material/SyncOutlined';
import TranslateIcon from '@mui/icons-material/Translate';
import {
  Box,
  Divider,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

import { useColorSchemePreference } from '../ColorSchemeProvider.jsx';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useHaLastSyncedAnchor, useHaLastSyncedModel } from './HaLastSyncedLine.jsx';

const THEME_OPTIONS = [
  { value: 'system', Icon: BrightnessAutoIcon, labelKey: 'app.theme.system' },
  { value: 'light', Icon: LightModeIcon, labelKey: 'app.theme.light' },
  { value: 'dark', Icon: DarkModeIcon, labelKey: 'app.theme.dark' },
];

const LANGS = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
];

/**
 * Bottom-sheet menu: theme, language, invite link, last-sync debug, log out.
 * `popoverAnchorRef` should point at the bottom-bar control that opens this drawer
 * so the HA sync popover can anchor above the nav after the sheet closes.
 */
export function MobileMoreDrawer({
  open,
  onClose,
  popoverAnchorRef,
  onShareInvite,
}) {
  const { t, i18n } = useTranslation();
  const { preference, setPreference } = useColorSchemePreference();
  const { clearToken, token } = useAuth();
  const { setAnchorEl } = useHaLastSyncedAnchor();
  const { selected, timeLabel, loading } = useHaLastSyncedModel();
  const currentLang = (i18n.resolvedLanguage || i18n.language || 'en').slice(0, 2);

  function openSyncPopover() {
    onClose();
    window.setTimeout(() => {
      const el = popoverAnchorRef?.current;
      if (el) setAnchorEl(el);
    }, 300);
  }

  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          sx: {
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            maxHeight: '85dvh',
            pb: 'calc(8px + env(safe-area-inset-bottom, 0px))',
          },
        },
      }}
    >
      <Box sx={{ px: 1, pt: 1, maxWidth: 440, mx: 'auto', width: '100%' }}>
        <Box sx={{ width: 40, height: 4, borderRadius: 2, bgcolor: 'action.disabled', mx: 'auto', mb: 1 }} />
        <List disablePadding dense>
        <ListSubheader component="div" disableSticky sx={{ bgcolor: 'background.paper', lineHeight: 2 }}>
          <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700 }}>
            {t('app.theme.label')}
          </Typography>
        </ListSubheader>
        {THEME_OPTIONS.map(({ value, Icon, labelKey }) => {
          const sel = value === preference;
          return (
            <ListItemButton
              key={value}
              selected={sel}
              onClick={() => {
                setPreference(value);
                onClose();
              }}
            >
              <ListItemIcon sx={{ minWidth: 40 }}>
                <Icon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary={t(labelKey)} />
              {sel ? <CheckIcon fontSize="small" color="primary" sx={{ ml: 1 }} /> : null}
            </ListItemButton>
          );
        })}

        <Divider sx={{ my: 1 }} />

        <ListSubheader component="div" disableSticky sx={{ bgcolor: 'background.paper', lineHeight: 2 }}>
          <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700 }}>
            {t('app.language')}
          </Typography>
        </ListSubheader>
        {LANGS.map((lng) => {
          const sel = lng.code === currentLang;
          return (
            <ListItemButton
              key={lng.code}
              selected={sel}
              onClick={() => {
                void i18n.changeLanguage(lng.code);
                onClose();
              }}
            >
              <ListItemIcon sx={{ minWidth: 40 }}>
                <TranslateIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary={lng.label} />
              {sel ? <CheckIcon fontSize="small" color="primary" sx={{ ml: 1 }} /> : null}
            </ListItemButton>
          );
        })}

        <Divider sx={{ my: 1 }} />

        <ListItemButton
          disabled={!token}
          onClick={async () => {
            if (!token) return;
            await onShareInvite();
            onClose();
          }}
        >
          <ListItemIcon sx={{ minWidth: 40 }}>
            <IosShareIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary={t('app.shareLink')} />
        </ListItemButton>

        {selected ? (
          <ListItemButton onClick={openSyncPopover}>
            <ListItemIcon sx={{ minWidth: 40 }}>
              <SyncOutlinedIcon
                fontSize="small"
                sx={{ opacity: loading && timeLabel === '…' ? 0.5 : 1 }}
              />
            </ListItemIcon>
            <ListItemText primary={t('summary.syncDebugTitle')} secondary={timeLabel} />
          </ListItemButton>
        ) : null}

        <Divider sx={{ my: 1 }} />

        <ListItemButton
          onClick={() => {
            onClose();
            clearToken();
          }}
        >
          <ListItemIcon sx={{ minWidth: 40 }}>
            <LogoutIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary={t('app.logout')} />
        </ListItemButton>
        </List>
      </Box>
    </Drawer>
  );
}
