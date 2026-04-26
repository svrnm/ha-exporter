import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppBar,
  Box,
  Container,
  Divider,
  IconButton,
  Paper,
  Snackbar,
  Stack,
  Tab,
  Tabs,
  Toolbar,
  Tooltip,
  Typography,
  BottomNavigation,
  BottomNavigationAction,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import HomeIcon from '@mui/icons-material/Home';
import DashboardIcon from '@mui/icons-material/Dashboard';
import FlashOnIcon from '@mui/icons-material/FlashOn';
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartment';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import LogoutIcon from '@mui/icons-material/Logout';
import IosShareIcon from '@mui/icons-material/IosShare';
import MenuIcon from '@mui/icons-material/Menu';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation, useNavigate } from 'react-router';

import { InstanceProvider } from './InstanceContext.jsx';
import {
  HaLastSyncedDesktopTrigger,
  HaLastSyncedPopover,
  HaLastSyncedProvider,
} from './HaLastSyncedLine.jsx';
import { haConfiguredLocationName } from './haConfiguredLocationName.js';
import { ColorSchemeMenu } from './ColorSchemeMenu.jsx';
import { LanguageMenu } from './LanguageMenu.jsx';
import { MobileMoreDrawer } from './MobileMoreDrawer.jsx';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useInstance } from './InstanceContext.jsx';

const ROUTES = [
  { path: '/', key: 'summary', icon: DashboardIcon },
  { path: '/electricity', key: 'electricity', icon: FlashOnIcon },
  { path: '/gas', key: 'gas', icon: LocalFireDepartmentIcon },
  { path: '/now', key: 'now', icon: AccessTimeIcon },
];

function AppToolbarTitle() {
  const { t } = useTranslation();
  const { selectedInstance } = useInstance();
  const label = haConfiguredLocationName(selectedInstance) || t('app.title');

  useEffect(() => {
    document.title = label;
  }, [label]);

  return (
    <Typography
      variant="h6"
      sx={{ fontWeight: 700, letterSpacing: '-0.01em', mr: 'auto' }}
      noWrap
    >
      {label}
    </Typography>
  );
}

function buildTokenInviteUrl(token) {
  const origin = window.location.origin.replace(/\/$/, '');
  return `${origin}/token/${encodeURIComponent(token)}`;
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(ta);
  if (!ok) throw new Error('execCommand copy failed');
}

