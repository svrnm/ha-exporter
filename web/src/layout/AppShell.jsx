import {
  AppBar,
  Box,
  Container,
  IconButton,
  Paper,
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
import BoltIcon from '@mui/icons-material/Bolt';
import DashboardIcon from '@mui/icons-material/Dashboard';
import FlashOnIcon from '@mui/icons-material/FlashOn';
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartment';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import LogoutIcon from '@mui/icons-material/Logout';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation, useNavigate } from 'react-router';

import { InstanceProvider } from './InstanceContext.jsx';
import {
  HaLastSyncedDesktopTrigger,
  HaLastSyncedMobileTrigger,
  HaLastSyncedPopover,
  HaLastSyncedProvider,
} from './HaLastSyncedLine.jsx';
import { InstanceSelector } from './InstanceSelector.jsx';
import { ColorSchemeMenu } from './ColorSchemeMenu.jsx';
import { LanguageMenu } from './LanguageMenu.jsx';
import { useAuth } from '../auth/AuthProvider.jsx';

const ROUTES = [
  { path: '/', key: 'summary', icon: DashboardIcon },
  { path: '/electricity', key: 'electricity', icon: FlashOnIcon },
  { path: '/gas', key: 'gas', icon: LocalFireDepartmentIcon },
  { path: '/now', key: 'now', icon: AccessTimeIcon },
];

export function AppShell() {
  const { t } = useTranslation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { clearToken } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

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
              <BoltIcon fontSize="small" />
            </Box>
            <Typography
              variant="h6"
              sx={{ fontWeight: 700, letterSpacing: '-0.01em', mr: 'auto' }}
              noWrap
            >
              {t('app.title')}
            </Typography>
            <InstanceSelector />
            {isMobile && <HaLastSyncedMobileTrigger />}
            <ColorSchemeMenu />
            <LanguageMenu />
            <Tooltip title={t('app.logout')}>
              <IconButton color="inherit" onClick={clearToken} aria-label={t('app.logout')}>
                <LogoutIcon />
              </IconButton>
            </Tooltip>
          </Toolbar>
          {!isMobile && (
            <Stack
              direction="row"
              alignItems="center"
              sx={{
                width: '100%',
                borderTop: (t) =>
                  `1px solid ${
                    t.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'
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
                  borderLeft: (t) =>
                    `1px solid ${
                      t.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'
                    }`,
                }}
              >
                <HaLastSyncedDesktopTrigger />
              </Box>
            </Stack>
          )}
          <HaLastSyncedPopover placement="toolbar" />
        </AppBar>

        <Container
          maxWidth="lg"
          sx={{
            flex: 1,
            minWidth: 0,
            pt: { xs: 2, sm: 3 },
            // Bottom nav is position:fixed (56px) + iOS home indicator; reserve both in the scrollable area.
            pb: (theme) =>
              isMobile
                ? `calc(56px + env(safe-area-inset-bottom, 0px) + ${theme.spacing(2)})`
                : theme.spacing(4),
          }}
        >
          <Outlet />
        </Container>

        {isMobile && (
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
            <BottomNavigation
              showLabels
              value={activeIndex}
              onChange={(_, v) => navigate(ROUTES[v].path)}
            >
              {ROUTES.map((r) => {
                const Icon = r.icon;
                return (
                  <BottomNavigationAction
                    key={r.path}
                    label={t(`nav.${r.key}`)}
                    icon={<Icon />}
                  />
                );
              })}
            </BottomNavigation>
          </Paper>
        )}
      </Box>
      </HaLastSyncedProvider>
    </InstanceProvider>
  );
}
