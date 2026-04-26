import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import SyncOutlinedIcon from '@mui/icons-material/SyncOutlined';
import {
  Box,
  ButtonBase,
  Divider,
  Popover,
  Stack,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';

import { usePrefs } from '../api/hooks.js';
import { formatDateTimeShort } from '../format.js';
import { useInstance } from './InstanceContext.jsx';

const HaLastSyncedAnchorContext = createContext(null);

function useHaLastSyncedAnchor() {
  const ctx = useContext(HaLastSyncedAnchorContext);
  if (!ctx) {
    throw new Error('HaLastSynced components require HaLastSyncedProvider');
  }
  return ctx;
}

/** Wraps AppShell (inside InstanceProvider) so the popover can anchor outside `<Tabs>`. */
export function HaLastSyncedProvider({ children }) {
  const [anchorEl, setAnchorEl] = useState(null);
  const close = useCallback(() => setAnchorEl(null), []);
  const value = useMemo(
    () => ({ anchorEl, setAnchorEl, close }),
    [anchorEl, close],
  );
  return (
    <HaLastSyncedAnchorContext.Provider value={value}>
      {children}
    </HaLastSyncedAnchorContext.Provider>
  );
}

function mono(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toISOString();
}

function useHaLastSyncedModel() {
  const { anchorEl } = useHaLastSyncedAnchor();
  const { t, i18n } = useTranslation();
  const { selected, selectedInstance, isLoading: instancesLoading } = useInstance();
  const prefs = usePrefs(selected);

  const lastIngestIso = selectedInstance?.last_seen ?? null;
  const prefsUpdatedIso = prefs.data?.updatedAt ?? null;
  const displayIso = lastIngestIso ?? prefsUpdatedIso;
  const loading = instancesLoading || (!!selected && prefs.isLoading);

  const timeLabel =
    loading && !displayIso
      ? '…'
      : displayIso
        ? formatDateTimeShort(displayIso, i18n.language)
        : '—';

  const debugPanel = !selected ? null : (
    <Stack spacing={1.25} sx={{ p: 2, maxWidth: 380, minWidth: 260 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
        {t('summary.syncDebugTitle')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.45 }}>
        {t('summary.syncDebugIntro')}
      </Typography>
      <Divider />
      <DebugRow label={t('summary.syncDebugLastIngest')} value={mono(lastIngestIso)} />
      <DebugRow label={t('summary.syncDebugPrefsStored')} value={mono(prefsUpdatedIso)} />
      <DebugRow
        label={t('summary.syncDebugHaVersion')}
        value={selectedInstance?.ha_version ?? '—'}
      />
      <DebugRow
        label={t('summary.syncDebugHomeName')}
        value={
          typeof selectedInstance?.location_name === 'string' &&
          selectedInstance.location_name.trim() !== ''
            ? selectedInstance.location_name.trim()
            : '—'
        }
        mono={false}
      />
      <DebugRow label={t('summary.syncDebugInstance')} value={selected} mono={false} />
      {loading && (
        <Typography variant="caption" color="text.secondary">
          {t('summary.lastSyncedLoading')}
        </Typography>
      )}
      {!loading && !displayIso && (
        <Typography variant="caption" color="warning.main">
          {t('summary.lastSyncedNever')}
        </Typography>
      )}
    </Stack>
  );

  return {
    selected,
    timeLabel,
    loading,
    displayIso,
    debugPanel,
    open: Boolean(anchorEl),
  };
}

/** Fixed right column on desktop: same visual tokens as `<Tab>` (strip height, icon + label). */
export function HaLastSyncedDesktopTrigger() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { setAnchorEl } = useHaLastSyncedAnchor();
  const { selected, timeLabel, loading, open } = useHaLastSyncedModel();

  if (!selected) return null;

  const sx = tabLikeTriggerSx(theme, { compact: false });

  return (
    <ButtonBase
      focusRipple
      onClick={(e) => setAnchorEl(e.currentTarget)}
      aria-haspopup="true"
      aria-expanded={open}
      aria-label={t('summary.syncToggleAria')}
      sx={sx}
    >
      <SyncOutlinedIcon
        fontSize="small"
        sx={{ mr: 1, opacity: loading && timeLabel === '…' ? 0.5 : 1 }}
      />
      <Typography component="span" variant="button" noWrap sx={{ maxWidth: 220 }}>
        {timeLabel}
      </Typography>
    </ButtonBase>
  );
}

/** Mobile top toolbar: compact tab-like trigger for the main `Toolbar`. */
export function HaLastSyncedMobileTrigger() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { setAnchorEl } = useHaLastSyncedAnchor();
  const { selected, timeLabel, loading, open } = useHaLastSyncedModel();

  if (!selected) return null;

  const sx = tabLikeTriggerSx(theme, { compact: true });

  return (
    <ButtonBase
      focusRipple
      onClick={(e) => setAnchorEl(e.currentTarget)}
      aria-haspopup="true"
      aria-expanded={open}
      aria-label={t('summary.syncToggleAria')}
      sx={sx}
    >
      <SyncOutlinedIcon
        fontSize="small"
        sx={{ mr: 1, opacity: loading && timeLabel === '…' ? 0.5 : 1 }}
      />
      <Typography component="span" variant="button" noWrap sx={{ maxWidth: 160 }}>
        {timeLabel}
      </Typography>
    </ButtonBase>
  );
}