export function AppShell() {
  const { t } = useTranslation();
  const theme = useTheme();
  // Use `md` so tablets and ~600–900px browser widths get the touch layout (bottom nav,
  // burger menu, short tab labels). `sm` alone only matched <600px, so many “mobile”
  // views still showed the desktop tab strip.
  const isMobile = useMediaQuery(theme.breakpoints.down('md'), { noSsr: true });
  const { token, clearToken } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [snack, setSnack] = useState({ open: false, severity: 'success', message: '' });
  const [moreOpen, setMoreOpen] = useState(false);
  const moreAnchorRef = useRef(null);

  async function handleShareInviteLink() {
    if (!token) return;
    const url = buildTokenInviteUrl(token);
    try {
      await copyTextToClipboard(url);
      setSnack({
        open: true,
        severity: 'success',
        message: t('app.shareLinkCopied'),
      });
    } catch {
      window.prompt(t('app.shareLinkCopyFailed'), url);
    }
  }

  const activeIndex = Math.max(
    0,
    ROUTES.findIndex((r) =>
      r.path === '/' ? location.pathname === '/' : location.pathname.startsWith(r.path),
    ),
  );

  return (
    <InstanceProvider>
      <HaLastSyncedProvider>
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          minHeight: '100dvh',
          bgcolor: 'background.default',
        }}
      >
        {!isMobile ? (
          <AppBar position="sticky" elevation={0} color="default">
            <Toolbar sx={{ gap: 1.5, flexWrap: 'wrap', rowGap: 1 }}>
              <Box
                sx={{
                  width: 32,
                  height: 32,
                  borderRadius: 1.5,
                  bgcolor: 'primary.main',
                  color: 'common.black',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <HomeIcon fontSize="small" />
              </Box>
              <AppToolbarTitle />
              <ColorSchemeMenu />
              <LanguageMenu />
              <Tooltip title={t('app.shareLink')}>
                <span>
                  <IconButton
                    color="inherit"
                    onClick={handleShareInviteLink}
                    disabled={!token}
                    aria-label={t('app.shareLinkAria')}
                  >
                    <IosShareIcon />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title={t('app.logout')}>
                <IconButton color="inherit" onClick={clearToken} aria-label={t('app.logout')}>
                  <LogoutIcon />
                </IconButton>
              </Tooltip>
            </Toolbar>
            <Stack
              direction="row"
              alignItems="center"
              sx={{
                width: '100%',
                borderTop: (th) =>
                  `1px solid ${
                    th.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'
                  }`,
              }}
            >
              <Tabs
                value={activeIndex}
                onChange={(_, v) => navigate(ROUTES[v].path)}
                variant="scrollable"
                allowScrollButtonsMobile
                sx={{
                  flex: 1,
                  minWidth: 0,
                  px: { xs: 1, sm: 2 },
                }}
              >
                {ROUTES.map((r) => {
                  const Icon = r.icon;
                  return (
                    <Tab
                      key={r.path}
                      iconPosition="start"
                      icon={<Icon fontSize="small" />}
                      label={t(`nav.${r.key}`)}
                    />
                  );
                })}
              </Tabs>
              <Box
                sx={{
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  pl: 1,
                  pr: 2,
                  borderLeft: (th) =>
                    `1px solid ${
                      th.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'
                    }`,
                }}
              >
                <HaLastSyncedDesktopTrigger />
              </Box>
            </Stack>
          </AppBar>
        ) : null}

        <HaLastSyncedPopover placement={isMobile ? 'bottomNav' : 'toolbar'} />

        <Container
          maxWidth="lg"
          sx={{
            flex: 1,
            minWidth: 0,
            pt: (theme) =>
              isMobile
                ? `max(${theme.spacing(2)}, env(safe-area-inset-top, 0px))`
                : theme.spacing(3),
            // Bottom nav is position:fixed (56px) + iOS home indicator; reserve both in the scrollable area.
            pb: (theme) =>
              isMobile
                ? `calc(56px + env(safe-area-inset-bottom, 0px) + ${theme.spacing(2)})`
                : theme.spacing(4),
          }}
        >
          <Outlet />
        </Container>

        <Snackbar
          open={snack.open}
          autoHideDuration={4000}
          onClose={() => setSnack((s) => ({ ...s, open: false }))}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          <Alert
            onClose={() => setSnack((s) => ({ ...s, open: false }))}
            severity={snack.severity}
            variant="filled"
            sx={{ width: '100%' }}
          >
            {snack.message}
          </Alert>
        </Snackbar>

        {isMobile && (
          <>
            <MobileMoreDrawer
              open={moreOpen}
              onClose={() => setMoreOpen(false)}
              popoverAnchorRef={moreAnchorRef}
              onShareInvite={handleShareInviteLink}
            />
            <Paper
              elevation={3}
              sx={{
                position: 'fixed',
                left: 0,
                right: 0,
                bottom: 0,
                borderRadius: 0,
                zIndex: (theme) => theme.zIndex.appBar,
                pb: 'env(safe-area-inset-bottom)',
              }}
            >
              <Stack direction="row" alignItems="stretch" sx={{ minHeight: 56 }}>
                <BottomNavigation
                  sx={{
                    flex: 1,
                    minWidth: 0,
                    '& .MuiBottomNavigationAction-root': {
                      minWidth: 0,
                      maxWidth: 'none',
                      flex: 1,
                      px: 0.25,
                    },
                    '& .MuiBottomNavigationAction-label': {
                      fontSize: '0.6875rem',
                      lineHeight: 1.15,
                      opacity: '1 !important',
                      whiteSpace: 'normal',
                      wordBreak: 'break-word',
                      hyphens: 'auto',
                    },
                  }}
                  showLabels
                  value={activeIndex}
                  onChange={(_, v) => navigate(ROUTES[v].path)}
                >
                  {ROUTES.map((r) => {
                    const Icon = r.icon;
                    const shortLabel = t(`nav.bottom.${r.key}`);
                    return (
                      <BottomNavigationAction
                        key={r.path}
                        showLabel
                        label={shortLabel}
                        icon={<Icon />}
                        aria-label={t(`nav.${r.key}`)}
                      />
                    );
                  })}
                </BottomNavigation>
                <Divider orientation="vertical" flexItem sx={{ my: 0.5 }} />
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 56,
                    flexShrink: 0,
                  }}
                >
                  <IconButton
                    ref={moreAnchorRef}
                    color="inherit"
                    onClick={() => setMoreOpen(true)}
                    aria-label={t('app.moreMenuAria')}
                    aria-haspopup="true"
                    aria-expanded={moreOpen}
                    size="medium"
                  >
                    <MenuIcon />
                  </IconButton>
                </Box>
              </Stack>
            </Paper>
          </>
        )}
      </Box>
      </HaLastSyncedProvider>
    </InstanceProvider>
  );
}