/** Single popover instance (sibling of `<Tabs>`, not a child). */
export function HaLastSyncedPopover({ placement = 'toolbar' }) {
  const { anchorEl, close } = useHaLastSyncedAnchor();
  const { selected, debugPanel, open } = useHaLastSyncedModel();
  const inToolbar = placement === 'toolbar';

  if (!selected || !debugPanel) return null;

  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={close}
      anchorOrigin={{ vertical: 'bottom', horizontal: inToolbar ? 'right' : 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: inToolbar ? 'right' : 'left' }}
      slotProps={{
        paper: {
          sx: {
            borderRadius: 2,
            border: 1,
            borderColor: 'divider',
            mt: 0.5,
          },
        },
      }}
    >
      {debugPanel}
    </Popover>
  );
}

function DebugRow({ label, value, mono = true }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          wordBreak: 'break-word',
          ...(mono
            ? {
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                fontSize: '0.8rem',
              }
            : {}),
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}

/**
 * Mirrors nav `<Tab>` look (textColor primary / unselected).
 * Desktop height must match `theme.components.MuiTab.styleOverrides.root.minHeight` (48px),
 * not MUI’s default icon-tab 72px — otherwise the right column grows and leaves a gap under labels.
 */
function tabLikeTriggerSx(theme, { compact }) {
  if (compact) {
    return {
      ...theme.typography.button,
      display: 'inline-flex',
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'center',
      position: 'relative',
      flexShrink: 0,
      maxWidth: 200,
      minWidth: 72,
      minHeight: 40,
      px: 1.5,
      py: 0.75,
      overflow: 'hidden',
      borderRadius: 0,
      color: theme.palette.text.secondary,
      fontWeight: 600,
      textTransform: 'none',
      '&:hover': {
        color: theme.palette.text.primary,
        backgroundColor: theme.palette.action.hover,
      },
      '&.Mui-focusVisible': {
        backgroundColor: theme.palette.action.focus,
      },
    };
  }
  return {
    ...theme.typography.button,
    display: 'inline-flex',
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    position: 'relative',
    flexShrink: 0,
    maxWidth: 360,
    minWidth: 90,
    minHeight: 48,
    px: 2,
    py: 0,
    overflow: 'hidden',
    borderRadius: 0,
    color: theme.palette.text.secondary,
    fontWeight: 600,
    textTransform: 'none',
    lineHeight: 1.25,
    '&:hover': {
      color: theme.palette.text.primary,
      backgroundColor: theme.palette.action.hover,
    },
    '&.Mui-focusVisible': {
      backgroundColor: theme.palette.action.focus,
    },
  };
}
